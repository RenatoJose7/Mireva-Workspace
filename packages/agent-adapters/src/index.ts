export type AgentCapability = "CODE" | "RESEARCH" | "TEST" | "GIT" | "STRUCTURED_OUTPUT" | "CANCEL";
export type AgentPermissionProfile = "READ_ONLY" | "PROJECT" | "PROJECT_NETWORK" | "FULL";
export interface AdapterDetection { installed: boolean; version?: string; reason?: string }
export interface AdapterAuthentication { authenticated: boolean; reason?: string }
export interface AgentExecutionRequest { taskId: string; title: string; instructions: string; workingDirectory: string; context: string[]; permissionProfile?: AgentPermissionProfile; model?: string | null }
export interface AgentConversationRequest { message: string; workingDirectory: string; context: string[]; permissionProfile?: AgentPermissionProfile; model?: string | null }
export type AgentExecutionEvent = { type: "STARTED" | "PROGRESS" | "LOG" | "COMPLETED" | "FAILED" | "CANCELLED"; message: string; at: string };
export interface AgentExecutionResult { taskId: string; status: "COMPLETED" | "FAILED" | "CANCELLED"; summary: string; files: string[]; branch?: string; startedAt: string; completedAt: string }
export interface AgentPlanTask { title: string; description: string; dependencies: number[]; priority: number; requiredCapabilities: string[]; acceptanceCriteria: string[] }
export interface AgentPlan { summary: string; tasks: AgentPlanTask[] }
export interface AgentPlanningRequest { request: string; workingDirectory: string; projectContext: string; permissionProfile?: AgentPermissionProfile; model?: string | null }
export interface ProjectPlanningAdapter { planProject(request: AgentPlanningRequest): Promise<AgentPlan> }

export interface AgentAdapter {
  readonly id: string;
  detect(): Promise<AdapterDetection>;
  checkAuthentication(): Promise<AdapterAuthentication>;
  getCapabilities(): Promise<AgentCapability[]>;
  respondToMessage(request: AgentConversationRequest): Promise<string>;
  executeTask(request: AgentExecutionRequest): Promise<void>;
  streamEvents(taskId: string): AsyncIterable<AgentExecutionEvent>;
  cancelTask(taskId: string): Promise<void>;
  getResult(taskId: string): Promise<AgentExecutionResult | undefined>;
}
export const isProjectPlanningAdapter = (adapter: AgentAdapter): adapter is AgentAdapter & ProjectPlanningAdapter => "planProject" in adapter && typeof (adapter as Partial<ProjectPlanningAdapter>).planProject === "function";

interface MockExecution { events: AgentExecutionEvent[]; result?: AgentExecutionResult; cancelled: boolean }
export class MockAgentAdapter implements AgentAdapter {
  readonly id = "mock";
  private readonly executions = new Map<string, MockExecution>();
  async detect(): Promise<AdapterDetection> { return { installed: true, version: "test" }; }
  async checkAuthentication(): Promise<AdapterAuthentication> { return { authenticated: true }; }
  async getCapabilities(): Promise<AgentCapability[]> { return ["CODE", "RESEARCH", "TEST", "GIT", "STRUCTURED_OUTPUT", "CANCEL"]; }
  async respondToMessage(request: AgentConversationRequest): Promise<string> { return `Mock respondeu: ${request.message}`; }
  async executeTask(request: AgentExecutionRequest): Promise<void> {
    const previous = this.executions.get(request.taskId); if (previous && !previous.result) throw new Error("Task already executing"); if (previous) this.executions.delete(request.taskId);
    const startedAt = new Date().toISOString(); const execution: MockExecution = { cancelled: false, events: [{ type: "STARTED", message: `Iniciando: ${request.title}`, at: startedAt }, { type: "PROGRESS", message: "Mock executando tarefa", at: new Date().toISOString() }] };
    this.executions.set(request.taskId, execution);
    queueMicrotask(() => { if (execution.cancelled) return; const completedAt = new Date().toISOString(); execution.events.push({ type: "COMPLETED", message: "Mock concluiu a tarefa", at: completedAt }); execution.result = { taskId: request.taskId, status: "COMPLETED", summary: "Entrega simulada", files: [], startedAt, completedAt }; });
  }
  async *streamEvents(taskId: string): AsyncIterable<AgentExecutionEvent> { const execution = this.executions.get(taskId); if (!execution) return; let index = 0; while (index < execution.events.length || !execution.result) { while (index < execution.events.length) yield execution.events[index++]!; if (execution.result) return; await new Promise((resolve) => setTimeout(resolve, 1)); } }
  async cancelTask(taskId: string): Promise<void> { const execution = this.executions.get(taskId); if (!execution || execution.result) return; execution.cancelled = true; const completedAt = new Date().toISOString(); execution.events.push({ type: "CANCELLED", message: "Execução cancelada", at: completedAt }); execution.result = { taskId, status: "CANCELLED", summary: "Cancelada pelo usuário", files: [], startedAt: execution.events[0]!.at, completedAt }; }
  async getResult(taskId: string): Promise<AgentExecutionResult | undefined> { const result = this.executions.get(taskId)?.result; if (result) this.executions.delete(taskId); return result; }
}

export { CodexCliAdapter, buildCodexExecArgs, buildCodexPlanningPrompt, buildCodexPrompt, codexGlobalArgs, codexPermissionArgs, parseCodexPlanOutput } from "./codex.js";
export { CopilotCliAdapter, buildCopilotPlanningPrompt, buildCopilotPrompt, copilotPermissionArgs, parseAgentPlan, parseCopilotPlan } from "./copilot.js";
export { ClaudeCliAdapter, buildClaudeArgs, claudePermissionArgs, parseClaudeResponse } from "./claude.js";
export { AntigravityCliAdapter, antigravityPermissionArgs, buildAntigravityArgs, parseAntigravityResponse } from "./antigravity.js";
