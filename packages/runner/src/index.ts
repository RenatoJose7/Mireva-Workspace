import type { AgentAdapter, AgentExecutionRequest, AgentPlan, ProjectPlanningAdapter } from "@mireva/agent-adapters";
import type { AgentRole, AgentState, HubSnapshot, OrchestrationPlanRecord, Participant, PermissionProfile, RoomEvent, RunnerError, Task } from "@mireva/protocol";
import { spawn } from "node:child_process";

export interface RunnerConfig { hubUrl: string; roomCode: string; participantId: string; name: string; agent: string; role?: AgentRole; capabilities: string[]; lastSequence: number }
export interface RunnerCallbacks { onEvent?(event: RoomEvent): void; onError?(error: Error): void }
export type ClassifiedRunnerError = RunnerError & { state: AgentState; requiredPermission?: PermissionProfile };
export function classifyRunnerError(cause: unknown, operation: string, taskId: string | null = null): ClassifiedRunnerError {
  const technicalDetails = cause instanceof Error ? cause.stack ?? cause.message : String(cause); const text = technicalDetails.toLowerCase(); const occurredAt = new Date().toISOString();
  if (/auth|login|not authenticated|não autentic/.test(text)) return { code: "AUTH_REQUIRED", title: "Login necessário", message: "A IA precisa ser autenticada neste computador.", operation, retryable: true, suggestedAction: "Abra a IA no terminal, conclua o login e tente novamente.", taskId, technicalDetails, occurredAt, state: "AUTH_REQUIRED" };
  if (/429|rate.?limit|quota|credit|crédito|usage limit/.test(text)) return { code: "RATE_LIMITED", title: "Limite do provedor atingido", message: "O provedor interrompeu a execução por limite de uso.", operation, retryable: true, suggestedAction: "Aguarde a renovação do limite ou troque a IA responsável.", taskId, technicalDetails, occurredAt, state: "RATE_LIMITED" };
  if (/enotfound|econnrefused|network|internet|fetch failed|socket|dns/.test(text)) return { code: "NO_NETWORK", title: "Sem conexão", message: "A IA não conseguiu acessar a rede necessária para continuar.", operation, retryable: true, suggestedAction: "Verifique a internet e use o perfil Projeto + internet quando a tarefa precisar acessar URLs.", taskId, technicalDetails, occurredAt, state: "NO_NETWORK", requiredPermission: "PROJECT_NETWORK" };
  if (/permission|denied|approval|not allowed|blocked|sandbox|read.?only/.test(text)) return { code: "PERMISSION_REQUIRED", title: "Permissão necessária", message: "A política atual bloqueou uma ação solicitada pela tarefa.", operation, retryable: true, suggestedAction: "Libere acesso somente para esta tarefa ou altere o perfil da estação.", taskId, technicalDetails, occurredAt, state: "WAITING_PERMISSION", requiredPermission: "FULL" };
  if (/enoent|command not found|não encontrado|cannot find/.test(text)) return { code: "TOOL_MISSING", title: "Ferramenta não encontrada", message: "Um programa necessário não está instalado ou não está no PATH.", operation, retryable: true, suggestedAction: "Execute o diagnóstico da estação, instale a ferramenta indicada e tente novamente.", taskId, technicalDetails, occurredAt, state: "BLOCKED" };
  if (/timeout|tempo limite|timed out/.test(text)) return { code: "TIMEOUT", title: "Execução travada", message: "A execução ultrapassou o tempo máximo sem terminar.", operation, retryable: true, suggestedAction: "Confira o log e tente novamente. Se persistir, divida a tarefa em partes menores.", taskId, technicalDetails, occurredAt, state: "BLOCKED" };
  return { code: "EXECUTION_FAILED", title: "Execução interrompida", message: cause instanceof Error ? cause.message : String(cause), operation, retryable: true, suggestedAction: "Abra os detalhes técnicos, corrija a causa indicada e tente novamente.", taskId, technicalDetails, occurredAt, state: "BLOCKED" };
}

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
  async updateTask(taskId: string, status: Task["status"], result?: string, executionId?: string): Promise<Task> { return this.request(`/rooms/${this.config.roomCode}/tasks/${taskId}/status`, { method: "POST", body: { participantId: this.config.participantId, status, result, executionId } }) as Promise<Task>; }
  async recover(): Promise<Task[]> { return this.request(`/rooms/${this.config.roomCode}/participants/${this.config.participantId}/recover`, { method: "POST" }) as Promise<Task[]>; }
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

