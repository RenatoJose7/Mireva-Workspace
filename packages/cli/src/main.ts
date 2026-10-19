#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MirevaRunner, joinRunner, type RunnerConfig } from "@mireva/runner";

const args = process.argv.slice(2); const command = args[0];
const value = (flag: string, fallback?: string): string | undefined => { const index = args.indexOf(flag); return index < 0 ? fallback : args[index + 1]; };
const stateFile = () => resolve(value("--state", ".mireva/runner.json")!);
const loadState = async () => JSON.parse(await readFile(stateFile(), "utf8")) as RunnerConfig;
const saveState = async (config: RunnerConfig) => { await mkdir(resolve(stateFile(), ".."), { recursive: true }); await writeFile(stateFile(), JSON.stringify(config, null, 2)); };
const output = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function run(): Promise<void> {
  if (!command || command === "--help") return usage();
  if (command === "init") { await mkdir(".mireva", { recursive: true }); await writeFile(".mireva/config.json", JSON.stringify({ version: 1 }, null, 2)); return output({ initialized: true }); }
  if (command === "login") return output({ supported: false, message: "Local Hub does not require login. Remote authentication is planned for the Cloudflare Hub." });
  if (command === "create") {
    const hub = value("--hub", "http://127.0.0.1:8787")!; const response = await fetch(`${hub}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: value("--name", "Mireva room"), ownerName: value("--owner", "owner") }) });
    if (!response.ok) throw new Error(await response.text()); return output(await response.json());
  }
  if (command === "join") { const code = args[1]; if (!code) throw new Error("Usage: mireva join CODIGO --name NAME --agent AGENT"); const config = await joinRunner(value("--hub", "http://127.0.0.1:8787")!, code, value("--name", "runner")!, value("--agent", "mock")!); await saveState(config); return output(config); }
  if (command === "task-create") { const runner = new MirevaRunner(await loadState()); const title = value("--title"); if (!title) throw new Error("Usage: mireva task-create --title TITULO"); return output(await runner.createTask({ title, description: value("--description", ""), dependencies: value("--dependencies", "")!.split(",").filter(Boolean), priority: Number(value("--priority", "50")), acceptanceCriteria: value("--acceptance", "")!.split("|").filter(Boolean) })); }
  if (command === "tasks") { const runner = new MirevaRunner(await loadState()); return output(await runner.availableTasks()); }
  if (command === "task-claim") { const taskId = args[1]; if (!taskId) throw new Error("Usage: mireva task-claim ID"); return output(await new MirevaRunner(await loadState()).claimTask(taskId)); }
  if (command === "task-update") { const taskId = args[1]; const status = value("--status"); if (!taskId || !status) throw new Error("Usage: mireva task-update ID --status STATUS [--result TEXTO]"); return output(await new MirevaRunner(await loadState()).updateTask(taskId, status as never, value("--result"))); }
  if (command === "start") { const config = await loadState(); const runner = new MirevaRunner(config, { onEvent: (event) => output({ event }) }); await runner.setPresence("AVAILABLE"); if (args.includes("--once")) { await runner.poll(); await saveState(config); return; } runner.start(Number(value("--interval", "1000"))); process.on("SIGINT", () => { runner.stop(); void saveState(config).then(() => process.exit(0)); }); return; }
  if (command === "status") { const config = await loadState(); const response = await fetch(`${config.hubUrl}/rooms/${config.roomCode}`); if (!response.ok) throw new Error(await response.text()); return output(await response.json()); }
  if (command === "agents") { const config = await loadState(); const room = await fetch(`${config.hubUrl}/rooms/${config.roomCode}`).then((r) => r.json()) as { participants: unknown[] }; return output(room.participants); }
  if (command === "doctor") { const hub = value("--hub", "http://127.0.0.1:8787")!; const response = await fetch(`${hub}/health`).catch(() => undefined); return output({ node: process.version, hub, hubReachable: response?.ok ?? false, agentAdapters: ["mock"] }); }
  if (command === "leave") { await rm(stateFile(), { force: true }); return output({ left: true }); }
  throw new Error(`Unknown command: ${command}`);
}
function usage(): void { console.log("Mireva CLI\nCommands: init, login, create, join CODIGO, start, status, agents, task-create, tasks, task-claim ID, task-update ID, doctor, leave"); }
run().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
