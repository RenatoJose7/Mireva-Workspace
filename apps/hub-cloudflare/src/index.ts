import { claimTaskSchema, createRoomSchema, createTaskSchema, joinRoomSchema, postEventSchema, reviewTaskSchema, updateTaskSchema, type AgentState, type Participant, type RoomEvent, type Task } from "@mireva/protocol";

export interface Env { ROOM: DurableObjectNamespace }
interface RoomState { id: string; code: string; name: string; ownerId: string; createdAt: string; participants: Participant[]; tasks: Task[]; events: RoomEvent[]; lastSequence: number }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
const now = () => new Date().toISOString();

export class Room implements DurableObject {
  constructor(private state: DurableObjectState) {}
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    let room = await this.state.storage.get<RoomState>("room");
    try {
      if (request.method === "POST" && path === "/create") {
        if (room) return json({ error: "Room already exists" }, 409);
        const input = createRoomSchema.parse(await request.json()); const time = now(); const ownerId = crypto.randomUUID();
        room = { id: crypto.randomUUID(), code: new URL(request.url).searchParams.get("code")!, name: input.name, ownerId, createdAt: time, participants: [{ id: ownerId, roomId: "", name: input.ownerName, agent: "human", state: "AVAILABLE", joinedAt: time, lastSeenAt: time }], tasks: [], events: [], lastSequence: 0 }; room.participants[0]!.roomId = room.id; await this.save(room); return json({ room: { id: room.id, code: room.code, name: room.name, ownerId: room.ownerId, createdAt: room.createdAt }, owner: room.participants[0] }, 201);
      }
      if (!room) return json({ error: "Room not found" }, 404);
      if (!Array.isArray(room.tasks)) room.tasks = [];
      if (!Array.isArray(room.events)) room.events = [];
      if (!Array.isArray(room.participants)) room.participants = [];
      await this.refreshPresence(room);
      if (request.method === "GET" && path === "/") return json(this.snapshot(room));
      if (request.method === "POST" && path === "/participants") { const input = joinRoomSchema.parse(await request.json()); const participant: Participant = { id: crypto.randomUUID(), roomId: room.id, name: input.name, agent: input.agent, state: "AVAILABLE", joinedAt: now(), lastSeenAt: now() }; room.participants.push(participant); this.event(room, "PARTICIPANT_JOINED", participant.id, { participant }); await this.save(room); return json(participant, 201); }
      if (request.method === "GET" && path === "/events") return json(room.events.filter((e) => e.sequence > Number(new URL(request.url).searchParams.get("after") ?? 0)));
      if (request.method === "POST" && path === "/events") { const body = await request.json() as { participantId: string }; const input = postEventSchema.parse(body); if (!room.participants.some((p) => p.id === body.participantId)) return json({ error: "Participant not found" }, 404); const event = this.event(room, input.kind, body.participantId, input.payload); await this.save(room); return json(event, 201); }
      if (request.method === "POST" && path === "/presence") { const body = await request.json() as { participantId: string; state: AgentState }; const participant = room.participants.find((p) => p.id === body.participantId); if (!participant) return json({ error: "Participant not found" }, 404); participant.state = body.state; participant.lastSeenAt = now(); this.event(room, "PRESENCE", participant.id, { state: body.state }); await this.save(room); return new Response(null, { status: 204 }); }
      if (request.method === "POST" && path === "/tasks") { const input = createTaskSchema.parse(await request.json()); const tasks = room.tasks; if (!input.dependencies.every((id) => tasks.some((task) => task.id === id))) return json({ error: "Unknown task dependency" }, 400); const time = now(); const task: Task = { ...input, id: crypto.randomUUID(), roomId: room.id, status: input.dependencies.length ? "BACKLOG" : "READY", assignedParticipantId: null, result: null, attempts: 0, createdAt: time, updatedAt: time }; tasks.push(task); this.event(room, "TASK_CREATED", null, { task }); await this.save(room); return json(task, 201); }
      if (request.method === "GET" && path === "/tasks/available") return json(room.tasks.filter((task) => task.status === "READY").sort((a, b) => b.priority - a.priority));
      const decision = path.match(/^\/tasks\/([^/]+)\/decision$/);
      if (request.method === "POST" && decision) { const input = reviewTaskSchema.parse(await request.json()); const task = room.tasks.find((entry) => entry.id === decision[1]); if (!task) return json({ error: "Task not found" }, 404); if (input.ownerId !== room.ownerId) return json({ error: "Only the room owner can decide" }, 403); if (task.status !== "REVIEW") return json({ error: "Task is not awaiting review" }, 409); task.status = input.status; task.result = input.result ?? task.result; task.updatedAt = now(); this.event(room, "TASK_UPDATED", input.ownerId, { task, decision: input.status === "DONE" ? "APPROVED" : "CHANGES_REQUESTED" }); if (task.status === "DONE") for (const next of room.tasks) if (next.status === "BACKLOG" && next.dependencies.every((id) => room!.tasks.some((dependency) => dependency.id === id && dependency.status === "DONE"))) { next.status = "READY"; next.updatedAt = now(); this.event(room, "TASK_UPDATED", null, { task: next }); } await this.save(room); return json(task); }
      const match = path.match(/^\/tasks\/([^/]+)\/(claim|status)$/);
      if (request.method === "POST" && match) { const task = room.tasks.find((entry) => entry.id === match[1]); if (!task) return json({ error: "Task not found" }, 404); const body = await request.json(); if (match[2] === "claim") { const { participantId } = claimTaskSchema.parse(body); if (task.status !== "READY" || task.assignedParticipantId) return json({ error: "Task is not available" }, 409); task.status = "CLAIMED"; task.assignedParticipantId = participantId; task.attempts += 1; task.updatedAt = now(); this.event(room, "TASK_UPDATED", participantId, { task }); await this.save(room); return json(task); } const { participantId, status, result } = updateTaskSchema.parse(body); if (task.assignedParticipantId !== participantId) return json({ error: "Task is assigned to another runner" }, 409); const transitions: Record<Task["status"], Task["status"][]> = { BACKLOG: [], READY: [], CLAIMED: ["RUNNING", "BLOCKED", "CANCELLED"], RUNNING: ["REVIEW", "FAILED", "BLOCKED", "WAITING_APPROVAL"], REVIEW: ["DONE", "FAILED", "WAITING_APPROVAL"], DONE: [], FAILED: [], BLOCKED: ["READY", "CANCELLED"], CANCELLED: [], WAITING_APPROVAL: ["RUNNING", "REVIEW", "CANCELLED"] }; if (!transitions[task.status].includes(status)) return json({ error: "Invalid task transition" }, 409); task.status = status; task.result = result ?? task.result; task.updatedAt = now(); this.event(room, "TASK_UPDATED", participantId, { task }); if (status === "DONE") for (const next of room.tasks) if (next.status === "BACKLOG" && next.dependencies.every((id) => room!.tasks.some((dependency) => dependency.id === id && dependency.status === "DONE"))) { next.status = "READY"; next.updatedAt = now(); this.event(room, "TASK_UPDATED", null, { task: next }); } await this.save(room); return json(task); }
      return json({ error: "Not found" }, 404);
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Bad request" }, 400); }
  }
  private event(room: RoomState, kind: RoomEvent["kind"], participantId: string | null, payload: Record<string, unknown>): RoomEvent { if (!Array.isArray(room.events)) room.events = []; const event: RoomEvent = { id: crypto.randomUUID(), roomId: room.id, sequence: ++room.lastSequence, kind, participantId, payload, createdAt: now() }; room.events.push(event); return event; }
  private snapshot(room: RoomState) { return { room: { id: room.id, code: room.code, name: room.name, ownerId: room.ownerId, createdAt: room.createdAt }, participants: room.participants, tasks: room.tasks, lastSequence: room.lastSequence }; }
  private save(room: RoomState) { return this.state.storage.put("room", room); }
  private async refreshPresence(room: RoomState): Promise<void> {
    const cutoff = Date.now() - 20_000; let changed = false;
    for (const participant of room.participants) if (participant.state !== "DISCONNECTED" && Date.parse(participant.lastSeenAt) < cutoff) { participant.state = "DISCONNECTED"; this.event(room, "PRESENCE", participant.id, { state: "DISCONNECTED" }); changed = true; }
    for (const task of room.tasks) if (task.assignedParticipantId && ["CLAIMED", "RUNNING", "REVIEW"].includes(task.status) && room.participants.some((participant) => participant.id === task.assignedParticipantId && participant.state === "DISCONNECTED")) { task.status = "BLOCKED"; task.updatedAt = now(); this.event(room, "TASK_UPDATED", null, { task, reason: "ASSIGNEE_DISCONNECTED" }); changed = true; }
    if (changed) await this.save(room);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" } });
    const url = new URL(request.url); const parts = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, platform: "cloudflare" });
    if (request.method === "POST" && url.pathname === "/rooms") { const code = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase(); return env.ROOM.get(env.ROOM.idFromName(code)).fetch(new Request(`https://room/create?code=${code}`, request)); }
    if (parts[0] === "rooms" && parts[1]) return env.ROOM.get(env.ROOM.idFromName(parts[1])).fetch(new Request(`https://room/${parts.slice(2).join("/")}${url.search}`, request));
    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
