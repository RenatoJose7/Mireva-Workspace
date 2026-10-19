import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentState, HubSnapshot, Participant, Room, RoomEvent, Task } from "@mireva/protocol";

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
    const owner: Participant = { id: ownerId, roomId: id, name: ownerName, agent: "human", state: "AVAILABLE", joinedAt: createdAt, lastSeenAt: createdAt };
    this.data.rooms[room.code] = { room, participants: [owner], tasks: [], events: [], lastSequence: 0 };
    await this.save(); return { room, owner };
  }
  snapshot(code: string): HubSnapshot | undefined {
    const found = this.data.rooms[code]; if (!found) return undefined;
    const { events: _events, ...snapshot } = found; return structuredClone(snapshot);
  }
  async join(code: string, name: string, agent: string): Promise<Participant | undefined> {
    const found = this.data.rooms[code]; if (!found) return undefined;
    if (found.participants.length >= 6) throw new Error("Room capacity reached");
    const participant: Participant = { id: randomUUID(), roomId: found.room.id, name, agent, state: "AVAILABLE", joinedAt: now(), lastSeenAt: now() };
    found.participants.push(participant); await this.append(found, "PARTICIPANT_JOINED", participant.id, { participant }); await this.save(); return structuredClone(participant);
  }
  async presence(code: string, participantId: string, state: AgentState): Promise<boolean> {
    const found = this.data.rooms[code]; const participant = found?.participants.find((p) => p.id === participantId);
    if (!found || !participant) return false;
    participant.state = state; participant.lastSeenAt = now(); await this.append(found, "PRESENCE", participantId, { state }); await this.save(); return true;
  }
  async event(code: string, participantId: string, kind: RoomEvent["kind"], payload: Record<string, unknown>): Promise<RoomEvent | undefined> {
    const found = this.data.rooms[code]; if (!found || !found.participants.some((p) => p.id === participantId)) return undefined;
    const event = await this.append(found, kind, participantId, payload); await this.save(); return structuredClone(event);
  }
  events(code: string, after: number): RoomEvent[] | undefined { const room = this.data.rooms[code]; return room && structuredClone(room.events.filter((event) => event.sequence > after)); }
  async createTask(code: string, input: Omit<Task, "id" | "roomId" | "status" | "createdAt" | "updatedAt" | "assignedParticipantId" | "result" | "attempts">): Promise<Task | undefined> {
    const found = this.data.rooms[code]; if (!found) return undefined;
    if (!input.dependencies.every((id) => found.tasks.some((task) => task.id === id))) throw new Error("Unknown task dependency");
    const timestamp = now(); const task: Task = { ...input, id: randomUUID(), roomId: found.room.id, status: input.dependencies.length ? "BACKLOG" : "READY", assignedParticipantId: null, result: null, attempts: 0, createdAt: timestamp, updatedAt: timestamp };
    found.tasks.push(task); await this.append(found, "TASK_CREATED", null, { task }); await this.save(); return structuredClone(task);
  }
  async claimTask(code: string, taskId: string, participantId: string): Promise<Task | undefined> {
    const found = this.data.rooms[code]; const task = found?.tasks.find((entry) => entry.id === taskId);
    if (!found || !task || !found.participants.some((entry) => entry.id === participantId)) return undefined;
    if (task.status !== "READY" || task.assignedParticipantId) throw new Error("Task is not available");
    task.status = "CLAIMED"; task.assignedParticipantId = participantId; task.attempts += 1; task.updatedAt = now();
    await this.append(found, "TASK_UPDATED", participantId, { task }); await this.save(); return structuredClone(task);
  }
  async updateTask(code: string, taskId: string, participantId: string, status: Task["status"], result?: string): Promise<Task | undefined> {
    const found = this.data.rooms[code]; const task = found?.tasks.find((entry) => entry.id === taskId);
    if (!found || !task || task.assignedParticipantId !== participantId) return undefined;
    const allowed: Record<Task["status"], Task["status"][]> = { BACKLOG: [], READY: [], CLAIMED: ["RUNNING", "BLOCKED", "CANCELLED"], RUNNING: ["REVIEW", "FAILED", "BLOCKED", "WAITING_APPROVAL"], REVIEW: ["DONE", "FAILED", "WAITING_APPROVAL"], DONE: [], FAILED: [], BLOCKED: ["READY", "CANCELLED"], CANCELLED: [], WAITING_APPROVAL: ["RUNNING", "REVIEW", "CANCELLED"] };
    if (!allowed[task.status].includes(status)) throw new Error(`Invalid transition: ${task.status} to ${status}`);
    if (status === "FAILED" && task.attempts >= task.maxAttempts) task.status = "BLOCKED"; else task.status = status;
    task.result = result ?? task.result; task.updatedAt = now(); await this.append(found, "TASK_UPDATED", participantId, { task });
    if (task.status === "DONE") for (const candidate of found.tasks) if (candidate.status === "BACKLOG" && candidate.dependencies.every((id) => found.tasks.some((dependency) => dependency.id === id && dependency.status === "DONE"))) { candidate.status = "READY"; candidate.updatedAt = now(); await this.append(found, "TASK_UPDATED", null, { task: candidate }); }
    await this.save(); return structuredClone(task);
  }
  availableTasks(code: string): Task[] | undefined { const found = this.data.rooms[code]; return found && structuredClone(found.tasks.filter((task) => task.status === "READY").sort((a, b) => b.priority - a.priority)); }
  private async append(room: StoredRoom, kind: RoomEvent["kind"], participantId: string | null, payload: Record<string, unknown>): Promise<RoomEvent> {
    const event: RoomEvent = { id: randomUUID(), roomId: room.room.id, sequence: ++room.lastSequence, kind, participantId, payload, createdAt: now() };
    room.events.push(event); return event;
  }
  private async save(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => { await mkdir(dirname(this.filename), { recursive: true }); const temp = `${this.filename}.tmp`; await writeFile(temp, JSON.stringify(this.data, null, 2)); await rename(temp, this.filename); });
    return this.writeChain;
  }
}
