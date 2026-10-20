import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AgentAdapter, AgentCapability, AdapterAuthentication, AdapterDetection, AgentExecutionEvent, AgentExecutionRequest, AgentExecutionResult } from "./index.js";

interface Execution { process: ChildProcessWithoutNullStreams; events: AgentExecutionEvent[]; workingDirectory: string; result?: AgentExecutionResult }
const at = () => new Date().toISOString();

export const buildCopilotPrompt = (request: AgentExecutionRequest): string => [
  "Você está executando uma tarefa do Mireva Workspace no repositório atual.",
  `Título: ${request.title}`,
  `Instruções: ${request.instructions}`,
  request.context.length ? `Contexto relevante:\n${request.context.join("\n")}` : "",
  "Trabalhe somente no diretório autorizado. Não faça operações destrutivas, force push, merge ou publicação. Faça as alterações necessárias, execute verificações pertinentes e, ao terminar, explique resumidamente a entrega e os arquivos alterados."
].filter(Boolean).join("\n\n");

/** Adapter for the GitHub Copilot CLI. It intentionally does not enable broad tool approval flags. */
export class CopilotCliAdapter implements AgentAdapter {
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
  private run(command: string, args: string[]): Promise<{ code: number | null; output: string }> { return new Promise((resolve) => { const child = spawn(command, args, { stdio: "pipe", windowsHide: true }); let output = ""; child.stdout.on("data", (chunk: Buffer) => output += chunk); child.stderr.on("data", (chunk: Buffer) => output += chunk); child.on("error", () => resolve({ code: 1, output })); child.on("close", (code) => resolve({ code, output })); }); }
}
