import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentState, HubSnapshot, OrchestrationPlanRecord, Participant, PermissionProfile, ProviderUsage, Room, RoomEvent, Task } from "@mireva/protocol";

interface StoredRoom extends HubSnapshot { events: RoomEvent[] }
interface StoreFile { rooms: Record<string, StoredRoom> }
const initial = (): StoreFile => ({ rooms: {} });
const now = () => new Date().toISOString();
const roomCode = () => randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();

export class LocalHubStore {
  private data: StoreFile = initial();
  private writeChain = Promise.resolve();
  constructor(private readonly filename: string) {}
  async load(): Promise<void> {
    try { this.data = JSON.parse(await readFile(this.filename, "utf8")) as StoreFile; }
    catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  async createRoom(name: string, ownerName: string): Promise<{ room: Room; owner: Participant }> {
    const id = randomUUID(); const ownerId = randomUUID(); const createdAt = now();
    const room: Room = { id, code: roomCode(), name, ownerId, createdAt };
    const owner: Participant = { id: ownerId, roomId: id, name: ownerName, agent: "human", state: "AVAILABLE", role: "GENERAL", capabilities: [], permissionProfile: "READ_ONLY", usage: null, joinedAt: createdAt, lastSeenAt: createdAt };
    this.data.rooms[room.code] = { room, participants: [owner], tasks: [], plans: [], projectMemory: "", events: [], lastSequence: 0 };
    await this.save(); return { room, owner };
  }
  async snapshot(code: string): Promise<HubSnapshot | undefined> {
    const found = this.data.rooms[code]; if (!found) return undefined;
    await this.refreshPresence(found);
    found.tasks ??= [];
    found.plans ??= [];
    found.projectMemory ??= "";
    found.events ??= [];
    const { events: _events, ...snapshot } = found; return structuredClone(snapshot);
  }
  async join(code: string, name: string, agent: string, role: Participant["role"] = "GENERAL", capabilities: string[] = [], permissionProfile: PermissionProfile = "PROJECT"): Promise<Participant | undefined> {
    const found = this.data.rooms[code]; if (!found) return undefined;
    found.tasks ??= [];
    found.events ??= [];
    if (found.participants.length >= 6) throw new Error("Room capacity reached");
    const participant: Participant = { id: randomUUID(), roomId: found.room.id, name, agent, state: "AVAILABLE", role, capabilities, permissionProfile, usage: null, joinedAt: now(), lastSeenAt: now() };
    found.participants.push(participant); await this.append(found, "PARTICIPANT_JOINED", participant.id, { participant }); await this.save(); return structuredClone(participant);
  }
  async presence(code: string, participantId: string, state: AgentState): Promise<boolean> {
    const found = this.data.rooms[code]; const participant = found?.participants.find((p) => p.id === participantId);
    if (!found || !participant) return false;
    participant.state = state; participant.lastSeenAt = now(); await this.append(found, "PRESENCE", participantId, { state }); await this.save(); return true;
  }
  async configureParticipant(code: string, participantId: string, ownerId: string, role: Participant["role"], capabilities: string[], permissionProfile: PermissionProfile): Promise<Participant | undefined> {
    const found = this.data.rooms[code]; if (!found || found.room.ownerId !== ownerId) return undefined;
    const participant = found.participants.find((entry) => entry.id === participantId); if (!participant) return undefined;
    participant.role = role; participant.capabilities = capabilities; participant.permissionProfile = permissionProfile; await this.append(found, "PARTICIPANT_CONFIGURED", ownerId, { participant }); await this.save(); return structuredClone(participant);
  }
  async reportUsage(code: string, participantId: string, reporterId: string, input: Omit<ProviderUsage, "reportedAt">): Promise<Participant | undefined> {
    const found = this.data.rooms[code]; if (!found) return undefined;
    const participant = found.participants.find((entry) => entry.id === participantId); if (!participant) return undefined;
    if (reporterId !== participantId && reporterId !== found.room.ownerId) return undefined;
    participant.usage = { used: input.used, limit: input.limit, unit: input.unit, resetAt: input.resetAt, reportedAt: now() };
    await this.append(found, "USAGE_REPORTED", reporterId, { participantId, usage: participant.usage }); await this.save(); return structuredClone(participant);
  }
  async event(code: string, participantId: string, kind: RoomEvent["kind"], payload: Record<string, unknown>): Promise<RoomEvent | undefined> {
    const found = this.data.rooms[code]; if (!found || !found.participants.some((p) => p.id === participantId)) return undefined;
    const event = await this.append(found, kind, participantId, payload); await this.save(); return structuredClone(event);
  }
  async updateProjectMemory(code: string, ownerId: string, content: string): Promise<string | undefined> {
    const found = this.data.rooms[code]; if (!found || found.room.ownerId !== ownerId) return undefined;
    found.projectMemory = content; await this.append(found, "PROJECT_MEMORY_UPDATED", ownerId, { length: content.length }); await this.save(); return content;
  }
  async events(code: string, after: number): Promise<RoomEvent[] | undefined> { const room = this.data.rooms[code]; if (!room) return undefined; await this.refreshPresence(room); return structuredClone(room.events.filter((event) => event.sequence > after)); }
  async createTask(code: string, input: Omit<Task, "id" | "roomId" | "status" | "createdAt" | "updatedAt" | "assignedParticipantId" | "result" | "attempts">): Promise<Task | undefined> {
    const found = this.data.rooms[code]; if (!found) return undefined;
    found.tasks ??= [];
    found.events ??= [];
    if (!input.dependencies.every((id) => found.tasks.some((task) => task.id === id))) throw new Error("Unknown task dependency");
    const timestamp = now(); const task: Task = { ...input, id: randomUUID(), roomId: found.room.id, status: input.dependencies.length ? "BACKLOG" : "READY", assignedParticipantId: null, result: null, attempts: 0, createdAt: timestamp, updatedAt: timestamp };
    found.tasks.push(task); await this.append(found, "TASK_CREATED", null, { task }); await this.save(); return structuredClone(task);
  }
  async createPlan(code: string, participantId: string, input: { request: string; summary: string; tasks: OrchestrationPlanRecord["tasks"] }): Promise<OrchestrationPlanRecord | undefined> {
    const found = this.data.rooms[code]; if (!found || !found.participants.some((participant) => participant.id === participantId)) return undefined;
    found.plans ??= []; const timestamp = now(); const plan: OrchestrationPlanRecord = { id: randomUUID(), roomId: found.room.id, request: input.request, summary: input.summary, status: "DRAFT", tasks: input.tasks, generatedTaskIds: [], createdAt: timestamp, updatedAt: timestamp };
    found.plans.push(plan); await this.append(found, "PLAN_CREATED", participantId, { plan }); await this.save(); return structuredClone(plan);
  }
  async decidePlan(code: string, planId: string, ownerId: string, status: "APPROVED" | "REJECTED"): Promise<OrchestrationPlanRecord | undefined> {
    const found = this.data.rooms[code]; if (!found || found.room.ownerId !== ownerId) return undefined; found.plans ??= []; found.tasks ??= []; const plan = found.plans.find((entry) => entry.id === planId);
    if (!plan) return undefined; if (plan.status !== "DRAFT") throw new Error("Plan is no longer awaiting decision");
    plan.status = status; plan.updatedAt = now();
    if (status === "APPROVED") { const created: Task[] = []; for (const item of plan.tasks) { if (!item.dependencies.every((dependency) => Number.isInteger(dependency) && dependency >= 0 && dependency < created.length)) throw new Error("Invalid plan dependency"); const timestamp = now(); const task: Task = { id: randomUUID(), roomId: found.room.id, title: item.title, description: item.description, dependencies: item.dependencies.map((dependency) => created[dependency]!.id), priority: item.priority, requiredCapabilities: item.requiredCapabilities ?? [], acceptanceCriteria: item.acceptanceCriteria, maxAttempts: 3, status: item.dependencies.length ? "BACKLOG" : "READY", assignedParticipantId: null, result: null, attempts: 0, createdAt: timestamp, updatedAt: timestamp }; created.push(task); found.tasks.push(task); await this.append(found, "TASK_CREATED", null, { task, planId: plan.id }); } plan.generatedTaskIds = created.map((task) => task.id); }
    await this.append(found, "PLAN_CREATED", ownerId, { plan, decision: status }); await this.save(); return structuredClone(plan);
  }
  async claimTask(code: string, taskId: string, participantId: string): Promise<Task | undefined> {
    const found = this.data.rooms[code]; if (!found) return undefined; found.tasks ??= []; const task = found.tasks.find((entry) => entry.id === taskId);
    if (!task || !found.participants.some((entry) => entry.id === participantId)) return undefined;
    if (task.status !== "READY" || task.assignedParticipantId) throw new Error("Task is not available");
    task.status = "CLAIMED"; task.assignedParticipantId = participantId; task.attempts += 1; task.updatedAt = now();
    await this.append(found, "TASK_UPDATED", participantId, { task }); await this.save(); return structuredClone(task);
  }
  async updateTask(code: string, taskId: string, participantId: string, status: Task["status"], result?: string): Promise<Task | undefined> {
    const found = this.data.rooms[code]; if (!found) return undefined; found.tasks ??= []; const task = found.tasks.find((entry) => entry.id === taskId);
    if (!task || task.assignedParticipantId !== participantId) return undefined;
    const allowed: Record<Task["status"], Task["status"][]> = { BACKLOG: [], READY: [], CLAIMED: ["RUNNING", "BLOCKED", "CANCELLED"], RUNNING: ["REVIEW", "FAILED", "BLOCKED", "WAITING_APPROVAL"], REVIEW: ["DONE", "FAILED", "WAITING_APPROVAL"], DONE: [], FAILED: [], BLOCKED: ["READY", "CANCELLED"], CANCELLED: [], WAITING_APPROVAL: ["RUNNING", "REVIEW", "CANCELLED"] };
    if (!allowed[task.status].includes(status)) throw new Error(`Invalid transition: ${task.status} to ${status}`);
    if (status === "FAILED" && task.attempts >= task.maxAttempts) task.status = "BLOCKED"; else task.status = status;
    task.result = result ?? task.result; task.updatedAt = now(); await this.append(found, "TASK_UPDATED", participantId, { task });
    if (task.status === "DONE") for (const candidate of found.tasks) if (candidate.status === "BACKLOG" && candidate.dependencies.every((id) => found.tasks.some((dependency) => dependency.id === id && dependency.status === "DONE"))) { candidate.status = "READY"; candidate.updatedAt = now(); await this.append(found, "TASK_UPDATED", null, { task: candidate }); }
    await this.save(); return structuredClone(task);
  }
  async reviewTask(code: string, taskId: string, ownerId: string, status: "DONE" | "WAITING_APPROVAL", result?: string): Promise<Task | undefined> {
    const found = this.data.rooms[code]; if (!found || found.room.ownerId !== ownerId) return undefined; found.tasks ??= []; const task = found.tasks.find((entry) => entry.id === taskId);
    if (!task) return undefined;
    if (task.status !== "REVIEW") throw new Error("Task is not awaiting review");
    task.status = status; task.result = result ?? task.result; task.updatedAt = now(); await this.append(found, "TASK_UPDATED", ownerId, { task, decision: status === "DONE" ? "APPROVED" : "CHANGES_REQUESTED" });
    if (task.status === "DONE") for (const candidate of found.tasks) if (candidate.status === "BACKLOG" && candidate.dependencies.every((id) => found.tasks.some((dependency) => dependency.id === id && dependency.status === "DONE"))) { candidate.status = "READY"; candidate.updatedAt = now(); await this.append(found, "TASK_UPDATED", null, { task: candidate }); }
    await this.save(); return structuredClone(task);
  }
  availableTasks(code: string): Task[] | undefined { const found = this.data.rooms[code]; if (!found) return undefined; found.tasks ??= []; return structuredClone(found.tasks.filter((task) => task.status === "READY").sort((a, b) => b.priority - a.priority)); }
  assignedTasks(code: string, participantId: string): Task[] | undefined { const found = this.data.rooms[code]; if (!found || !found.participants.some((participant) => participant.id === participantId)) return undefined; return structuredClone(found.tasks.filter((task) => task.status === "CLAIMED" && task.assignedParticipantId === participantId)); }
  async dispatchTasks(code: string, ownerId: string): Promise<Task[] | undefined> {
    const found = this.data.rooms[code]; if (!found || found.room.ownerId !== ownerId) return undefined; found.tasks ??= [];
    const assigned: Task[] = []; const activeStatuses = new Set<Task["status"]>(["CLAIMED", "RUNNING", "REVIEW", "WAITING_APPROVAL"]);
    const load = (participantId: string) => found.tasks.filter((task) => task.assignedParticipantId === participantId && activeStatuses.has(task.status)).length;
    for (const task of found.tasks.filter((entry) => entry.status === "READY").sort((a, b) => b.priority - a.priority)) {
      const candidates = found.participants.filter((participant) => participant.agent !== "human" && participant.state === "AVAILABLE" && task.requiredCapabilities.every((capability) => (participant.capabilities ?? []).includes(capability))).sort((a, b) => load(a.id) - load(b.id) || a.id.localeCompare(b.id));
      const target = candidates[0]; if (!target) continue;
      task.status = "CLAIMED"; task.assignedParticipantId = target.id; task.attempts += 1; task.updatedAt = now(); assigned.push(task); await this.append(found, "TASK_UPDATED", target.id, { task, dispatch: true });
    }
    if (assigned.length) await this.save(); return structuredClone(assigned);
  }
  private async append(room: StoredRoom, kind: RoomEvent["kind"], participantId: string | null, payload: Record<string, unknown>): Promise<RoomEvent> {
    const event: RoomEvent = { id: randomUUID(), roomId: room.room.id, sequence: ++room.lastSequence, kind, participantId, payload, createdAt: now() };
    room.events.push(event); return event;
  }
  private async refreshPresence(room: StoredRoom): Promise<void> {
    const cutoff = Date.now() - 20_000; let changed = false;
    room.projectMemory ??= "";
    for (const participant of room.participants) { participant.role ??= "GENERAL"; participant.capabilities ??= []; participant.permissionProfile ??= participant.role === "ORCHESTRATOR" ? "READ_ONLY" : "PROJECT"; participant.usage ??= null; if (participant.state !== "DISCONNECTED" && Date.parse(participant.lastSeenAt) < cutoff) { participant.state = "DISCONNECTED"; await this.append(room, "PRESENCE", participant.id, { state: "DISCONNECTED" }); changed = true; } }
    for (const task of room.tasks) if (task.assignedParticipantId && ["CLAIMED", "RUNNING", "REVIEW"].includes(task.status) && room.participants.some((participant) => participant.id === task.assignedParticipantId && participant.state === "DISCONNECTED")) { task.status = "BLOCKED"; task.updatedAt = now(); await this.append(room, "TASK_UPDATED", null, { task, reason: "ASSIGNEE_DISCONNECTED" }); changed = true; }
    if (changed) await this.save();
  }
  private async save(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => { await mkdir(dirname(this.filename), { recursive: true }); const temp = `${this.filename}.tmp`; await writeFile(temp, JSON.stringify(this.data, null, 2)); await rename(temp, this.filename); });
    return this.writeChain;
  }
}
