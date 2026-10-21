import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startLocalHub, type LocalHub } from "../../../apps/hub/src/server.js";
import { classifyRunnerError, DirectMessageWorker, joinRunner, MirevaOrchestrator, MirevaRunner, OrchestratorWorker } from "../src/index.js";
import { AgentTaskExecutor, RunnerTaskWorker } from "../src/index.js";
import { MockAgentAdapter } from "@mireva/agent-adapters";

let hub: LocalHub | undefined;
class PermissionDeniedAdapter extends MockAgentAdapter { override async executeTask(): Promise<void> { throw new Error("permission denied by sandbox"); } }
afterEach(async () => { await hub?.close(); });
describe("MirevaRunner", () => {
  it("turns provider output into an actionable error", () => {
    expect(classifyRunnerError(new Error("permission denied by sandbox"), "EXECUTE_TASK")).toMatchObject({ code: "PERMISSION_REQUIRED", state: "WAITING_PERMISSION", requiredPermission: "FULL", retryable: true });
    expect(classifyRunnerError(new Error("429 rate limit exceeded"), "ORCHESTRATE")).toMatchObject({ code: "RATE_LIMITED", state: "RATE_LIMITED" });
  });
  it("syncs an event published by a separate runner", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-runner-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sync", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const first = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner A", "mock"));
    const delivered: string[] = []; const second = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner B", "mock"), { onEvent: (event) => { if (event.kind === "MESSAGE") delivered.push(String(event.payload.text)); } });
    await first.publish("MESSAGE", { text: "contexto da tarefa A" });
    await second.poll();
    expect(delivered).toEqual(["contexto da tarefa A"]);
  });
  it("reports the configured provider limit for the Office", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-usage-runner-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Usage", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Codex", "codex"));
    await runner.reportUsage({ used: 8, limit: 20, unit: "tarefas" });
    expect((await runner.snapshot()).participants.find((entry) => entry.id === runner.config.participantId)?.usage).toMatchObject({ used: 8, limit: 20, unit: "tarefas" });
  });
  it("executes a claimed task through an adapter and submits it for review", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-executor-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Executor", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner", "mock"));
    const task = await runner.createTask({ title: "Executar" }); const claimed = await runner.claimTask(task.id);
    await new AgentTaskExecutor(runner, new MockAgentAdapter()).execute(claimed, ".");
    const snapshot = await fetch(`${hub.url}/rooms/${room.room.code}`).then((r) => r.json()) as { tasks: Array<{ id: string; status: string; result: string }> };
    expect(snapshot.tasks.find((entry) => entry.id === task.id)).toMatchObject({ status: "REVIEW", result: "Entrega simulada" });
  });
  it("turns a permission failure into a reviewable request", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-permission-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Permission", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner", "mock")); const task = await runner.createTask({ title: "Protegida" }); const claimed = await runner.claimTask(task.id);
    await expect(new AgentTaskExecutor(runner, new PermissionDeniedAdapter()).execute(claimed, ".")).rejects.toThrow("permission denied");
    const snapshot = await runner.snapshot(); expect(snapshot.tasks.find((entry) => entry.id === task.id)?.status).toBe("WAITING_APPROVAL"); expect(snapshot.participants.find((entry) => entry.id === runner.config.participantId)?.state).toBe("WAITING_PERMISSION");
    expect((await runner.events()).map((event) => event.kind)).toEqual(expect.arrayContaining(["RUNNER_ERROR", "PERMISSION_REQUESTED"]));
  });
  it("automatically claims and executes the next ready task", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-worker-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Worker", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner", "mock")); await runner.createTask({ title: "Automática" });
    expect(await new RunnerTaskWorker(runner, new MockAgentAdapter(), ".").runOnce()).toBeTruthy();
  });
  it("creates a dependency graph from an orchestrator plan", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-orchestrator-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Plano", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string; ownerId: string } };
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Orchestrator", "mock"));
    const planner = { plan: async () => ({ summary: "Separar fundação e interface", tasks: [{ title: "Fundação", description: "Criar base", dependencies: [] }, { title: "Interface", description: "Criar tela", dependencies: [0] }] }) };
    const plan = await new MirevaOrchestrator(runner, planner).planAndPropose("Criar projeto");
    expect(plan.status).toBe("DRAFT");
    const owner = new MirevaRunner({ hubUrl: hub.url, roomCode: room.room.code, participantId: room.room.ownerId, name: "Owner", agent: "human", capabilities: [], lastSequence: 0 });
    await owner.decidePlan(plan.id, "APPROVED");
    const tasks = (await runner.snapshot()).tasks;
    expect(tasks.map((task) => task.status)).toEqual(["READY", "BACKLOG"]);
    expect(tasks[1]!.dependencies).toEqual([tasks[0]!.id]);
    expect(tasks[0]!.requiredCapabilities).toEqual([]);
  });
  it("turns an Office request into one reviewable plan only", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-orchestrator-worker-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Pedidos", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string; ownerId: string } };
    const owner = new MirevaRunner({ hubUrl: hub.url, roomCode: room.room.code, participantId: room.room.ownerId, name: "Owner", agent: "human", capabilities: [], lastSequence: 0 });
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Orchestrator", "copilot"));
    await owner.publish("ORCHESTRATOR_REQUEST", { message: "Criar site" });
    const planner = { plan: async () => ({ summary: "Uma base", tasks: [{ title: "Base", description: "Criar", dependencies: [], requiredCapabilities: ["CODE"] }] }) };
    const worker = new OrchestratorWorker(runner, new MirevaOrchestrator(runner, planner));
    expect((await worker.runOnce()).planId).toBeTruthy();
    expect(await worker.runOnce()).toEqual({});
    const snapshot = await runner.snapshot();
    expect(snapshot.plans).toHaveLength(1);
    expect(snapshot.plans[0]?.tasks[0]?.requiredCapabilities).toEqual(["CODE"]);
    await owner.decidePlan(snapshot.plans[0]!.id, "APPROVED");
    expect((await runner.snapshot()).tasks[0]?.requiredCapabilities).toEqual(["CODE"]);
  });
  it("answers a greeting immediately without invoking the planner", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-orchestrator-chat-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Conversa", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string; ownerId: string } };
    const owner = new MirevaRunner({ hubUrl: hub.url, roomCode: room.room.code, participantId: room.room.ownerId, name: "Owner", agent: "human", capabilities: [], lastSequence: 0 });
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Orchestrator", "codex"));
    await owner.publish("ORCHESTRATOR_REQUEST", { message: "olá" });
    const planner = { plan: async () => { throw new Error("planner should not run"); } };
    expect((await new OrchestratorWorker(runner, new MirevaOrchestrator(runner, planner)).runOnce()).requestId).toBeTruthy();
    const response = (await runner.events()).find((event) => event.kind === "ORCHESTRATOR_RESPONSE");
    expect((response?.payload.orchestrator as { summary?: string }).summary).toContain("Vamos planejar juntos");
    expect((await runner.snapshot()).plans).toHaveLength(0);
  });
  it("continues the conversation when more information is needed", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-orchestrator-question-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Perguntas", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string; ownerId: string } };
    const owner = new MirevaRunner({ hubUrl: hub.url, roomCode: room.room.code, participantId: room.room.ownerId, name: "Owner", agent: "human", capabilities: [], lastSequence: 0 });
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Orchestrator", "codex"));
    await owner.publish("ORCHESTRATOR_REQUEST", { message: "Quero fazer um site" });
    const planner = { plan: async () => ({ summary: "Que tipo de site e para qual público?", tasks: [] }) };
    const result = await new OrchestratorWorker(runner, new MirevaOrchestrator(runner, planner)).runOnce();
    expect(result.planId).toBeUndefined();
    expect((await runner.snapshot()).plans).toHaveLength(0);
  });
  it("delivers a direct message to the selected station", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-direct-message-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Chat", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string; ownerId: string } };
    const owner = new MirevaRunner({ hubUrl: hub.url, roomCode: room.room.code, participantId: room.room.ownerId, name: "Owner", agent: "human", capabilities: [], lastSequence: 0 });
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner", "mock"));
    await owner.publish("AGENT_MESSAGE", { targetParticipantId: runner.config.participantId, message: "Como está a tarefa?" });
    expect(await new DirectMessageWorker(runner, new MockAgentAdapter(), ".").runOnce()).toBeTruthy();
    const response = (await owner.events()).find((event) => event.kind === "AGENT_RESPONSE");
    expect(response?.payload.message).toBe("Mock respondeu: Como está a tarefa?");
  });
  it("dispatches each ready task to an available runner with matching capabilities", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-dispatch-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Dispatch", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string; ownerId: string } };
    const owner = new MirevaRunner({ hubUrl: hub.url, roomCode: room.room.code, participantId: room.room.ownerId, name: "Owner", agent: "human", capabilities: [], lastSequence: 0 });
    const coder = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Coder", "codex", ["CODE", "TEST"]));
    const researcher = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Researcher", "gemini", ["RESEARCH"]));
    const codeTask = await owner.createTask({ title: "Implementar", requiredCapabilities: ["CODE"] });
    const researchTask = await owner.createTask({ title: "Pesquisar", requiredCapabilities: ["RESEARCH"] });
    await owner.dispatchTasks();
    expect((await coder.assignedTasks()).map((task) => task.id)).toEqual([codeTask.id]);
    expect((await researcher.assignedTasks()).map((task) => task.id)).toEqual([researchTask.id]);
  });
});
