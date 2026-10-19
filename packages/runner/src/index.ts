import type { AgentAdapter, AgentExecutionRequest } from "@mireva/agent-adapters";
import type { AgentState, Participant, RoomEvent, Task } from "@mireva/protocol";

export interface RunnerConfig { hubUrl: string; roomCode: string; participantId: string; name: string; agent: string; lastSequence: number }
export interface RunnerCallbacks { onEvent?(event: RoomEvent): void; onError?(error: Error): void }

export class MirevaRunner {
  private timer: NodeJS.Timeout | undefined;
  private state: AgentState = "AVAILABLE";
  constructor(public readonly config: RunnerConfig, private readonly callbacks: RunnerCallbacks = {}) {}

  async publish(kind: "MESSAGE" | "TASK_CREATED" | "TASK_UPDATED" | "DECISION_REQUESTED", payload: Record<string, unknown>): Promise<RoomEvent> {
    return this.request(`/rooms/${this.config.roomCode}/events`, { method: "POST", body: { participantId: this.config.participantId, kind, payload } }) as Promise<RoomEvent>;
  }
  async setPresence(state: AgentState): Promise<void> {
    this.state = state;
    await this.request(`/rooms/${this.config.roomCode}/presence`, { method: "POST", body: { participantId: this.config.participantId, state } });
  }
  async heartbeat(): Promise<void> { await this.setPresence(this.state); }
  async createTask(input: { title: string; description?: string; dependencies?: string[]; priority?: number; acceptanceCriteria?: string[] }): Promise<Task> {
    return this.request(`/rooms/${this.config.roomCode}/tasks`, { method: "POST", body: input }) as Promise<Task>;
  }
  async availableTasks(): Promise<Task[]> { return this.request(`/rooms/${this.config.roomCode}/tasks/available`) as Promise<Task[]>; }
  async claimTask(taskId: string): Promise<Task> { return this.request(`/rooms/${this.config.roomCode}/tasks/${taskId}/claim`, { method: "POST", body: { participantId: this.config.participantId } }) as Promise<Task>; }
  async updateTask(taskId: string, status: Task["status"], result?: string): Promise<Task> { return this.request(`/rooms/${this.config.roomCode}/tasks/${taskId}/status`, { method: "POST", body: { participantId: this.config.participantId, status, result } }) as Promise<Task>; }
  async poll(): Promise<RoomEvent[]> {
    const events = await this.request(`/rooms/${this.config.roomCode}/events?after=${this.config.lastSequence}&participantId=${this.config.participantId}`) as RoomEvent[];
    for (const event of events) { this.config.lastSequence = Math.max(this.config.lastSequence, event.sequence); this.callbacks.onEvent?.(event); }
    return events;
  }
  start(intervalMs = 1_000): void {
    if (this.timer) return;
    const tick = async () => { try { await this.heartbeat(); await this.poll(); } catch (error: unknown) { this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error))); } };
    void tick(); this.timer = setInterval(() => void tick(), intervalMs);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async request(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<unknown> {
    const response = await fetch(`${this.config.hubUrl}${path}`, { method: options.method ?? "GET", headers: options.body ? { "content-type": "application/json" } : undefined, body: options.body ? JSON.stringify(options.body) : undefined });
    if (!response.ok) throw new Error(`Hub request failed (${response.status}): ${await response.text()}`);
    return response.status === 204 ? undefined : response.json();
  }
}

export async function joinRunner(hubUrl: string, roomCode: string, name: string, agent: string): Promise<RunnerConfig> {
  const response = await fetch(`${hubUrl}/rooms/${roomCode}/participants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, agent }) });
  if (!response.ok) throw new Error(`Could not join room: ${await response.text()}`);
  const participant = await response.json() as Participant;
  return { hubUrl, roomCode, participantId: participant.id, name, agent, lastSequence: 0 };
}

export class AgentTaskExecutor {
  constructor(private readonly runner: MirevaRunner, private readonly adapter: AgentAdapter) {}
  async execute(task: Task, workingDirectory: string, context: string[] = []): Promise<void> {
    const request: AgentExecutionRequest = { taskId: task.id, title: task.title, instructions: task.description, workingDirectory, context };
    await this.runner.setPresence("WORKING");
    await this.runner.updateTask(task.id, "RUNNING");
    try {
      await this.adapter.executeTask(request);
      for await (const event of this.adapter.streamEvents(task.id)) await this.runner.publish("MESSAGE", { taskId: task.id, adapter: this.adapter.id, event });
      const result = await this.adapter.getResult(task.id);
      if (result?.status === "COMPLETED") await this.runner.updateTask(task.id, "REVIEW", result.summary);
      else await this.runner.updateTask(task.id, "FAILED", result?.summary ?? "O agente não retornou uma entrega");
    } catch (error: unknown) { await this.runner.updateTask(task.id, "FAILED", error instanceof Error ? error.message : String(error)); throw error; }
    finally { await this.runner.setPresence("AVAILABLE"); }
  }
}

export class RunnerTaskWorker {
  constructor(private readonly runner: MirevaRunner, private readonly adapter: AgentAdapter, private readonly workingDirectory: string) {}
  async runOnce(context: string[] = []): Promise<string | undefined> {
    const tasks = await this.runner.availableTasks();
    for (const task of tasks) {
      try { const claimed = await this.runner.claimTask(task.id); await new AgentTaskExecutor(this.runner, this.adapter).execute(claimed, this.workingDirectory, context); return task.id; }
      catch (error: unknown) { if (!(error instanceof Error) || !error.message.includes("409")) throw error; }
    }
    return undefined;
  }
}
