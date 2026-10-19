export type AgentCapability = "CODE" | "RESEARCH" | "TEST" | "GIT" | "STRUCTURED_OUTPUT" | "CANCEL";
export interface AdapterDetection { installed: boolean; version?: string; reason?: string }
export interface AdapterAuthentication { authenticated: boolean; reason?: string }
export interface AgentExecutionRequest { taskId: string; title: string; instructions: string; workingDirectory: string; context: string[] }
export type AgentExecutionEvent = { type: "STARTED" | "PROGRESS" | "LOG" | "COMPLETED" | "FAILED" | "CANCELLED"; message: string; at: string };
export interface AgentExecutionResult { taskId: string; status: "COMPLETED" | "FAILED" | "CANCELLED"; summary: string; files: string[]; startedAt: string; completedAt: string }

export interface AgentAdapter {
  readonly id: string;
  detect(): Promise<AdapterDetection>;
  checkAuthentication(): Promise<AdapterAuthentication>;
  getCapabilities(): Promise<AgentCapability[]>;
  executeTask(request: AgentExecutionRequest): Promise<void>;
  streamEvents(taskId: string): AsyncIterable<AgentExecutionEvent>;
  cancelTask(taskId: string): Promise<void>;
  getResult(taskId: string): Promise<AgentExecutionResult | undefined>;
}

interface MockExecution { events: AgentExecutionEvent[]; result?: AgentExecutionResult; cancelled: boolean }
export class MockAgentAdapter implements AgentAdapter {
  readonly id = "mock";
  private readonly executions = new Map<string, MockExecution>();
  async detect(): Promise<AdapterDetection> { return { installed: true, version: "test" }; }
  async checkAuthentication(): Promise<AdapterAuthentication> { return { authenticated: true }; }
  async getCapabilities(): Promise<AgentCapability[]> { return ["CODE", "RESEARCH", "TEST", "GIT", "STRUCTURED_OUTPUT", "CANCEL"]; }
  async executeTask(request: AgentExecutionRequest): Promise<void> {
    const startedAt = new Date().toISOString(); const execution: MockExecution = { cancelled: false, events: [{ type: "STARTED", message: `Iniciando: ${request.title}`, at: startedAt }, { type: "PROGRESS", message: "Mock executando tarefa", at: new Date().toISOString() }] };
    this.executions.set(request.taskId, execution);
    queueMicrotask(() => { if (execution.cancelled) return; const completedAt = new Date().toISOString(); execution.events.push({ type: "COMPLETED", message: "Mock concluiu a tarefa", at: completedAt }); execution.result = { taskId: request.taskId, status: "COMPLETED", summary: "Entrega simulada", files: [], startedAt, completedAt }; });
  }
  async *streamEvents(taskId: string): AsyncIterable<AgentExecutionEvent> { const execution = this.executions.get(taskId); if (!execution) return; let index = 0; while (index < execution.events.length || !execution.result) { while (index < execution.events.length) yield execution.events[index++]!; if (execution.result) return; await new Promise((resolve) => setTimeout(resolve, 1)); } }
  async cancelTask(taskId: string): Promise<void> { const execution = this.executions.get(taskId); if (!execution || execution.result) return; execution.cancelled = true; const completedAt = new Date().toISOString(); execution.events.push({ type: "CANCELLED", message: "Execução cancelada", at: completedAt }); execution.result = { taskId, status: "CANCELLED", summary: "Cancelada pelo usuário", files: [], startedAt: execution.events[0]!.at, completedAt }; }
  async getResult(taskId: string): Promise<AgentExecutionResult | undefined> { return this.executions.get(taskId)?.result; }
}
