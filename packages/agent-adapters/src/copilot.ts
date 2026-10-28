import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentAdapter, AgentCapability, AgentConversationRequest, AgentPermissionProfile, AdapterAuthentication, AdapterDetection, AgentExecutionEvent, AgentExecutionRequest, AgentExecutionResult, AgentPlan, AgentPlanningRequest, ProjectPlanningAdapter } from "./index.js";

interface Execution { process: ChildProcessWithoutNullStreams; events: AgentExecutionEvent[]; workingDirectory: string; timeout?: NodeJS.Timeout; result?: AgentExecutionResult }
const at = () => new Date().toISOString();
const limitText = (value: string, maximum: number): string => value.length <= maximum ? value : `${value.slice(0, maximum - 1).trimEnd()}…`;
export const copilotPermissionArgs = (profile: AgentPermissionProfile = "PROJECT"): string[] => {
  if (profile === "FULL") return ["--allow-all"];
  const args = ["--allow-all-tools", "--deny-tool=shell(git push)", "--deny-tool=shell(npm publish)", "--deny-tool=shell(pnpm publish)", "--deny-tool=shell(sudo:*)"];
  if (profile === "READ_ONLY") args.push("--deny-tool=write", "--deny-tool=shell");
  if (profile === "PROJECT_NETWORK") args.push("--allow-all-urls");
  return args;
};

export const buildCopilotPrompt = (request: AgentExecutionRequest): string => [
  "Você está executando uma tarefa do Mireva Workspace no repositório atual.",
  `Título: ${request.title}`,
  `Instruções: ${request.instructions}`,
  request.context.length ? `Contexto relevante:\n${request.context.join("\n")}` : "",
  "Trabalhe somente no diretório autorizado. Não faça operações destrutivas, force push, merge ou publicação. Faça as alterações necessárias, execute verificações pertinentes e, ao terminar, explique resumidamente a entrega e os arquivos alterados."
].filter(Boolean).join("\n\n");

export const buildCopilotPlanningPrompt = (request: AgentPlanningRequest): string => [
  "Você é o orquestrador de tarefas do Mireva Workspace e está conversando com o responsável pelo projeto. Não altere arquivos, não instale dependências e não execute comandos que modifiquem o projeto. Só inspecione arquivos quando isso realmente ajudar a responder ou planejar.",
  `Pedido do responsável:\n${request.request}`,
  `Estado atual do projeto e dos agentes:\n${request.projectContext}`,
  "Responda SOMENTE com JSON válido, sem Markdown, usando exatamente este formato:",
  '{"summary":"resumo curto","tasks":[{"title":"título","description":"instruções objetivas","dependencies":[0],"priority":50,"requiredCapabilities":["CODE"],"acceptanceCriteria":["critério verificável"]}]}',
  "Trabalhe com iniciativa. Quando o pedido indicar um resultado executável, assuma detalhes comuns e reversíveis, registre brevemente as suposições em summary e crie o plano sem pedir outra confirmação. Faça no máximo 2 perguntas e somente quando a resposta mudar materialmente o resultado ou for indispensável para executar com segurança. Organize tarefas independentes sem dependências para permitir trabalho paralelo entre os agentes conectados. Uma aprovação do plano deve bastar para iniciar toda a execução; não transforme escolhas triviais em novos bloqueios.",
  "O campo summary deve ser fácil de ler no chat: use no máximo 1.200 caracteres, uma abertura curta e depois blocos curtos ou de 2 a 5 tópicos iniciados por '- '. Separe os blocos com quebras de linha e nunca devolva um parágrafo gigante.",
  "Se a mensagem for apenas uma saudação, uma pergunta sem trabalho executável ou uma ideia ainda realmente bloqueada por uma decisão do responsável, responda naturalmente em summary e retorne tasks: []. Nos demais casos, crie entre 1 e 30 tarefas pequenas e executáveis. dependencies usa índices de tarefas anteriores; use [] quando não houver dependência. requiredCapabilities deve usar apenas capacidades que existam entre os agentes conectados quando possível."
].join("\n\n");

