import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentAdapter, AgentCapability, AgentConversationRequest, AgentPermissionProfile, AdapterAuthentication, AdapterDetection, AgentExecutionEvent, AgentExecutionRequest, AgentExecutionResult, AgentPlan, AgentPlanningRequest, ProjectPlanningAdapter } from "./index.js";
import { parseAgentPlan } from "./copilot.js";

interface Execution { process: ChildProcessWithoutNullStreams; events: AgentExecutionEvent[]; workingDirectory: string; timeout?: NodeJS.Timeout; result?: AgentExecutionResult }
const at = () => new Date().toISOString();
export const codexGlobalArgs = (profile: AgentPermissionProfile = "PROJECT"): string[] =>
  profile === "PROJECT_NETWORK" || profile === "FULL" ? ["--search"] : [];
export const codexPermissionArgs = (profile: AgentPermissionProfile = "PROJECT"): string[] => {
  if (profile === "FULL") return ["--dangerously-bypass-approvals-and-sandbox"];
  const args = ["--sandbox", profile === "READ_ONLY" ? "read-only" : "workspace-write"];
  if (profile === "PROJECT_NETWORK") args.push("-c", "sandbox_workspace_write.network_access=true");
  return args;
};
export const buildCodexExecArgs = (profile: AgentPermissionProfile | undefined, args: string[]): string[] => [
  ...codexGlobalArgs(profile),
  "exec",
  ...args,
  ...codexPermissionArgs(profile),
];
export const buildCodexPrompt = (request: AgentExecutionRequest): string => [`Você está executando uma tarefa do Mireva Workspace.`, `Título: ${request.title}`, `Instruções: ${request.instructions}`, request.context.length ? `Contexto relevante:\n${request.context.join("\n")}` : "", "Trabalhe somente no diretório autorizado. Não faça operações destrutivas, force push, merge ou publicação. Ao terminar, explique resumidamente a entrega."].filter(Boolean).join("\n\n");
export const buildCodexPlanningPrompt = (request: AgentPlanningRequest): string => ["Você é o orquestrador de tarefas do Mireva Workspace e está conversando com o responsável pelo projeto. Não altere arquivos, não instale dependências e não execute comandos que modifiquem o projeto. Só inspecione arquivos quando isso realmente ajudar a responder ou planejar.", `Pedido do responsável:\n${request.request}`, `Estado atual do projeto e dos agentes:\n${request.projectContext}`, "Responda SOMENTE com JSON válido, sem Markdown, usando exatamente este formato:", '{"summary":"resposta para o responsável","tasks":[{"title":"título","description":"instruções objetivas","dependencies":[0],"priority":50,"requiredCapabilities":["CODE"],"acceptanceCriteria":["critério verificável"]}]}', "Se a mensagem for uma saudação, pergunta, ideia incompleta ou ainda exigir decisões do responsável, responda naturalmente em summary, faça no máximo 3 perguntas objetivas e retorne tasks: []. Só crie tarefas quando houver informação suficiente ou quando o responsável pedir para montar o plano. Nesse caso, crie entre 1 e 30 tarefas pequenas e executáveis. dependencies usa índices de tarefas anteriores; use [] quando não houver dependência. requiredCapabilities deve usar apenas capacidades que existam entre os agentes conectados quando possível."].join("\n\n");
export const parseCodexPlanOutput = (output: string): AgentPlan => {
  const messages = output.split("\n").flatMap((line) => { try { const event = JSON.parse(line) as { item?: { type?: string; text?: string } }; return event.item?.type === "agent_message" && typeof event.item.text === "string" ? [event.item.text] : []; } catch { return []; } });
  return parseAgentPlan(messages.join("\n") || output);
};

