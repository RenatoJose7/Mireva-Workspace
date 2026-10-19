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
  async createTask(code: string, input: Omit<Task, "id" | "roomId" | "status" | "createdAt" | "updatedAt" | "assignedParticipantId">): Promise<Task | undefined> {
    const found = this.data.rooms[code]; if (!found) return undefined;
    if (!input.dependencies.every((id) => found.tasks.some((task) => task.id === id))) throw new Error("Unknown task dependency");
    const timestamp = now(); const task: Task = { ...input, id: randomUUID(), roomId: found.room.id, status: input.dependencies.length ? "BACKLOG" : "READY", assignedParticipantId: null, createdAt: timestamp, updatedAt: timestamp };
    found.tasks.push(task); await this.append(found, "TASK_CREATED", null, { task }); await this.save(); return structuredClone(task);
  }
  private async append(room: StoredRoom, kind: RoomEvent["kind"], participantId: string | null, payload: Record<string, unknown>): Promise<RoomEvent> {
    const event: RoomEvent = { id: randomUUID(), roomId: room.room.id, sequence: ++room.lastSequence, kind, participantId, payload, createdAt: now() };
    room.events.push(event); return event;
  }
  private async save(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => { await mkdir(dirname(this.filename), { recursive: true }); const temp = `${this.filename}.tmp`; await writeFile(temp, JSON.stringify(this.data, null, 2)); await rename(temp, this.filename); });
    return this.writeChain;
  }
}
