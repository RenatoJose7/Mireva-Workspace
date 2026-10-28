import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentAdapter, AgentCapability, AgentConversationRequest, AgentPermissionProfile, AdapterAuthentication, AdapterDetection, AgentExecutionEvent, AgentExecutionRequest, AgentExecutionResult, AgentPlan, AgentPlanningRequest, ProjectPlanningAdapter } from "./index.js";
import { buildCopilotPlanningPrompt, buildCopilotPrompt, parseAgentPlan } from "./copilot.js";

interface Execution { process: ChildProcessWithoutNullStreams; events: AgentExecutionEvent[]; workingDirectory: string; output: string; timeout?: NodeJS.Timeout; result?: AgentExecutionResult }
const at = () => new Date().toISOString();

export const antigravityPermissionArgs = (profile: AgentPermissionProfile = "PROJECT"): string[] => {
  if (profile === "READ_ONLY") return ["--mode=plan", "--sandbox"];
  if (profile === "FULL") return ["--dangerously-skip-permissions"];
  return ["--mode=auto", "--sandbox"];
};

export const buildAntigravityArgs = (prompt: string, profile?: AgentPermissionProfile, model?: string | null): string[] => [
  "-p", prompt,
  "--output-format", "json",
  "--print-timeout", "15m",
  ...(model ? ["--model", model] : []),
  ...antigravityPermissionArgs(profile),
];

export const parseAntigravityResponse = (output: string): string => {
  const parsed = JSON.parse(output) as { status?: string; response?: unknown; error?: unknown };
  if (parsed.status && parsed.status !== "SUCCESS") throw new Error(typeof parsed.error === "string" ? parsed.error : `Antigravity terminou com status ${parsed.status}`);
  if (typeof parsed.response !== "string") throw new Error("Antigravity não retornou uma resposta de texto");
  return parsed.response;
};

