import { createRoomSchema, joinRoomSchema, postEventSchema, type AgentState, type Participant, type RoomEvent } from "@mireva/protocol";

export interface Env { ROOM: DurableObjectNamespace<Room> }
interface RoomState { id: string; code: string; name: string; ownerId: string; createdAt: string; participants: Participant[]; events: RoomEvent[]; lastSequence: number }
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
        room = { id: crypto.randomUUID(), code: new URL(request.url).searchParams.get("code")!, name: input.name, ownerId, createdAt: time, participants: [{ id: ownerId, roomId: "", name: input.ownerName, agent: "human", state: "AVAILABLE", joinedAt: time, lastSeenAt: time }], events: [], lastSequence: 0 }; room.participants[0]!.roomId = room.id; await this.save(room); return json({ room: this.snapshot(room), owner: room.participants[0] }, 201);
      }
      if (!room) return json({ error: "Room not found" }, 404);
      if (request.method === "GET" && path === "/") return json(this.snapshot(room));
      if (request.method === "POST" && path === "/participants") { const input = joinRoomSchema.parse(await request.json()); const participant: Participant = { id: crypto.randomUUID(), roomId: room.id, name: input.name, agent: input.agent, state: "AVAILABLE", joinedAt: now(), lastSeenAt: now() }; room.participants.push(participant); this.event(room, "PARTICIPANT_JOINED", participant.id, { participant }); await this.save(room); return json(participant, 201); }
      if (request.method === "GET" && path === "/events") return json(room.events.filter((e) => e.sequence > Number(new URL(request.url).searchParams.get("after") ?? 0)));
      if (request.method === "POST" && path === "/events") { const body = await request.json() as { participantId: string }; const input = postEventSchema.parse(body); if (!room.participants.some((p) => p.id === body.participantId)) return json({ error: "Participant not found" }, 404); const event = this.event(room, input.kind, body.participantId, input.payload); await this.save(room); return json(event, 201); }
      if (request.method === "POST" && path === "/presence") { const body = await request.json() as { participantId: string; state: AgentState }; const participant = room.participants.find((p) => p.id === body.participantId); if (!participant) return json({ error: "Participant not found" }, 404); participant.state = body.state; participant.lastSeenAt = now(); this.event(room, "PRESENCE", participant.id, { state: body.state }); await this.save(room); return new Response(null, { status: 204 }); }
      return json({ error: "Not found" }, 404);
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Bad request" }, 400); }
  }
  private event(room: RoomState, kind: RoomEvent["kind"], participantId: string | null, payload: Record<string, unknown>): RoomEvent { const event: RoomEvent = { id: crypto.randomUUID(), roomId: room.id, sequence: ++room.lastSequence, kind, participantId, payload, createdAt: now() }; room.events.push(event); return event; }
  private snapshot(room: RoomState) { return { room: { id: room.id, code: room.code, name: room.name, ownerId: room.ownerId, createdAt: room.createdAt }, participants: room.participants, tasks: [], lastSequence: room.lastSequence }; }
  private save(room: RoomState) { return this.state.storage.put("room", room); }
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
