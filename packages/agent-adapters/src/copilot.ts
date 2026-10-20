import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentAdapter, AgentCapability, AdapterAuthentication, AdapterDetection, AgentExecutionEvent, AgentExecutionRequest, AgentExecutionResult, AgentPlan, AgentPlanningRequest, ProjectPlanningAdapter } from "./index.js";

interface Execution { process: ChildProcessWithoutNullStreams; events: AgentExecutionEvent[]; workingDirectory: string; result?: AgentExecutionResult }
const at = () => new Date().toISOString();

export const buildCopilotPrompt = (request: AgentExecutionRequest): string => [
  "Você está executando uma tarefa do Mireva Workspace no repositório atual.",
  `Título: ${request.title}`,
  `Instruções: ${request.instructions}`,
  request.context.length ? `Contexto relevante:\n${request.context.join("\n")}` : "",
  "Trabalhe somente no diretório autorizado. Não faça operações destrutivas, force push, merge ou publicação. Faça as alterações necessárias, execute verificações pertinentes e, ao terminar, explique resumidamente a entrega e os arquivos alterados."
].filter(Boolean).join("\n\n");

export const buildCopilotPlanningPrompt = (request: AgentPlanningRequest): string => [
  "Você é o orquestrador de tarefas do Mireva Workspace. Não altere arquivos e não execute comandos: apenas planeje o trabalho.",
  `Pedido do responsável:\n${request.request}`,
  `Estado atual do projeto e dos agentes:\n${request.projectContext}`,
  "Responda SOMENTE com JSON válido, sem Markdown, usando exatamente este formato:",
  '{"summary":"resumo curto","tasks":[{"title":"título","description":"instruções objetivas","dependencies":[0],"priority":50,"requiredCapabilities":["CODE"],"acceptanceCriteria":["critério verificável"]}]}',
  "Crie entre 1 e 30 tarefas pequenas e executáveis. dependencies usa índices de tarefas anteriores; use [] quando não houver dependência. requiredCapabilities deve usar apenas capacidades que existam entre os agentes conectados quando possível."
].join("\n\n");

export const parseCopilotPlan = (output: string): AgentPlan => {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? output).trim();
  const json = candidate.startsWith("{") ? candidate : candidate.slice(candidate.indexOf("{"), candidate.lastIndexOf("}") + 1);
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error("O Copilot não retornou um plano JSON válido"); }
  if (!parsed || typeof parsed !== "object") throw new Error("O Copilot retornou um plano inválido");
  const value = parsed as { summary?: unknown; tasks?: unknown };
  if (typeof value.summary !== "string" || !Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > 30) throw new Error("O plano do Copilot precisa ter um resumo e entre 1 e 30 tarefas");
  const tasks = value.tasks.map((task, index) => {
    if (!task || typeof task !== "object") throw new Error(`Tarefa ${index + 1} inválida no plano do Copilot`);
    const item = task as Record<string, unknown>; const dependencies = Array.isArray(item.dependencies) ? item.dependencies : [];
    if (typeof item.title !== "string" || !item.title.trim() || !dependencies.every((dependency) => Number.isInteger(dependency) && (dependency as number) >= 0 && (dependency as number) < index)) throw new Error(`Tarefa ${index + 1} inválida no plano do Copilot`);
    return { title: item.title, description: typeof item.description === "string" ? item.description : "", dependencies: dependencies as number[], priority: typeof item.priority === "number" && Number.isInteger(item.priority) && item.priority >= 0 && item.priority <= 100 ? item.priority : 50, requiredCapabilities: Array.isArray(item.requiredCapabilities) ? item.requiredCapabilities.filter((capability): capability is string => typeof capability === "string") : [], acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria.filter((criterion): criterion is string => typeof criterion === "string") : [] };
  });
  return { summary: value.summary, tasks };
};

