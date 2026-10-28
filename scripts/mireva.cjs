#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { homedir, networkInterfaces } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { spawn } = require("node:child_process");
const { agentConfig } = require("./mireva-agent.cjs");

const REPOSITORY = "https://github.com/RenatoJose7/Mireva-Workspace.git";
const DEFAULT_HUB = "https://mireva-hub.renatojosesfc.workers.dev";
const PNPM_VERSION = "11.25.0";
// MIREVA_RUNTIME_DIR is useful for CI and for keeping an isolated runtime in tests.
const runtimeDirectory = process.env.MIREVA_RUNTIME_DIR || join(homedir(), ".mireva", "runtime");
const runtimeStoreDirectory = join(dirname(runtimeDirectory), "store");
const projectDirectory = process.cwd();
const rawArgs = process.argv.slice(2);
// npm exec/npx keeps the argument separator when a package is invoked from Git.
if (rawArgs[0] === "--") rawArgs.shift();
// Running `npx @renatojose7/mireva` is intentionally the simple path. It
// prepares the current project and opens the guided Office instead of making
// people learn the setup/office distinction before they can create a room.
const command = rawArgs.shift() ?? "open";

function fail(message) { console.error(`\nMireva: ${message}`); process.exit(1); }
function executable(name) { return process.platform === "win32" ? `${name}.cmd` : name; }
function run(binary, args, options = {}) {
  const result = spawnSync(executable(binary), args, { stdio: "inherit", ...options });
  if (result.error) fail(`não foi possível executar ${binary}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function output(binary, args) { return spawnSync(executable(binary), args, { encoding: "utf8" }).status === 0; }
function help() {
  console.log(`
Mireva Workspace launcher

Uso:
  npx @renatojose7/mireva
  npx @renatojose7/mireva open
  npx @renatojose7/mireva setup
  npx @renatojose7/mireva office
  npx @renatojose7/mireva agent
  npx @renatojose7/mireva connect CODIGO --name "Claude" --agent claude --model sonnet --role DEVELOPMENT --capabilities CODE,GIT
  npx @renatojose7/mireva join CODIGO --name "Gemini" --agent antigravity --model gemini-3.8-flash-medium
  npx @renatojose7/mireva work --adapter antigravity

O primeiro comando baixa o runtime, prepara a pasta atual e abre o Office.
O comando connect entra na sala e mantém o runner trabalhando com um único comando.
Os comandos seguintes usam .mireva/runner.json da pasta atual. Use --state para outro runner.
`);
}
function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major) || major < 22) fail(`requer Node.js 22 ou mais recente; encontrado ${process.version}`);
  if (!output("git", ["--version"])) fail("requer o Git instalado para baixar o runtime");
}
function syncRuntime(update) {
  mkdirSync(dirname(runtimeDirectory), { recursive: true });
  if (!existsSync(join(runtimeDirectory, ".git"))) {
    run("git", ["clone", "--depth", "1", REPOSITORY, runtimeDirectory]);
  } else if (update) {
    run("git", ["-C", runtimeDirectory, "pull", "--ff-only"]);
  }
}
function ensureDependencies() {
  if (!existsSync(join(runtimeDirectory, "node_modules", ".pnpm"))) {
    run("npx", ["--yes", `pnpm@${PNPM_VERSION}`, "--dir", runtimeDirectory, "--store-dir", runtimeStoreDirectory, "install", "--frozen-lockfile"]);
  }
}
function officeEnvironment() {
  const config = agentConfig();
  const script = join(__dirname, "mireva-agent.cjs");
  const child = spawn(process.execPath, [script], { detached: true, stdio: "ignore", env: { ...process.env, MIREVA_RUNTIME_DIR: runtimeDirectory, MIREVA_PROJECT_DIR: projectDirectory } });
  child.unref();
  const localNetwork = Object.values(networkInterfaces()).flat().find((network) => network && network.family === "IPv4" && !network.internal)?.address;
  return { ...process.env, VITE_MIREVA_AGENT_URL: `http://127.0.0.1:${config.port}`, VITE_MIREVA_AGENT_TOKEN: config.token, VITE_MIREVA_PROJECT_DIR: projectDirectory, VITE_MIREVA_INVITE_BASE_URL: localNetwork ? `http://${localNetwork}:5173` : "" };
}
function openOffice() { run("npx", ["--yes", `pnpm@${PNPM_VERSION}`, "--dir", runtimeDirectory, "--filter", "@mireva/office", "dev", "--", "--open", "--host", "0.0.0.0"], { env: officeEnvironment() }); }
function projectConfigPath() { return join(projectDirectory, ".mireva", "workspace.json"); }
function writeProjectConfig() {
  mkdirSync(join(projectDirectory, ".mireva"), { recursive: true });
  writeFileSync(projectConfigPath(), `${JSON.stringify({ version: 1, runtimeDirectory, hub: DEFAULT_HUB, projectDirectory }, null, 2)}\n`);
}
function option(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
function configuredCodexModel() {
  try { return readFileSync(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml"), "utf8").match(/^model\s*=\s*["']([^"']+)["']/m)?.[1]?.trim(); }
  catch { return undefined; }
}
function removeOption(args, flag) {
  const clean = [];
  let value;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) { value = args[index + 1]; index += 1; }
    else if (args[index] !== "--") clean.push(args[index]);
  }
  return { clean, value };
}
function runCli(cliCommand, suppliedArgs) {
  const stateOption = removeOption(suppliedArgs, "--state");
  const projectOption = removeOption(stateOption.clean, "--project-dir");
  const targetProject = resolve(projectOption.value ?? projectDirectory);
  const state = resolve(targetProject, stateOption.value ?? ".mireva/runner.json");
  const args = [...projectOption.clean];
  if ((cliCommand === "create" || cliCommand === "join" || cliCommand === "doctor") && !option(args, "--hub")) args.push("--hub", DEFAULT_HUB);
  const needsState = !["create", "doctor", "init", "login"].includes(cliCommand);
  if (needsState) args.push("--state", state);
  if (["work", "orchestrate"].includes(cliCommand)) args.push("--project-dir", targetProject);
  run("npx", ["--yes", `pnpm@${PNPM_VERSION}`, "--dir", runtimeDirectory, "--filter", "@mireva/cli", "mireva", cliCommand, "--", ...args]);
}
function runConnect(suppliedArgs) {
  const roomCode = suppliedArgs[0];
  if (!roomCode || roomCode.startsWith("-")) fail("use `mireva connect CODIGO_DA_SALA --name NOME --agent copilot|codex|claude|antigravity`");
  const connectionArgs = suppliedArgs.slice(1);
  const agent = option(connectionArgs, "--agent") ?? "copilot";
  const role = option(connectionArgs, "--role") ?? "GENERAL";
  if (!option(connectionArgs, "--name")) fail("informe um nome com `--name` para identificar este runner no escritório");
  if (!["copilot", "codex", "claude", "antigravity", "mock"].includes(agent)) fail("agent deve ser copilot, codex, claude, antigravity ou mock");
  const detectedModel = agent === "codex" && !option(connectionArgs, "--model") ? configuredCodexModel() : undefined;
  if (detectedModel) connectionArgs.push("--model", detectedModel);
  runCli("join", [roomCode, ...connectionArgs]);
  runCli(role === "ORCHESTRATOR" ? "orchestrate" : "work", [...connectionArgs, "--adapter", agent]);
}

if (["--help", "-h", "help"].includes(command)) { help(); process.exit(0); }
checkNode();
const update = ["setup", "open"].includes(command) && !rawArgs.includes("--no-update");
syncRuntime(update);
ensureDependencies();

if (command === "setup" || command === "open") {
  writeProjectConfig();
  console.log(`\nMireva pronto nesta pasta. Runtime: ${runtimeDirectory}`);
  if (command === "open" || rawArgs.includes("--office")) openOffice();
  else console.log("Próximo passo: execute `npx @renatojose7/mireva` para abrir o escritório.");
  process.exit(0);
}
if (command === "office") {
  openOffice();
  process.exit(0);
}
if (command === "agent") {
  require("./mireva-agent.cjs").startAgentServer({ runtimeDirectory });
} else if (command === "hub:deploy") {
  run("npx", ["--yes", `pnpm@${PNPM_VERSION}`, "--dir", runtimeDirectory, "hub:deploy"]);
  process.exit(0);
} else if (command === "config") {
  if (!existsSync(projectConfigPath())) fail("execute `mireva setup` nesta pasta primeiro");
  console.log(readFileSync(projectConfigPath(), "utf8"));
  process.exit(0);
} else if (command === "connect") { runConnect(rawArgs); process.exit(0); }
else {
  const cliCommands = new Set(["init", "login", "create", "join", "start", "work", "orchestrate", "status", "agents", "task-create", "tasks", "task-claim", "task-update", "limit-report", "doctor", "leave"]);
  if (!cliCommands.has(command)) { help(); fail(`comando desconhecido: ${command}`); }
  runCli(command, rawArgs);
}
