import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startLocalHub, type LocalHub } from "../../../apps/hub/src/server.js";
import { joinRunner, MirevaOrchestrator, MirevaRunner } from "../src/index.js";
import { AgentTaskExecutor, RunnerTaskWorker } from "../src/index.js";
import { MockAgentAdapter } from "@mireva/agent-adapters";

let hub: LocalHub | undefined;
afterEach(async () => { await hub?.close(); });
describe("MirevaRunner", () => {
  it("syncs an event published by a separate runner", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-runner-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sync", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const first = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner A", "mock"));
    const delivered: string[] = []; const second = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner B", "mock"), { onEvent: (event) => { if (event.kind === "MESSAGE") delivered.push(String(event.payload.text)); } });
    await first.publish("MESSAGE", { text: "contexto da tarefa A" });
    await second.poll();
    expect(delivered).toEqual(["contexto da tarefa A"]);
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
  it("automatically claims and executes the next ready task", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-worker-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Worker", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner", "mock")); await runner.createTask({ title: "Automática" });
    expect(await new RunnerTaskWorker(runner, new MockAgentAdapter(), ".").runOnce()).toBeTruthy();
  });
  it("creates a dependency graph from an orchestrator plan", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-orchestrator-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Plano", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const runner = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Orchestrator", "mock"));
    const planner = { plan: async () => ({ summary: "Separar fundação e interface", tasks: [{ title: "Fundação", description: "Criar base", dependencies: [] }, { title: "Interface", description: "Criar tela", dependencies: [0] }] }) };
    const result = await new MirevaOrchestrator(runner, planner).planAndCreate("Criar projeto");
    expect(result.tasks.map((task) => task.status)).toEqual(["READY", "BACKLOG"]);
    expect(result.tasks[1]!.dependencies).toEqual([result.tasks[0]!.id]);
  });
});
