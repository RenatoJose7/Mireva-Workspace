#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CodexCliAdapter, CopilotCliAdapter, MockAgentAdapter, isProjectPlanningAdapter, type AgentAdapter } from "@mireva/agent-adapters";
import { AdapterProjectPlanner, MirevaOrchestrator, MirevaRunner, OrchestratorWorker, RunnerTaskWorker, joinRunner, type RunnerConfig } from "@mireva/runner";

const args = process.argv.slice(2); const command = args[0];
const value = (flag: string, fallback?: string): string | undefined => { const index = args.indexOf(flag); return index < 0 ? fallback : args[index + 1]; };
const stateFile = () => resolve(value("--state", ".mireva/runner.json")!);
const loadState = async () => JSON.parse(await readFile(stateFile(), "utf8")) as RunnerConfig;
const saveState = async (config: RunnerConfig) => { await mkdir(resolve(stateFile(), ".."), { recursive: true }); await writeFile(stateFile(), JSON.stringify(config, null, 2)); };
const output = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const projectDirectory = () => resolve(value("--project-dir", process.env.INIT_CWD ?? process.cwd())!);
const createAdapter = (name: string): AgentAdapter => {
  if (name === "mock") return new MockAgentAdapter();
  if (name === "codex") return new CodexCliAdapter();
  if (name === "copilot") return new CopilotCliAdapter();
  throw new Error(`Adapter não suportado: ${name}. Use mock, codex ou copilot.`);
};

