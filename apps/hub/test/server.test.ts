import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startLocalHub, type LocalHub } from "../src/server.js";

let hub: LocalHub | undefined;
afterEach(async () => { await hub?.close(); });
describe("local hub", () => {
  it("persists a room and gives ordered events to independent runners", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mireva-hub-")); hub = await startLocalHub({ dataFile: join(dir, "hub.json") });
    const created = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Projeto", ownerName: "Renato" }) }).then((r) => r.json()) as { room: { code: string } };
    const alice = await fetch(`${hub.url}/rooms/${created.room.code}/participants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Alice", agent: "mock" }) }).then((r) => r.json()) as { id: string };
    const bob = await fetch(`${hub.url}/rooms/${created.room.code}/participants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Bob", agent: "mock" }) }).then((r) => r.json()) as { id: string };
    await fetch(`${hub.url}/rooms/${created.room.code}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: alice.id, kind: "MESSAGE", payload: { text: "Entrega pronta" } }) });
    const events = await fetch(`${hub.url}/rooms/${created.room.code}/events?after=0&participantId=${bob.id}`).then((r) => r.json()) as Array<{ sequence: number; kind: string }>;
    expect(events.map((event) => event.kind)).toEqual(["PARTICIPANT_JOINED", "PARTICIPANT_JOINED", "MESSAGE"]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    await hub.close(); hub = await startLocalHub({ dataFile: join(dir, "hub.json") });
    expect((await fetch(`${hub.url}/rooms/${created.room.code}`).then((r) => r.json()) as { participants: unknown[] }).participants).toHaveLength(3);
  });
  it("releases a dependent task only after its predecessor is done", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mireva-tasks-")); hub = await startLocalHub({ dataFile: join(dir, "hub.json") });
    const created = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Tasks", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const runner = await fetch(`${hub.url}/rooms/${created.room.code}/participants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Runner", agent: "mock" }) }).then((r) => r.json()) as { id: string };
    const first = await fetch(`${hub.url}/rooms/${created.room.code}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Base" }) }).then((r) => r.json()) as { id: string; status: string };
    const second = await fetch(`${hub.url}/rooms/${created.room.code}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Dependente", dependencies: [first.id] }) }).then((r) => r.json()) as { id: string; status: string };
    expect(second.status).toBe("BACKLOG");
    await fetch(`${hub.url}/rooms/${created.room.code}/tasks/${first.id}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: runner.id }) });
    await fetch(`${hub.url}/rooms/${created.room.code}/tasks/${first.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: runner.id, status: "RUNNING" }) });
    await fetch(`${hub.url}/rooms/${created.room.code}/tasks/${first.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: runner.id, status: "REVIEW" }) });
    await fetch(`${hub.url}/rooms/${created.room.code}/tasks/${first.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: runner.id, status: "DONE", result: "entregue" }) });
    const available = await fetch(`${hub.url}/rooms/${created.room.code}/tasks/available`).then((r) => r.json()) as Array<{ id: string }>;
    expect(available.map((task) => task.id)).toEqual([second.id]);
  });
  it("marks stale participants as disconnected when the room is read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mireva-presence-")); hub = await startLocalHub({ dataFile: join(dir, "hub.json") });
    const created = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Presence", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const runner = await fetch(`${hub.url}/rooms/${created.room.code}/participants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Runner", agent: "mock" }) }).then((r) => r.json()) as { id: string };
    const raw = (hub.store as unknown as { data: { rooms: Record<string, { participants: Array<{ id: string; lastSeenAt: string }> }> } }).data;
    raw.rooms[created.room.code]!.participants.find((entry) => entry.id === runner.id)!.lastSeenAt = new Date(Date.now() - 21_000).toISOString();
    const snapshot = await fetch(`${hub.url}/rooms/${created.room.code}`).then((r) => r.json()) as { participants: Array<{ id: string; state: string }> };
    expect(snapshot.participants.find((entry) => entry.id === runner.id)?.state).toBe("DISCONNECTED");
  });
});