export class AntigravityCliAdapter implements AgentAdapter, ProjectPlanningAdapter {
  readonly id = "antigravity";
  private readonly executions = new Map<string, Execution>();
  constructor(private readonly command = process.env.MIREVA_ANTIGRAVITY_COMMAND || "agy") {}
  async detect(): Promise<AdapterDetection> { const outcome = await this.run(["--version"]); return outcome.code === 0 ? { installed: true, version: outcome.output.trim() || undefined } : { installed: false, reason: "Antigravity CLI não encontrado. Instale o CLI oficial e confirme que 'agy' está no PATH." }; }
  async checkAuthentication(): Promise<AdapterAuthentication> { const outcome = await this.run(["models"], undefined, 30_000); return outcome.code === 0 ? { authenticated: true } : { authenticated: false, reason: outcome.output.trim() || "Antigravity não autenticado. Abra 'agy' uma vez e conclua o login." }; }
  async getCapabilities(): Promise<AgentCapability[]> { return ["CODE", "RESEARCH", "TEST", "GIT", "STRUCTURED_OUTPUT", "CANCEL"]; }
  async respondToMessage(request: AgentConversationRequest): Promise<string> { const prompt = ["Você está conversando diretamente com o responsável por esta estação no Mireva Workspace.", `Mensagem: ${request.message}`, request.context.length ? `Contexto recente:\n${request.context.join("\n")}` : "", "Responda de forma objetiva. Só altere arquivos quando a mensagem pedir isso explicitamente."].filter(Boolean).join("\n\n"); const outcome = await this.run(buildAntigravityArgs(prompt, request.permissionProfile, request.model), request.workingDirectory, 90_000); if (outcome.code !== 0) throw new Error(outcome.output.trim() || `Antigravity saiu com código ${outcome.code}`); return parseAntigravityResponse(outcome.output) || "Concluído."; }
  async planProject(request: AgentPlanningRequest): Promise<AgentPlan> { const outcome = await this.run(buildAntigravityArgs(buildCopilotPlanningPrompt(request), request.permissionProfile ?? "READ_ONLY", request.model), request.workingDirectory, 180_000); if (outcome.code !== 0) throw new Error(outcome.output.trim() || `Antigravity saiu com código ${outcome.code} ao criar o plano`); return parseAgentPlan(parseAntigravityResponse(outcome.output)); }
  async executeTask(request: AgentExecutionRequest): Promise<void> {
    const previous = this.executions.get(request.taskId); if (previous && !previous.result) throw new Error("Task already executing"); if (previous) this.executions.delete(request.taskId);
    const startedAt = at(); const child = spawn(this.command, buildAntigravityArgs(buildCopilotPrompt(request), request.permissionProfile, request.model), { cwd: request.workingDirectory, stdio: "pipe", windowsHide: true }); child.stdin.end();
    const execution: Execution = { process: child, workingDirectory: request.workingDirectory, output: "", events: [{ type: "STARTED", message: "Antigravity iniciado", at: startedAt }] }; this.executions.set(request.taskId, execution);
    execution.timeout = setTimeout(() => { execution.events.push({ type: "LOG", message: "Tempo limite de 15 minutos excedido.", at: at() }); child.kill(); void this.finish(request.taskId, startedAt, "Tempo limite de 15 minutos excedido.", "FAILED"); }, 15 * 60_000);
    child.stdout.on("data", (chunk: Buffer) => execution.output += chunk.toString());
    child.stderr.on("data", (chunk: Buffer) => execution.events.push({ type: "LOG", message: chunk.toString().trim(), at: at() }));
    child.on("error", (error) => void this.finish(request.taskId, startedAt, `Não foi possível iniciar o Antigravity: ${error.message}`, "FAILED"));
    child.on("close", (code) => { let summary = "Antigravity concluiu a tarefa"; let parseFailure = ""; try { summary = parseAntigravityResponse(execution.output) || summary; execution.events.push({ type: "LOG", message: summary, at: at() }); } catch (error) { parseFailure = error instanceof Error ? error.message : String(error); execution.events.push({ type: "LOG", message: parseFailure, at: at() }); } const completed = code === 0 && !parseFailure; void this.finish(request.taskId, startedAt, completed ? summary : parseFailure || this.logTail(execution) || `Antigravity saiu com código ${code}`, completed ? "COMPLETED" : "FAILED"); });
  }
  async *streamEvents(taskId: string): AsyncIterable<AgentExecutionEvent> { const execution = this.executions.get(taskId); if (!execution) return; let index = 0; while (!execution.result || index < execution.events.length) { while (index < execution.events.length) yield execution.events[index++]!; if (!execution.result) await new Promise((resolve) => setTimeout(resolve, 100)); } }
  async cancelTask(taskId: string): Promise<void> { const execution = this.executions.get(taskId); if (!execution || execution.result) return; execution.process.kill(); await this.finish(taskId, execution.events[0]!.at, "Cancelada pelo operador", "CANCELLED"); }
  async getResult(taskId: string): Promise<AgentExecutionResult | undefined> { const result = this.executions.get(taskId)?.result; if (result) this.executions.delete(taskId); return result; }
  private logTail(execution: Execution): string { return execution.events.filter((event) => event.type === "LOG").slice(-6).map((event) => event.message).join("\n"); }
  private async finish(taskId: string, startedAt: string, summary: string, status: AgentExecutionResult["status"]): Promise<void> { const execution = this.executions.get(taskId); if (!execution || execution.result) return; if (execution.timeout) clearTimeout(execution.timeout); const git = await this.gitState(execution.workingDirectory); const completedAt = at(); execution.result = { taskId, status, summary, files: git.files, branch: git.branch, startedAt, completedAt }; execution.events.push({ type: status === "COMPLETED" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "FAILED", message: summary, at: completedAt }); }
  private async gitState(workingDirectory: string): Promise<{ branch?: string; files: string[] }> { const [branch, status] = await Promise.all([this.runCommand("git", ["-C", workingDirectory, "branch", "--show-current"]), this.runCommand("git", ["-C", workingDirectory, "status", "--short"])]); return { branch: branch.code === 0 ? branch.output.trim() || undefined : undefined, files: status.code === 0 ? status.output.split("\n").filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean) : [] }; }
  private run(args: string[], cwd?: string, timeoutMs?: number) { return this.runCommand(this.command, args, cwd, timeoutMs); }
  private runCommand(command: string, args: string[], cwd?: string, timeoutMs?: number): Promise<{ code: number | null; output: string }> { return new Promise((resolve) => { const child = spawn(command, args, { cwd, stdio: "pipe", windowsHide: true }); child.stdin.end(); let output = ""; let settled = false; const finish = (code: number | null) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve({ code, output }); }; const timer = timeoutMs ? setTimeout(() => { output += `\nTempo limite de ${Math.round(timeoutMs / 1_000)} segundos excedido.`; child.kill(); finish(124); }, timeoutMs) : undefined; child.stdout.on("data", (chunk: Buffer) => output += chunk); child.stderr.on("data", (chunk: Buffer) => output += chunk); child.on("error", () => finish(1)); child.on("close", finish); }); }
}
