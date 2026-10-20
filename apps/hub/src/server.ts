import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { claimTaskSchema, configureParticipantSchema, createPlanSchema, createRoomSchema, createTaskSchema, decidePlanSchema, dispatchTasksSchema, joinRoomSchema, postEventSchema, reportUsageSchema, reviewTaskSchema, updateTaskSchema } from "@mireva/protocol";
import { LocalHubStore } from "./store.js";

const send = (response: ServerResponse, status: number, body?: unknown): void => { response.writeHead(status, { "content-type": "application/json" }); response.end(body === undefined ? undefined : JSON.stringify(body)); };
const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

export interface LocalHub { url: string; close(): Promise<void>; store: LocalHubStore }
export async function startLocalHub(options: { port?: number; dataFile: string }): Promise<LocalHub> {
  const store = new LocalHubStore(options.dataFile); await store.load();
  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET"; const url = new URL(request.url ?? "/", "http://localhost"); const parts = url.pathname.split("/").filter(Boolean);
      if (method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true });
      if (method === "POST" && url.pathname === "/rooms") { const input = createRoomSchema.parse(await readJson(request)); return send(response, 201, await store.createRoom(input.name, input.ownerName)); }
      if (parts[0] === "rooms" && parts[1]) {
        const code = parts[1];
        if (method === "GET" && parts.length === 2) { const snapshot = await store.snapshot(code); return snapshot ? send(response, 200, snapshot) : send(response, 404, { error: "Room not found" }); }
        if (method === "POST" && parts[2] === "participants" && parts.length === 3) { const input = joinRoomSchema.parse(await readJson(request)); const participant = await store.join(code, input.name, input.agent, input.role, input.capabilities); return participant ? send(response, 201, participant) : send(response, 404, { error: "Room not found" }); }
        if (method === "POST" && parts[2] === "participants" && parts[4] === "config" && parts.length === 5) { const input = configureParticipantSchema.parse(await readJson(request)); const participant = await store.configureParticipant(code, parts[3]!, input.ownerId, input.role, input.capabilities); return participant ? send(response, 200, participant) : send(response, 404, { error: "Participant or owner not found" }); }
        if (method === "POST" && parts[2] === "participants" && parts[4] === "usage" && parts.length === 5) { const input = reportUsageSchema.parse(await readJson(request)); const participant = await store.reportUsage(code, parts[3]!, input.reporterId, input); return participant ? send(response, 200, participant) : send(response, 404, { error: "Participant or reporter not found" }); }
        if (method === "GET" && parts[2] === "events") { const events = await store.events(code, Number(url.searchParams.get("after") ?? "0")); return events ? send(response, 200, events) : send(response, 404, { error: "Room not found" }); }
        if (method === "POST" && parts[2] === "events") { const body = await readJson(request) as { participantId: string } & unknown; const input = postEventSchema.parse(body); const event = await store.event(code, body.participantId, input.kind, input.payload); return event ? send(response, 201, event) : send(response, 404, { error: "Room or participant not found" }); }
        if (method === "POST" && parts[2] === "presence") { const body = await readJson(request) as { participantId: string; state: never }; const saved = await store.presence(code, body.participantId, body.state); return saved ? send(response, 204) : send(response, 404, { error: "Room or participant not found" }); }
        if (method === "POST" && parts[2] === "plans" && parts.length === 3) { const input = createPlanSchema.parse(await readJson(request)); const plan = await store.createPlan(code, input.participantId, input); return plan ? send(response, 201, plan) : send(response, 404, { error: "Room or participant not found" }); }
        if (method === "POST" && parts[2] === "plans" && parts[4] === "decision") { const input = decidePlanSchema.parse(await readJson(request)); const plan = await store.decidePlan(code, parts[3]!, input.ownerId, input.status); return plan ? send(response, 200, plan) : send(response, 404, { error: "Plan or owner not found" }); }
        if (method === "POST" && parts[2] === "tasks" && parts.length === 3) { const input = createTaskSchema.parse(await readJson(request)); const task = await store.createTask(code, input); return task ? send(response, 201, task) : send(response, 404, { error: "Room not found" }); }
        if (method === "GET" && parts[2] === "tasks" && parts[3] === "available") { const tasks = store.availableTasks(code); return tasks ? send(response, 200, tasks) : send(response, 404, { error: "Room not found" }); }
        if (method === "GET" && parts[2] === "tasks" && parts[3] === "assigned") { const tasks = store.assignedTasks(code, url.searchParams.get("participantId") ?? ""); return tasks ? send(response, 200, tasks) : send(response, 404, { error: "Room or participant not found" }); }
        if (method === "POST" && parts[2] === "tasks" && parts[3] === "dispatch") { const { ownerId } = dispatchTasksSchema.parse(await readJson(request)); const tasks = await store.dispatchTasks(code, ownerId); return tasks ? send(response, 200, tasks) : send(response, 404, { error: "Room or owner not found" }); }
        if (method === "POST" && parts[2] === "tasks" && parts[4] === "claim") { const input = claimTaskSchema.parse(await readJson(request)); const task = await store.claimTask(code, parts[3]!, input.participantId); return task ? send(response, 200, task) : send(response, 404, { error: "Task or participant not found" }); }
        if (method === "POST" && parts[2] === "tasks" && parts[4] === "status") { const input = updateTaskSchema.parse(await readJson(request)); const task = await store.updateTask(code, parts[3]!, input.participantId, input.status, input.result); return task ? send(response, 200, task) : send(response, 404, { error: "Task or participant not found" }); }
        if (method === "POST" && parts[2] === "tasks" && parts[4] === "decision") { const input = reviewTaskSchema.parse(await readJson(request)); const task = await store.reviewTask(code, parts[3]!, input.ownerId, input.status, input.result); return task ? send(response, 200, task) : send(response, 404, { error: "Task or owner not found" }); }
      }
      return send(response, 404, { error: "Not found" });
    } catch (error: unknown) { return send(response, 400, { error: error instanceof Error ? error.message : "Bad request" }); }
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Unable to resolve hub address");
  return { url: `http://127.0.0.1:${address.port}`, store, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
