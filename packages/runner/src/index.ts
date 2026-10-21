import type { AgentAdapter, AgentExecutionRequest, AgentPlan, ProjectPlanningAdapter } from "@mireva/agent-adapters";
import type { AgentRole, AgentState, HubSnapshot, OrchestrationPlanRecord, Participant, RoomEvent, Task } from "@mireva/protocol";

export interface RunnerConfig { hubUrl: string; roomCode: string; participantId: string; name: string; agent: string; role?: AgentRole; capabilities: string[]; lastSequence: number }
export interface RunnerCallbacks { onEvent?(event: RoomEvent): void; onError?(error: Error): void }

export class MirevaRunner {
  private timer: NodeJS.Timeout | undefined;
  private state: AgentState = "AVAILABLE";
  constructor(public readonly config: RunnerConfig, private readonly callbacks: RunnerCallbacks = {}) {}

  async publish(kind: RoomEvent["kind"], payload: Record<string, unknown>): Promise<RoomEvent> {
    return this.request(`/rooms/${this.config.roomCode}/events`, { method: "POST", body: { participantId: this.config.participantId, kind, payload } }) as Promise<RoomEvent>;
  }
  async setPresence(state: AgentState): Promise<void> {
    this.state = state;
    await this.request(`/rooms/${this.config.roomCode}/presence`, { method: "POST", body: { participantId: this.config.participantId, state } });
  }
  async heartbeat(): Promise<void> { await this.setPresence(this.state); }
  async createTask(input: { title: string; description?: string; dependencies?: string[]; priority?: number; requiredCapabilities?: string[]; acceptanceCriteria?: string[] }): Promise<Task> {
    return this.request(`/rooms/${this.config.roomCode}/tasks`, { method: "POST", body: input }) as Promise<Task>;
  }
  async availableTasks(): Promise<Task[]> { return this.request(`/rooms/${this.config.roomCode}/tasks/available`) as Promise<Task[]>; }
  async assignedTasks(): Promise<Task[]> { return this.request(`/rooms/${this.config.roomCode}/tasks/assigned?participantId=${this.config.participantId}`) as Promise<Task[]>; }
  async dispatchTasks(): Promise<Task[]> { return this.request(`/rooms/${this.config.roomCode}/tasks/dispatch`, { method: "POST", body: { ownerId: this.config.participantId } }) as Promise<Task[]>; }
  async reportUsage(input: { used: number; limit: number; unit?: string; resetAt?: string | null }): Promise<Participant> {
    return this.request(`/rooms/${this.config.roomCode}/participants/${this.config.participantId}/usage`, { method: "POST", body: { reporterId: this.config.participantId, used: input.used, limit: input.limit, unit: input.unit ?? "créditos", resetAt: input.resetAt ?? null } }) as Promise<Participant>;
  }
  async snapshot(): Promise<HubSnapshot> { return this.request(`/rooms/${this.config.roomCode}`) as Promise<HubSnapshot>; }
  async createPlan(input: { request: string; summary: string; tasks: OrchestrationPlanRecord["tasks"] }): Promise<OrchestrationPlanRecord> { return this.request(`/rooms/${this.config.roomCode}/plans`, { method: "POST", body: { participantId: this.config.participantId, ...input } }) as Promise<OrchestrationPlanRecord>; }
  async decidePlan(planId: string, status: "APPROVED" | "REJECTED"): Promise<OrchestrationPlanRecord> { return this.request(`/rooms/${this.config.roomCode}/plans/${planId}/decision`, { method: "POST", body: { ownerId: this.config.participantId, status } }) as Promise<OrchestrationPlanRecord>; }
  async claimTask(taskId: string): Promise<Task> { return this.request(`/rooms/${this.config.roomCode}/tasks/${taskId}/claim`, { method: "POST", body: { participantId: this.config.participantId } }) as Promise<Task>; }
  async updateTask(taskId: string, status: Task["status"], result?: string): Promise<Task> { return this.request(`/rooms/${this.config.roomCode}/tasks/${taskId}/status`, { method: "POST", body: { participantId: this.config.participantId, status, result } }) as Promise<Task>; }
  async events(after = 0): Promise<RoomEvent[]> { return this.request(`/rooms/${this.config.roomCode}/events?after=${after}&participantId=${this.config.participantId}`) as Promise<RoomEvent[]>; }
  async poll(): Promise<RoomEvent[]> {
    const events = await this.events(this.config.lastSequence);
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

export async function joinRunner(hubUrl: string, roomCode: string, name: string, agent: string, capabilities: string[] = [], role: AgentRole = "GENERAL"): Promise<RunnerConfig> {
  const response = await fetch(`${hubUrl}/rooms/${roomCode}/participants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, agent, role, capabilities }) });
  if (!response.ok) throw new Error(`Could not join room: ${await response.text()}`);
  const participant = await response.json() as Participant;
  return { hubUrl, roomCode, participantId: participant.id, name, agent, role, capabilities, lastSequence: 0 };
}

export class AgentTaskExecutor {
  constructor(private readonly runner: MirevaRunner, private readonly adapter: AgentAdapter) {}
  async execute(task: Task, workingDirectory: string, context: string[] = []): Promise<void> {
    const request: AgentExecutionRequest = { taskId: task.id, title: task.title, instructions: task.description, workingDirectory, context };
    await this.runner.setPresence("WORKING");
    await this.runner.updateTask(task.id, "RUNNING");
    const heartbeat = setInterval(() => void this.runner.heartbeat().catch(() => undefined), 5_000);
    try {
      await this.adapter.executeTask(request);
      for await (const event of this.adapter.streamEvents(task.id)) await this.runner.publish("MESSAGE", { taskId: task.id, adapter: this.adapter.id, event });
      const result = await this.adapter.getResult(task.id);
      if (result) await this.runner.publish("MESSAGE", { taskId: task.id, adapter: this.adapter.id, delivery: { status: result.status, summary: result.summary, files: result.files, branch: result.branch } });
      if (result?.status === "COMPLETED") await this.runner.updateTask(task.id, "REVIEW", result.summary);
      else await this.runner.updateTask(task.id, "FAILED", result?.summary ?? "O agente não retornou uma entrega");
    } catch (error: unknown) { await this.runner.updateTask(task.id, "FAILED", error instanceof Error ? error.message : String(error)); throw error; }
    finally { clearInterval(heartbeat); await this.runner.setPresence("AVAILABLE"); }
  }
}

export class RunnerTaskWorker {
  constructor(private readonly runner: MirevaRunner, private readonly adapter: AgentAdapter, private readonly workingDirectory: string) {}
  async runOnce(context: string[] = []): Promise<string | undefined> {
    const memory = (await this.runner.snapshot()).projectMemory?.trim();
    const sharedContext = memory ? [...context, `Memória do projeto (siga estas decisões):\n${memory}`] : context;
    const assigned = await this.runner.assignedTasks();
    for (const task of assigned) { await new AgentTaskExecutor(this.runner, this.adapter).execute(task, this.workingDirectory, sharedContext); return task.id; }
    const participant = (await this.runner.snapshot()).participants.find((entry) => entry.id === this.runner.config.participantId);
    const capabilities = participant?.capabilities ?? this.runner.config.capabilities ?? [];
    const tasks = (await this.runner.availableTasks()).filter((task) => task.requiredCapabilities.every((capability) => capabilities.includes(capability)));
    for (const task of tasks) {
      try { const claimed = await this.runner.claimTask(task.id); await new AgentTaskExecutor(this.runner, this.adapter).execute(claimed, this.workingDirectory, sharedContext); return task.id; }
      catch (error: unknown) { if (!(error instanceof Error) || !error.message.includes("409")) throw error; }
    }
    return undefined;
  }
}

export interface PlannedTask { title: string; description: string; dependencies: number[]; priority?: number; requiredCapabilities?: string[]; acceptanceCriteria?: string[] }
export interface OrchestrationPlan { summary: string; tasks: PlannedTask[] }
export interface ProjectPlanner { plan(input: { request: string; snapshot: HubSnapshot }): Promise<OrchestrationPlan> }

export class AdapterProjectPlanner implements ProjectPlanner {
  constructor(private readonly adapter: ProjectPlanningAdapter, private readonly workingDirectory: string) {}
  async plan(input: { request: string; snapshot: HubSnapshot }): Promise<OrchestrationPlan> {
    const projectContext = JSON.stringify({ room: input.snapshot.room.name, projectMemory: input.snapshot.projectMemory ?? "", agents: input.snapshot.participants.map((participant) => ({ name: participant.name, agent: participant.agent, state: participant.state, capabilities: participant.capabilities ?? [] })), currentTasks: input.snapshot.tasks.filter((task) => !["DONE", "CANCELLED"].includes(task.status)).map((task) => ({ title: task.title, status: task.status, requiredCapabilities: task.requiredCapabilities, dependencies: task.dependencies })) }, null, 2);
    return this.adapter.planProject({ request: input.request, workingDirectory: this.workingDirectory, projectContext }) as Promise<AgentPlan>;
  }
}

export class MirevaOrchestrator {
  constructor(private readonly runner: MirevaRunner, private readonly planner: ProjectPlanner) {}
  async respond(request: string, originalRequest = request): Promise<{ summary: string; plan?: OrchestrationPlanRecord }> {
    const plan = await this.planner.plan({ request, snapshot: await this.runner.snapshot() });
    for (const [index, item] of plan.tasks.entries()) {
      if (!item.title.trim() || !item.dependencies.every((dependency) => Number.isInteger(dependency) && dependency >= 0 && dependency < index)) throw new Error(`Plano inválido na tarefa ${index + 1}`);
    }
    if (!plan.tasks.length) return { summary: plan.summary };
    return { summary: plan.summary, plan: await this.runner.createPlan({ request: originalRequest, summary: plan.summary, tasks: plan.tasks.map((item) => ({ ...item, priority: item.priority ?? 50, requiredCapabilities: item.requiredCapabilities ?? [], acceptanceCriteria: item.acceptanceCriteria ?? [] })) }) };
  }
  async planAndPropose(request: string): Promise<OrchestrationPlanRecord> {
    const response = await this.respond(request);
    if (!response.plan) throw new Error("O orquestrador precisa de mais informações antes de criar o plano");
    return response.plan;
  }
}

export class OrchestratorWorker {
  constructor(private readonly runner: MirevaRunner, private readonly orchestrator: MirevaOrchestrator) {}
  async runOnce(): Promise<{ requestId?: string; planId?: string; error?: string }> {
    const events = await this.runner.events();
    const handled = new Set(events.filter((event) => event.kind === "ORCHESTRATOR_RESPONSE").map((event) => String(event.payload.requestEventId ?? "")));
    const requestEvent = events.find((event) => event.kind === "ORCHESTRATOR_REQUEST" && !handled.has(event.id) && typeof event.payload.message === "string" && event.payload.message.trim());
    if (!requestEvent) return {};
    const request = String(requestEvent.payload.message).trim();
    if (/^(oi|olá|ola|eai|e aí|bom dia|boa tarde|boa noite)[!.?\s]*$/i.test(request)) {
      await this.runner.publish("ORCHESTRATOR_RESPONSE", { requestEventId: requestEvent.id, orchestrator: { summary: "Olá! Vamos planejar juntos. Me conte o que você quer construir, para quem é o projeto e qual resultado espera alcançar." } });
      return { requestId: requestEvent.id };
    }
    const conversation = events.filter((event) => ["ORCHESTRATOR_REQUEST", "ORCHESTRATOR_RESPONSE"].includes(event.kind)).slice(-12).map((event) => event.kind === "ORCHESTRATOR_REQUEST" ? `Responsável: ${String(event.payload.message ?? "")}` : `Orquestrador: ${String((event.payload.orchestrator as { summary?: string } | undefined)?.summary ?? "")}`).join("\n");
    const contextualRequest = conversation ? `Conversa recente:\n${conversation}\n\nResponda à última mensagem do responsável.` : request;
    await this.runner.setPresence("RESEARCHING");
    // Planning may outlive the Hub's presence timeout while the provider
    // inspects the project. Keep the orchestrator visibly connected.
    const heartbeat = setInterval(() => void this.runner.heartbeat().catch(() => undefined), 5_000);
    try {
      const response = await this.orchestrator.respond(contextualRequest, request);
      await this.runner.publish("ORCHESTRATOR_RESPONSE", { requestEventId: requestEvent.id, orchestrator: { summary: response.summary, planId: response.plan?.id, taskCount: response.plan?.tasks.length ?? 0 } });
      return { requestId: requestEvent.id, planId: response.plan?.id };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.runner.publish("ORCHESTRATOR_RESPONSE", { requestEventId: requestEvent.id, orchestrator: { summary: `Não foi possível responder: ${message}`, error: true } });
      return { requestId: requestEvent.id, error: message };
    } finally { clearInterval(heartbeat); await this.runner.setPresence("AVAILABLE"); }
  }
}