export const parseAgentPlan = (output: string): AgentPlan => {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? output).trim();
  const json = candidate.startsWith("{") ? candidate : candidate.slice(candidate.indexOf("{"), candidate.lastIndexOf("}") + 1);
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error("O Copilot não retornou um plano JSON válido"); }
  if (!parsed || typeof parsed !== "object") throw new Error("O Copilot retornou um plano inválido");
  const value = parsed as { summary?: unknown; tasks?: unknown };
  if (typeof value.summary !== "string" || !value.summary.trim() || !Array.isArray(value.tasks) || value.tasks.length > 30) throw new Error("A resposta do Copilot precisa ter um resumo e no máximo 30 tarefas");
  const tasks = value.tasks.map((task, index) => {
    if (!task || typeof task !== "object") throw new Error(`Tarefa ${index + 1} inválida no plano do Copilot`);
    const item = task as Record<string, unknown>; const dependencies = Array.isArray(item.dependencies) ? item.dependencies : [];
    if (typeof item.title !== "string" || !item.title.trim() || !dependencies.every((dependency) => Number.isInteger(dependency) && (dependency as number) >= 0 && (dependency as number) < index)) throw new Error(`Tarefa ${index + 1} inválida no plano do Copilot`);
    return { title: limitText(item.title.trim(), 300), description: typeof item.description === "string" ? limitText(item.description, 8_000) : "", dependencies: dependencies as number[], priority: typeof item.priority === "number" && Number.isInteger(item.priority) && item.priority >= 0 && item.priority <= 100 ? item.priority : 50, requiredCapabilities: Array.isArray(item.requiredCapabilities) ? item.requiredCapabilities.filter((capability): capability is string => typeof capability === "string").map((capability) => limitText(capability, 40)).slice(0, 12) : [], acceptanceCriteria: Array.isArray(item.acceptanceCriteria) ? item.acceptanceCriteria.filter((criterion): criterion is string => typeof criterion === "string").map((criterion) => limitText(criterion, 1_000)).slice(0, 20) : [] };
  });
  return { summary: limitText(value.summary.trim(), 1_200), tasks };
};
export const parseCopilotPlan = parseAgentPlan;

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
    const outcome = await this.run(this.command, ["-p", "Responda somente com READY. Esta é uma verificação de conexão do Mireva Workspace."]);
    return outcome.code === 0 ? { authenticated: true } : { authenticated: false, reason: outcome.output.trim() || "Copilot CLI não autenticado. Abra 'copilot' uma vez e conclua o login interativo." };
  }
  async getCapabilities(): Promise<AgentCapability[]> { return ["CODE", "RESEARCH", "TEST", "GIT", "CANCEL"]; }
  async respondToMessage(request: AgentConversationRequest): Promise<string> {
    const prompt = ["Você está conversando diretamente com o responsável por esta estação no Mireva Workspace.", `Mensagem: ${request.message}`, request.context.length ? `Contexto recente:\n${request.context.join("\n")}` : "", "Responda de forma objetiva. Só altere arquivos quando a mensagem pedir isso explicitamente."].filter(Boolean).join("\n\n");
    const outcome = await this.run(this.command, ["-s", "-p", prompt, ...copilotPermissionArgs(request.permissionProfile)], request.workingDirectory, 90_000);
    if (outcome.code !== 0) throw new Error(outcome.output.trim() || `Copilot saiu com código ${outcome.code}`);
    return outcome.output.trim() || "Concluído.";
  }
  async planProject(request: AgentPlanningRequest): Promise<AgentPlan> {
    const outcome = await this.run(this.command, ["-s", "-p", buildCopilotPlanningPrompt(request), ...copilotPermissionArgs(request.permissionProfile ?? "READ_ONLY")], request.workingDirectory, 90_000);
    if (outcome.code !== 0) throw new Error(outcome.output.trim() || `Copilot saiu com código ${outcome.code} ao criar o plano`);
    return parseCopilotPlan(outcome.output);
  }
  async executeTask(request: AgentExecutionRequest): Promise<void> {
    const previous = this.executions.get(request.taskId); if (previous && !previous.result) throw new Error("Task already executing"); if (previous) this.executions.delete(request.taskId);
    const startedAt = at();
    const child = spawn(this.command, ["-s", "-p", buildCopilotPrompt(request), ...copilotPermissionArgs(request.permissionProfile)], { cwd: request.workingDirectory, stdio: "pipe", windowsHide: true });
    const execution: Execution = { process: child, workingDirectory: request.workingDirectory, events: [{ type: "STARTED", message: "GitHub Copilot iniciado", at: startedAt }] };
    this.executions.set(request.taskId, execution);
    execution.timeout = setTimeout(() => { this.log(execution, "Tempo limite de 15 minutos excedido."); child.kill(); void this.finish(request.taskId, startedAt, "Tempo limite de 15 minutos excedido.", "FAILED"); }, 15 * 60_000);
    child.stdout.on("data", (chunk: Buffer) => this.log(execution, chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => this.log(execution, chunk.toString()));
    child.on("error", (error) => void this.finish(request.taskId, startedAt, `Não foi possível iniciar o Copilot: ${error.message}`, "FAILED"));
    child.on("close", (code) => { const detail = execution.events.filter((event) => event.type === "LOG").slice(-6).map((event) => event.message).join("\n"); void this.finish(request.taskId, startedAt, code === 0 ? "Copilot concluiu a tarefa" : detail || `Copilot saiu com código ${code}`, code === 0 ? "COMPLETED" : "FAILED"); });
  }
  async *streamEvents(taskId: string): AsyncIterable<AgentExecutionEvent> {
    const execution = this.executions.get(taskId); if (!execution) return; let index = 0;
    while (!execution.result || index < execution.events.length) { while (index < execution.events.length) yield execution.events[index++]!; if (!execution.result) await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  async cancelTask(taskId: string): Promise<void> { const execution = this.executions.get(taskId); if (!execution || execution.result) return; execution.process.kill(); await this.finish(taskId, execution.events[0]!.at, "Cancelada pelo operador", "CANCELLED"); }
  async getResult(taskId: string): Promise<AgentExecutionResult | undefined> { const result = this.executions.get(taskId)?.result; if (result) this.executions.delete(taskId); return result; }
  private log(execution: Execution, output: string): void { for (const line of output.split("\n").map((item) => item.trim()).filter(Boolean)) execution.events.push({ type: "LOG", message: line, at: at() }); }
  private async finish(taskId: string, startedAt: string, summary: string, status: AgentExecutionResult["status"]): Promise<void> {
    const execution = this.executions.get(taskId); if (!execution || execution.result) return;
    if (execution.timeout) clearTimeout(execution.timeout);
    const git = await this.gitState(execution.workingDirectory); const completedAt = at();
    execution.result = { taskId, status, summary, files: git.files, branch: git.branch, startedAt, completedAt };
    execution.events.push({ type: status === "COMPLETED" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "FAILED", message: summary, at: completedAt });
  }
  private async gitState(workingDirectory: string): Promise<{ branch?: string; files: string[] }> {
    const [branch, status] = await Promise.all([this.run("git", ["-C", workingDirectory, "branch", "--show-current"]), this.run("git", ["-C", workingDirectory, "status", "--short"])]);
    return { branch: branch.code === 0 ? branch.output.trim() || undefined : undefined, files: status.code === 0 ? status.output.split("\n").filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean) : [] };
  }
  private run(command: string, args: string[], cwd?: string, timeoutMs?: number): Promise<{ code: number | null; output: string }> { return new Promise((resolve) => { const child = spawn(command, args, { cwd, stdio: "pipe", windowsHide: true }); let output = ""; let settled = false; const finish = (code: number | null) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve({ code, output }); }; const timer = timeoutMs ? setTimeout(() => { output += `\nTempo limite de ${Math.round(timeoutMs / 1_000)} segundos excedido.`; child.kill(); finish(124); }, timeoutMs) : undefined; child.stdout.on("data", (chunk: Buffer) => output += chunk); child.stderr.on("data", (chunk: Buffer) => output += chunk); child.on("error", () => finish(1)); child.on("close", finish); }); }
}