async function run(): Promise<void> {
  if (!command || command === "--help") return usage();
  if (command === "init") { await mkdir(".mireva", { recursive: true }); await writeFile(".mireva/config.json", JSON.stringify({ version: 1 }, null, 2)); return output({ initialized: true }); }
  if (command === "login") return output({ supported: false, message: "Local Hub does not require login. Remote authentication is planned for the Cloudflare Hub." });
  if (command === "create") {
    const hub = value("--hub", "http://127.0.0.1:8787")!; const response = await fetch(`${hub}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: value("--name", "Mireva room"), ownerName: value("--owner", "owner") }) });
    if (!response.ok) throw new Error(await response.text()); return output(await response.json());
  }
  if (command === "join") { const code = args[1]; if (!code) throw new Error("Usage: mireva join CODIGO --name NAME --agent AGENT"); const capabilities = value("--capabilities", "")!.split(",").map((capability) => capability.trim()).filter(Boolean); const config = await joinRunner(value("--hub", "http://127.0.0.1:8787")!, code, value("--name", "runner")!, value("--agent", "mock")!, capabilities, value("--role", "GENERAL") as RunnerConfig["role"]); await saveState(config); return output(config); }
  if (command === "task-create") { const runner = new MirevaRunner(await loadState()); const title = value("--title"); if (!title) throw new Error("Usage: mireva task-create --title TITULO"); return output(await runner.createTask({ title, description: value("--description", ""), dependencies: value("--dependencies", "")!.split(",").filter(Boolean), priority: Number(value("--priority", "50")), requiredCapabilities: value("--capabilities", "")!.split(",").map((capability) => capability.trim()).filter(Boolean), acceptanceCriteria: value("--acceptance", "")!.split("|").filter(Boolean) })); }
  if (command === "tasks") { const runner = new MirevaRunner(await loadState()); return output(await runner.availableTasks()); }
  if (command === "task-claim") { const taskId = args[1]; if (!taskId) throw new Error("Usage: mireva task-claim ID"); return output(await new MirevaRunner(await loadState()).claimTask(taskId)); }
  if (command === "task-update") { const taskId = args[1]; const status = value("--status"); if (!taskId || !status) throw new Error("Usage: mireva task-update ID --status STATUS [--result TEXTO]"); return output(await new MirevaRunner(await loadState()).updateTask(taskId, status as never, value("--result"))); }
  if (command === "limit-report") { const used = Number(value("--used")); const limit = Number(value("--limit")); if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) throw new Error("Usage: mireva limit-report --used NUMERO --limit NUMERO [--unit créditos] [--reset-at ISO]"); return output(await new MirevaRunner(await loadState()).reportUsage({ used, limit, unit: value("--unit", "créditos"), resetAt: value("--reset-at") ?? null })); }
  if (command === "start") { const config = await loadState(); const runner = new MirevaRunner(config, { onEvent: (event) => output({ event }) }); await runner.setPresence("AVAILABLE"); if (args.includes("--once")) { await runner.poll(); await saveState(config); return; } runner.start(Number(value("--interval", "1000"))); process.on("SIGINT", () => { runner.stop(); void saveState(config).then(() => process.exit(0)); }); return; }
  if (command === "work") {
    const config = await loadState(); const adapter = createAdapter(value("--adapter", "mock")!);
    const detection = await adapter.detect(); if (!detection.installed) throw new Error(detection.reason ?? `Adapter ${adapter.id} não instalado`);
    const authentication = await adapter.checkAuthentication(); if (!authentication.authenticated) throw new Error(authentication.reason ?? `Adapter ${adapter.id} não autenticado`);
    const runner = new MirevaRunner(config, { onEvent: (event) => output({ event }) });
    await runner.setPresence("AVAILABLE");
    const worker = new RunnerTaskWorker(runner, adapter, projectDirectory());
    let running = false;
    const run = async () => { if (running) return; running = true; try { await runner.heartbeat(); const taskId = await worker.runOnce(); output({ taskId: taskId ?? null, message: taskId ? "Tarefa entregue para revisão" : "Nenhuma tarefa disponível" }); await saveState(config); } finally { running = false; } };
    if (args.includes("--once")) return run(); const timer = setInterval(() => void run().catch((error: unknown) => console.error(error)), Number(value("--interval", "3000"))); process.on("SIGINT", () => { clearInterval(timer); void saveState(config).then(() => process.exit(0)); }); return run();
  }
  if (command === "orchestrate") {
    const config = await loadState(); const adapter = createAdapter(value("--adapter", "codex")!);
    const detection = await adapter.detect(); if (!detection.installed) throw new Error(detection.reason ?? `Adapter ${adapter.id} não instalado`);
    const authentication = await adapter.checkAuthentication(); if (!authentication.authenticated) throw new Error(authentication.reason ?? `Adapter ${adapter.id} não autenticado`);
    if (!isProjectPlanningAdapter(adapter)) throw new Error(`O adapter ${adapter.id} ainda não cria planos. Use codex ou copilot.`);
    const runner = new MirevaRunner(config, { onEvent: (event) => output({ event }) });
    await runner.setPresence("AVAILABLE");
    const worker = new OrchestratorWorker(runner, new MirevaOrchestrator(runner, new AdapterProjectPlanner(adapter, projectDirectory())));
    let running = false;
    const run = async () => { if (running) return; running = true; try { await runner.heartbeat(); const result = await worker.runOnce(); output({ ...result, message: result.planId ? "Plano enviado para aprovação" : result.error ? "Falha ao criar plano" : "Nenhum pedido pendente" }); await saveState(config); } finally { running = false; } };
    if (args.includes("--once")) return run(); const timer = setInterval(() => void run().catch((error: unknown) => console.error(error)), Number(value("--interval", "3000"))); process.on("SIGINT", () => { clearInterval(timer); void saveState(config).then(() => process.exit(0)); }); return run();
  }
  if (command === "status") { const config = await loadState(); const response = await fetch(`${config.hubUrl}/rooms/${config.roomCode}`); if (!response.ok) throw new Error(await response.text()); return output(await response.json()); }
  if (command === "agents") { const config = await loadState(); const room = await fetch(`${config.hubUrl}/rooms/${config.roomCode}`).then((r) => r.json()) as { participants: unknown[] }; return output(room.participants); }
  if (command === "doctor") { const hub = value("--hub", "http://127.0.0.1:8787")!; const response = await fetch(`${hub}/health`).catch(() => undefined); const adapter = createAdapter(value("--adapter", "mock")!); return output({ node: process.version, hub, hubReachable: response?.ok ?? false, adapter: { id: adapter.id, detection: await adapter.detect(), authentication: await adapter.checkAuthentication() } }); }
  if (command === "leave") { await rm(stateFile(), { force: true }); return output({ left: true }); }
  throw new Error(`Unknown command: ${command}`);
}
function usage(): void { console.log("Mireva CLI\nCommands: init, login, create, join CODIGO, start, work --adapter mock|codex|copilot [--project-dir PASTA], orchestrate --adapter codex|copilot [--project-dir PASTA], status, agents, task-create, tasks, task-claim ID, task-update ID, limit-report, doctor --adapter mock|codex|copilot, leave"); }
run().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
