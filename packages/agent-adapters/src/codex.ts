import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentAdapter, AgentCapability, AdapterAuthentication, AdapterDetection, AgentExecutionEvent, AgentExecutionRequest, AgentExecutionResult } from "./index.js";

interface Execution { process: ChildProcessWithoutNullStreams; events: AgentExecutionEvent[]; result?: AgentExecutionResult }
const at = () => new Date().toISOString();
export const buildCodexPrompt = (request: AgentExecutionRequest): string => [`Você está executando uma tarefa do Mireva Workspace.`, `Título: ${request.title}`, `Instruções: ${request.instructions}`, request.context.length ? `Contexto relevante:\n${request.context.join("\n")}` : "", "Trabalhe somente no diretório autorizado. Não faça operações destrutivas, force push, merge ou publicação. Ao terminar, explique resumidamente a entrega."].filter(Boolean).join("\n\n");

export class CodexCliAdapter implements AgentAdapter {
  readonly id = "codex";
  private readonly executions = new Map<string, Execution>();
  async detect(): Promise<AdapterDetection> { const outcome = await this.run("codex", ["--version"]); const version = outcome.output.match(/codex-cli\s+[^\s]+/)?.[0]; return outcome.code === 0 ? { installed: true, version: version ?? outcome.output.trim() } : { installed: false, reason: "Codex CLI não encontrado" }; }
  async checkAuthentication(): Promise<AdapterAuthentication> { const outcome = await this.run("codex", ["login", "status"]); return outcome.code === 0 ? { authenticated: true } : { authenticated: false, reason: outcome.output.trim() || "Codex não autenticado" }; }
  async getCapabilities(): Promise<AgentCapability[]> { return ["CODE", "RESEARCH", "TEST", "GIT", "STRUCTURED_OUTPUT", "CANCEL"]; }
  async executeTask(request: AgentExecutionRequest): Promise<void> {
    if (this.executions.has(request.taskId)) throw new Error("Task already executing");
    const startedAt = at(); const child = spawn("codex", ["exec", "--json", "-C", request.workingDirectory, buildCodexPrompt(request)], { stdio: "pipe", windowsHide: true });
    const execution: Execution = { process: child, events: [{ type: "STARTED", message: "Codex iniciado", at: startedAt }] }; this.executions.set(request.taskId, execution);
    let buffer = ""; child.stdout.on("data", (chunk: Buffer) => { buffer += chunk.toString(); let index; while ((index = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (!line) continue; try { const parsed = JSON.parse(line) as { type?: string; item?: { text?: string }; message?: string }; if (parsed.type !== "turn.completed") execution.events.push({ type: "LOG", message: parsed.item?.text ?? parsed.message ?? line, at: at() }); } catch { execution.events.push({ type: "LOG", message: line, at: at() }); } } });
    child.stderr.on("data", (chunk: Buffer) => execution.events.push({ type: "LOG", message: chunk.toString().trim(), at: at() }));
    child.on("error", (error) => this.finish(request.taskId, startedAt, `Não foi possível iniciar o Codex: ${error.message}`, "FAILED"));
    child.on("close", (code) => this.finish(request.taskId, startedAt, code === 0 ? "Codex concluiu a tarefa" : `Codex saiu com código ${code}`, code === 0 ? "COMPLETED" : "FAILED"));
  }
  async *streamEvents(taskId: string): AsyncIterable<AgentExecutionEvent> { const execution = this.executions.get(taskId); if (!execution) return; let index = 0; while (!execution.result || index < execution.events.length) { while (index < execution.events.length) yield execution.events[index++]!; if (!execution.result) await new Promise((resolve) => setTimeout(resolve, 100)); } }
  async cancelTask(taskId: string): Promise<void> { const execution = this.executions.get(taskId); if (!execution || execution.result) return; execution.process.kill(); this.finish(taskId, execution.events[0]!.at, "Cancelada pelo operador", "CANCELLED"); }
  async getResult(taskId: string): Promise<AgentExecutionResult | undefined> { return this.executions.get(taskId)?.result; }
  private finish(taskId: string, startedAt: string, summary: string, status: AgentExecutionResult["status"]): void {
    const execution = this.executions.get(taskId); if (!execution || execution.result) return;
    const completedAt = at(); execution.result = { taskId, status, summary, files: [], startedAt, completedAt };
    execution.events.push({ type: status === "COMPLETED" ? "COMPLETED" : status === "CANCELLED" ? "CANCELLED" : "FAILED", message: summary, at: completedAt });
  }
  private run(command: string, args: string[]): Promise<{ code: number | null; output: string }> { return new Promise((resolve) => { const child = spawn(command, args, { stdio: "pipe", windowsHide: true }); let output = ""; child.stdout.on("data", (chunk: Buffer) => output += chunk); child.stderr.on("data", (chunk: Buffer) => output += chunk); child.on("error", () => resolve({ code: 1, output })); child.on("close", (code) => resolve({ code, output })); }); }
}