export class CodexCliAdapter implements AgentAdapter, ProjectPlanningAdapter {
  readonly id = "codex";
  private readonly executions = new Map<string, Execution>();
  async detect(): Promise<AdapterDetection> { const outcome = await this.run("codex", ["--version"]); const version = outcome.output.match(/codex-cli\s+[^\s]+/)?.[0]; return outcome.code === 0 ? { installed: true, version: version ?? outcome.output.trim() } : { installed: false, reason: "Codex CLI não encontrado" }; }
  async checkAuthentication(): Promise<AdapterAuthentication> { const outcome = await this.run("codex", ["login", "status"]); return outcome.code === 0 ? { authenticated: true } : { authenticated: false, reason: outcome.output.trim() || "Codex não autenticado" }; }
  async getCapabilities(): Promise<AgentCapability[]> { return ["CODE", "RESEARCH", "TEST", "GIT", "STRUCTURED_OUTPUT", "CANCEL"]; }
  async respondToMessage(request: AgentConversationRequest): Promise<string> {
    const prompt = ["Você está conversando diretamente com o responsável por esta estação no Mireva Workspace.", `Mensagem: ${request.message}`, request.context.length ? `Contexto recente:\n${request.context.join("\n")}` : "", "Responda de forma objetiva. Só altere arquivos quando a mensagem pedir isso explicitamente."].filter(Boolean).join("\n\n");
    const outcome = await this.run("codex", buildCodexExecArgs(request.permissionProfile, ["--json", "--skip-git-repo-check", "-C", request.workingDirectory, prompt]), 90_000);
    if (outcome.code !== 0) throw new Error(outcome.output.trim() || `Codex saiu com código ${outcome.code}`);
    return this.agentMessages(outcome.output) || "Concluído.";
  }
  async planProject(request: AgentPlanningRequest): Promise<AgentPlan> {
    const outcome = await this.run("codex", buildCodexExecArgs(request.permissionProfile ?? "READ_ONLY", ["--json", "--skip-git-repo-check", "-C", request.workingDirectory, buildCodexPlanningPrompt(request)]), 180_000);
    if (outcome.code !== 0) throw new Error(outcome.output.trim() || `Codex saiu com código ${outcome.code} ao criar o plano`);
    return parseCodexPlanOutput(outcome.output);
  }
  async executeTask(request: AgentExecutionRequest): Promise<void> {
    if (this.executions.has(request.taskId)) throw new Error("Task already executing");
    const startedAt = at(); const child = spawn("codex", buildCodexExecArgs(request.permissionProfile, ["--json", "--skip-git-repo-check", "-C", request.workingDirectory, buildCodexPrompt(request)]), { stdio: "pipe", windowsHide: true });
    // `codex exec` reads any open stdin after the positional prompt. Closing
    // the pipe is essential; otherwise it waits forever for another message.
    child.stdin.end();
    const execution: Execution = { process: child, workingDirectory: request.workingDirectory, events: [{ type: "STARTED", message: "Codex iniciado", at: startedAt }] }; this.executions.set(request.taskId, execution);
    execution.timeout = setTimeout(() => { execution.events.push({ type: "LOG", message: "Tempo limite de 15 minutos excedido.", at: at() }); child.kill(); void this.finish(request.taskId, startedAt, "Tempo limite de 15 minutos excedido.", "FAILED"); }, 15 * 60_000);
    let buffer = ""; child.stdout.on("data", (chunk: Buffer) => { buffer += chunk.toString(); let index; while ((index = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (!line) continue; try { const parsed = JSON.parse(line) as { type?: string; item?: { text?: string }; message?: string }; if (parsed.type !== "turn.completed") execution.events.push({ type: "LOG", message: parsed.item?.text ?? parsed.message ?? line, at: at() }); } catch { execution.events.push({ type: "LOG", message: line, at: at() }); } } });
    child.stderr.on("data", (chunk: Buffer) => execution.events.push({ type: "LOG", message: chunk.toString().trim(), at: at() }));
    child.on("error", (error) => void this.finish(request.taskId, startedAt, `Não foi possível iniciar o Codex: ${error.message}`, "FAILED"));
    child.on("close", (code) => { const detail = execution.events.filter((event) => event.type === "LOG").slice(-6).map((event) => event.message).join("\n"); void this.finish(request.taskId, startedAt, code === 0 ? "Codex concluiu a tarefa" : detail || `Codex saiu com código ${code}`, code === 0 ? "COMPLETED" : "FAILED"); });
  }
  async *streamEvents(taskId: string): AsyncIterable<AgentExecutionEvent> { const execution = this.executions.get(taskId); if (!execution) return; let index = 0; while (!execution.result || index < execution.events.length) { while (index < execution.events.length) yield execution.events[index++]!; if (!execution.result) await new Promise((resolve) => setTimeout(resolve, 100)); } }
  async cancelTask(taskId: string): Promise<void> { const execution = this.executions.get(taskId); if (!execution || execution.result) return; execution.process.kill(); await this.finish(taskId, execution.events[0]!.at, "Cancelada pelo operador", "CANCELLED"); }
  async getResult(taskId: string): Promise<AgentExecutionResult | undefined> { return this.executions.get(taskId)?.result; }
  private async finish(taskId: string, startedAt: string, summary: string, status: AgentExecutionResult["status"]): Promise<void> {
    const execution = this.executions.get(taskId); if (!execution || execution.result) return;
    if (execution.timeout) clearTimeout(execution.timeout);
    const git = await this.gitState(execution.workingDirectory); const completedAt = at(); execution.result = { taskId, status, summary, files: git.files, branch: git.branch, startedAt, completedAt };
    execution.events.push({ type: status === "COMPLETED" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "FAILED", message: summary, at: completedAt });
  }
  private async gitState(workingDirectory: string): Promise<{ branch?: string; files: string[] }> {
    const [branch, status] = await Promise.all([this.run("git", ["-C", workingDirectory, "branch", "--show-current"]), this.run("git", ["-C", workingDirectory, "status", "--short"])]);
    return { branch: branch.code === 0 ? branch.output.trim() || undefined : undefined, files: status.code === 0 ? status.output.split("\n").filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean) : [] };
  }
  private agentMessages(output: string): string { return output.split("\n").flatMap((line) => { try { const event = JSON.parse(line) as { item?: { type?: string; text?: string } }; return event.item?.type === "agent_message" && typeof event.item.text === "string" ? [event.item.text] : []; } catch { return []; } }).join("\n").trim(); }
  private run(command: string, args: string[], timeoutMs?: number): Promise<{ code: number | null; output: string }> { return new Promise((resolve) => { const child = spawn(command, args, { stdio: "pipe", windowsHide: true }); child.stdin.end(); let output = ""; let settled = false; const finish = (code: number | null) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve({ code, output }); }; const timer = timeoutMs ? setTimeout(() => { output += `\nTempo limite de ${Math.round(timeoutMs / 1_000)} segundos excedido.`; child.kill(); finish(124); }, timeoutMs) : undefined; child.stdout.on("data", (chunk: Buffer) => output += chunk); child.stderr.on("data", (chunk: Buffer) => output += chunk); child.on("error", () => finish(1)); child.on("close", finish); }); }
}