export async function joinRunner(hubUrl: string, roomCode: string, name: string, agent: string, capabilities: string[] = [], role: AgentRole = "GENERAL", permissionProfile: PermissionProfile = role === "ORCHESTRATOR" ? "READ_ONLY" : "PROJECT"): Promise<RunnerConfig> {
  const response = await fetch(`${hubUrl}/rooms/${roomCode}/participants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, agent, role, capabilities, permissionProfile }) });
  if (!response.ok) throw new Error(`Could not join room: ${await response.text()}`);
  const participant = await response.json() as Participant;
  return { hubUrl, roomCode, participantId: participant.id, name, agent, role, capabilities, lastSequence: 0 };
}

export class AgentTaskExecutor {
  constructor(private readonly runner: MirevaRunner, private readonly adapter: AgentAdapter) {}
  async execute(task: Task, workingDirectory: string, context: string[] = [], permissionProfile: PermissionProfile = "PROJECT"): Promise<void> {
    const request: AgentExecutionRequest = { taskId: task.id, title: task.title, instructions: task.description, workingDirectory, context, permissionProfile };
    await this.runner.setPresence("EXECUTING");
    await this.runner.updateTask(task.id, "RUNNING", undefined, task.executionId ?? undefined);
    const heartbeat = setInterval(() => void this.runner.heartbeat().catch(() => undefined), 5_000);
    let finalState: AgentState = "AVAILABLE";
    let control: "cancel" | "intervene" | undefined;
    const checkControl = async () => {
      if (control) return;
      const events = await this.runner.events();
      const request = events.find((event) => (event.kind === "TASK_CANCEL_REQUESTED" || event.kind === "TASK_INTERVENTION") && event.payload.taskId === task.id && event.payload.targetParticipantId === this.runner.config.participantId);
      if (!request) return;
      control = request.kind === "TASK_CANCEL_REQUESTED" ? "cancel" : "intervene";
      await this.adapter.cancelTask(task.id);
    };
    try {
      await this.adapter.executeTask(request);
      for await (const event of this.adapter.streamEvents(task.id)) { await checkControl(); await this.runner.publish("MESSAGE", { taskId: task.id, adapter: this.adapter.id, event }); }
      await checkControl();
      const result = await this.adapter.getResult(task.id);
      if (control === "cancel") return;
      if (control === "intervene") { await this.runner.updateTask(task.id, "READY", "Correção recebida; aguardando nova atribuição.", task.executionId ?? undefined); return; }
      if (result) await this.runner.publish("MESSAGE", { taskId: task.id, adapter: this.adapter.id, delivery: { status: result.status, summary: result.summary, files: result.files, branch: result.branch } });
      if (result?.status === "COMPLETED") await this.runner.updateTask(task.id, "REVIEW", result.summary, task.executionId ?? undefined);
      else throw new Error(result?.summary ?? "O agente não retornou uma entrega");
    } catch (error: unknown) {
      const failure = classifyRunnerError(error, "EXECUTE_TASK", task.id); finalState = failure.state;
      await this.runner.publish("RUNNER_ERROR", { ...failure });
      if (failure.requiredPermission) { await this.runner.publish("PERMISSION_REQUESTED", { taskId: task.id, errorCode: failure.code, requiredPermission: failure.requiredPermission, reason: failure.message }); await this.runner.updateTask(task.id, "WAITING_APPROVAL", failure.message, task.executionId ?? undefined); }
      else await this.runner.updateTask(task.id, "FAILED", failure.message, task.executionId ?? undefined);
      throw error;
    } finally { clearInterval(heartbeat); await this.runner.setPresence(finalState); }
  }
}

export class RunnerTaskWorker {
  constructor(private readonly runner: MirevaRunner, private readonly adapter: AgentAdapter, private readonly workingDirectory: string) {}
  async runOnce(context: string[] = []): Promise<string | undefined> {
    const snapshot = await this.runner.snapshot();
    const memory = snapshot.projectMemory?.trim();
    const sharedContext = memory ? [...context, `Memória do projeto (siga estas decisões):\n${memory}`] : context;
    const assigned = await this.runner.assignedTasks();
    const participant = snapshot.participants.find((entry) => entry.id === this.runner.config.participantId);
    if (participant?.paused) return undefined;
    const basePermissionProfile = participant?.permissionProfile ?? "PROJECT";
    for (const task of assigned) { const permissionProfile = task.permissionProfileOverride ?? basePermissionProfile; await new AgentTaskExecutor(this.runner, this.adapter).execute(task, this.workingDirectory, sharedContext, permissionProfile); return task.id; }
    const capabilities = participant?.capabilities ?? this.runner.config.capabilities ?? [];
    const tasks = (await this.runner.availableTasks()).filter((task) => task.requiredCapabilities.every((capability) => capabilities.includes(capability)));
    for (const task of tasks) {
      try { const claimed = await this.runner.claimTask(task.id); const permissionProfile = claimed.permissionProfileOverride ?? basePermissionProfile; await new AgentTaskExecutor(this.runner, this.adapter).execute(claimed, this.workingDirectory, sharedContext, permissionProfile); return task.id; }
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
    const orchestrator = input.snapshot.participants.find((participant) => participant.role === "ORCHESTRATOR");
    return this.adapter.planProject({ request: input.request, workingDirectory: this.workingDirectory, projectContext, permissionProfile: orchestrator?.permissionProfile ?? "READ_ONLY" }) as Promise<AgentPlan>;
  }
}

export class DirectMessageWorker {
  constructor(private readonly runner: MirevaRunner, private readonly adapter: AgentAdapter, private readonly workingDirectory: string) {}
  async runOnce(): Promise<string | undefined> {
    const events = await this.runner.events();
    const handled = new Set(events.filter((event) => event.kind === "AGENT_RESPONSE").map((event) => String(event.payload.requestEventId ?? "")));
    const message = events.find((event) => event.kind === "AGENT_MESSAGE" && event.payload.targetParticipantId === this.runner.config.participantId && !handled.has(event.id) && typeof event.payload.message === "string");
    if (!message) return undefined;
    const snapshot = await this.runner.snapshot();
    const participant = snapshot.participants.find((entry) => entry.id === this.runner.config.participantId);
    const context = events.filter((event) => ["AGENT_MESSAGE", "AGENT_RESPONSE"].includes(event.kind) && event.payload.targetParticipantId === this.runner.config.participantId).slice(-12).map((event) => `${event.kind === "AGENT_MESSAGE" ? "Responsável" : participant?.name ?? "Agente"}: ${String(event.payload.message ?? "")}`);
    await this.runner.setPresence("THINKING");
    const heartbeat = setInterval(() => void this.runner.heartbeat().catch(() => undefined), 5_000);
    let finalState: AgentState = "AVAILABLE";
    try {
      const response = await this.adapter.respondToMessage({ message: String(message.payload.message), workingDirectory: this.workingDirectory, context, permissionProfile: participant?.permissionProfile ?? "PROJECT" });
      await this.runner.publish("AGENT_RESPONSE", { requestEventId: message.id, targetParticipantId: this.runner.config.participantId, message: response });
      return message.id;
    } catch (error: unknown) {
      const failure = classifyRunnerError(error, "DIRECT_MESSAGE"); finalState = failure.state; await this.runner.publish("RUNNER_ERROR", { ...failure });
      await this.runner.publish("AGENT_RESPONSE", { requestEventId: message.id, targetParticipantId: this.runner.config.participantId, message: `${failure.title}: ${failure.message}`, error: true });
      return message.id;
    } finally { clearInterval(heartbeat); await this.runner.setPresence(finalState); }
  }
}

type GitAction = "STATUS" | "CREATE_BRANCH" | "COMMIT";
const runGit = async (directory: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn("git", args, { cwd: directory, stdio: ["ignore", "pipe", "pipe"] }); let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); }); child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(output.trim() || `git terminou com código ${code}`)));
});

/** Executes only explicit, owner-requested local Git actions. It never pushes or merges. */
export class GitControlWorker {
  constructor(private readonly runner: MirevaRunner, private readonly workingDirectory: string) {}
  async runOnce(): Promise<string | undefined> {
    const events = await this.runner.events();
    const handled = new Set(events.filter((event) => event.kind === "GIT_RESPONSE").map((event) => String(event.payload.requestEventId ?? "")));
    const request = events.find((event) => event.kind === "GIT_COMMAND" && event.payload.targetParticipantId === this.runner.config.participantId && !handled.has(event.id));
    if (!request) return undefined;
    const action = String(request.payload.action ?? "") as GitAction;
    try {
      if (!["STATUS", "CREATE_BRANCH", "COMMIT"].includes(action)) throw new Error("Ação Git não permitida");
      await this.runner.setPresence("EXECUTING");
      let output = "";
      if (action === "STATUS") {
        const [branch, status, diff, check] = await Promise.all([runGit(this.workingDirectory, ["branch", "--show-current"]), runGit(this.workingDirectory, ["status", "--short"]), runGit(this.workingDirectory, ["diff", "--stat"]), runGit(this.workingDirectory, ["diff", "--check"])]);
        output = `Branch: ${branch || "(detached)"}\n\nAlterações:\n${status || "Nenhuma"}\n\nResumo:\n${diff || "Nenhuma"}\n\nVerificação:\n${check || "Sem conflitos de espaço"}`;
      }
      if (action === "CREATE_BRANCH") {
        const branch = String(request.payload.branch ?? "").trim();
        if (!/^mireva\/[a-z0-9][a-z0-9._/-]{0,70}$/i.test(branch) || branch.includes("..") || branch.endsWith("/")) throw new Error("Use um nome como mireva/landing-home");
        output = await runGit(this.workingDirectory, ["switch", "-c", branch]);
      }
      if (action === "COMMIT") {
        const message = String(request.payload.message ?? "").trim();
        if (!message || message.length > 160) throw new Error("Informe uma mensagem de commit de até 160 caracteres");
        await runGit(this.workingDirectory, ["add", "-A"]); output = await runGit(this.workingDirectory, ["commit", "-m", message]);
      }
      const branch = await runGit(this.workingDirectory, ["branch", "--show-current"]);
      await this.runner.publish("GIT_RESPONSE", { requestEventId: request.id, targetParticipantId: this.runner.config.participantId, action, ok: true, branch, output });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.runner.publish("GIT_RESPONSE", { requestEventId: request.id, targetParticipantId: this.runner.config.participantId, action, ok: false, error: message });
      await this.runner.publish("RUNNER_ERROR", { ...classifyRunnerError(error, "GIT_CONTROL"), operation: "GIT_CONTROL" });
    } finally { await this.runner.setPresence("AVAILABLE"); }
    return request.id;
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
    const teamConversation = events.filter((event) => ["AGENT_MESSAGE", "AGENT_RESPONSE"].includes(event.kind)).slice(-10).map((event) => `${event.kind === "AGENT_MESSAGE" ? "Responsável" : "Estação"}: ${String(event.payload.message ?? "")}`).join("\n");
    const contextualRequest = conversation ? `Conversa recente:\n${conversation}${teamConversation ? `\n\nConversas recentes com as estações:\n${teamConversation}` : ""}\n\nResponda à última mensagem do responsável.` : request;
    await this.runner.setPresence("THINKING");
    // Planning may outlive the Hub's presence timeout while the provider
    // inspects the project. Keep the orchestrator visibly connected.
    const heartbeat = setInterval(() => void this.runner.heartbeat().catch(() => undefined), 5_000);
    let finalState: AgentState = "AVAILABLE";
    try {
      const response = await this.orchestrator.respond(contextualRequest, request);
      await this.runner.publish("ORCHESTRATOR_RESPONSE", { requestEventId: requestEvent.id, orchestrator: { summary: response.summary, planId: response.plan?.id, taskCount: response.plan?.tasks.length ?? 0 } });
      return { requestId: requestEvent.id, planId: response.plan?.id };
    } catch (error: unknown) {
      const failure = classifyRunnerError(error, "ORCHESTRATE"); finalState = failure.state; await this.runner.publish("RUNNER_ERROR", { ...failure });
      await this.runner.publish("ORCHESTRATOR_RESPONSE", { requestEventId: requestEvent.id, orchestrator: { summary: `${failure.title}: ${failure.message}`, error: true } });
      return { requestId: requestEvent.id, error: failure.message };
    } finally { clearInterval(heartbeat); await this.runner.setPresence(finalState); }
  }
}