/** Adapter for the GitHub Copilot CLI. It intentionally does not enable broad tool approval flags. */
export class CopilotCliAdapter implements AgentAdapter, ProjectPlanningAdapter {
  readonly id = "copilot";
  private readonly executions = new Map<string, Execution>();
  constructor(private readonly command = process.env.MIREVA_COPILOT_COMMAND || "copilot") {}
  async detect(): Promise<AdapterDetection> {
    const outcome = await this.run(this.command, ["--version"]);
    return outcome.code === 0 ? { installed: true, version: outcome.output.trim() || undefined } : { installed: false, reason: "GitHub Copilot CLI não encontrado. Instale-o e confirme que o comando 'copilot' está no PATH." };
  }
  async checkAuthentication(): Promise<AdapterAuthentication> {
    const outcome = await this.run(this.command, ["auth", "status"]);
    return outcome.code === 0 ? { authenticated: true } : { authenticated: false, reason: outcome.output.trim() || "Copilot CLI não autenticado. Execute 'copilot auth login'." };
  }
  async getCapabilities(): Promise<AgentCapability[]> { return ["CODE", "RESEARCH", "TEST", "GIT", "CANCEL"]; }
  async planProject(request: AgentPlanningRequest): Promise<AgentPlan> {
    const outcome = await this.run(this.command, ["-p", buildCopilotPlanningPrompt(request)], request.workingDirectory);
    if (outcome.code !== 0) throw new Error(outcome.output.trim() || `Copilot saiu com código ${outcome.code} ao criar o plano`);
    return parseCopilotPlan(outcome.output);
  }
  async executeTask(request: AgentExecutionRequest): Promise<void> {
    if (this.executions.has(request.taskId)) throw new Error("Task already executing");
    const startedAt = at();
    const child = spawn(this.command, ["-p", buildCopilotPrompt(request)], { cwd: request.workingDirectory, stdio: "pipe", windowsHide: true });
    const execution: Execution = { process: child, workingDirectory: request.workingDirectory, events: [{ type: "STARTED", message: "GitHub Copilot iniciado", at: startedAt }] };
    this.executions.set(request.taskId, execution);
    child.stdout.on("data", (chunk: Buffer) => this.log(execution, chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => this.log(execution, chunk.toString()));
    child.on("error", (error) => void this.finish(request.taskId, startedAt, `Não foi possível iniciar o Copilot: ${error.message}`, "FAILED"));
    child.on("close", (code) => void this.finish(request.taskId, startedAt, code === 0 ? "Copilot concluiu a tarefa" : `Copilot saiu com código ${code}`, code === 0 ? "COMPLETED" : "FAILED"));
  }
  async *streamEvents(taskId: string): AsyncIterable<AgentExecutionEvent> {
    const execution = this.executions.get(taskId); if (!execution) return; let index = 0;
    while (!execution.result || index < execution.events.length) { while (index < execution.events.length) yield execution.events[index++]!; if (!execution.result) await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  async cancelTask(taskId: string): Promise<void> { const execution = this.executions.get(taskId); if (!execution || execution.result) return; execution.process.kill(); await this.finish(taskId, execution.events[0]!.at, "Cancelada pelo operador", "CANCELLED"); }
  async getResult(taskId: string): Promise<AgentExecutionResult | undefined> { return this.executions.get(taskId)?.result; }
  private log(execution: Execution, output: string): void { for (const line of output.split("\n").map((item) => item.trim()).filter(Boolean)) execution.events.push({ type: "LOG", message: line, at: at() }); }
  private async finish(taskId: string, startedAt: string, summary: string, status: AgentExecutionResult["status"]): Promise<void> {
    const execution = this.executions.get(taskId); if (!execution || execution.result) return;
    const git = await this.gitState(execution.workingDirectory); const completedAt = at();
    execution.result = { taskId, status, summary, files: git.files, branch: git.branch, startedAt, completedAt };
    execution.events.push({ type: status === "COMPLETED" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "FAILED", message: summary, at: completedAt });
  }
  private async gitState(workingDirectory: string): Promise<{ branch?: string; files: string[] }> {
    const [branch, status] = await Promise.all([this.run("git", ["-C", workingDirectory, "branch", "--show-current"]), this.run("git", ["-C", workingDirectory, "status", "--short"])]);
    return { branch: branch.code === 0 ? branch.output.trim() || undefined : undefined, files: status.code === 0 ? status.output.split("\n").filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean) : [] };
  }
  private run(command: string, args: string[], cwd?: string): Promise<{ code: number | null; output: string }> { return new Promise((resolve) => { const child = spawn(command, args, { cwd, stdio: "pipe", windowsHide: true }); let output = ""; child.stdout.on("data", (chunk: Buffer) => output += chunk); child.stderr.on("data", (chunk: Buffer) => output += chunk); child.on("error", () => resolve({ code: 1, output })); child.on("close", (code) => resolve({ code, output })); }); }
}
