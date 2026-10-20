#!/usr/bin/env node
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const REPOSITORY = "https://github.com/RenatoJose7/Mireva-Workspace.git";
const DEFAULT_HUB = "https://mireva-hub.renatojosesfc.workers.dev";
const PNPM_VERSION = "11.25.0";
// MIREVA_RUNTIME_DIR is useful for CI and for keeping an isolated runtime in tests.
const runtimeDirectory = process.env.MIREVA_RUNTIME_DIR || join(homedir(), ".mireva", "runtime");
const projectDirectory = process.cwd();
const rawArgs = process.argv.slice(2);
// npm exec/npx keeps the argument separator when a package is invoked from Git.
if (rawArgs[0] === "--") rawArgs.shift();
const command = rawArgs.shift() ?? "setup";

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
  npx --yes github:RenatoJose7/Mireva-Workspace#main -- setup
  npx --yes github:RenatoJose7/Mireva-Workspace#main -- office
  npx --yes github:RenatoJose7/Mireva-Workspace#main -- join CODIGO --name "Copilot" --agent copilot
  npx --yes github:RenatoJose7/Mireva-Workspace#main -- work --adapter copilot

O primeiro comando baixa o runtime em ~/.mireva/runtime e prepara a pasta atual.
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
    run("npx", ["--yes", `pnpm@${PNPM_VERSION}`, "--dir", runtimeDirectory, "install", "--frozen-lockfile"]);
  }
}
function projectConfigPath() { return join(projectDirectory, ".mireva", "workspace.json"); }
function writeProjectConfig() {
  mkdirSync(join(projectDirectory, ".mireva"), { recursive: true });
  writeFileSync(projectConfigPath(), `${JSON.stringify({ version: 1, runtimeDirectory, hub: DEFAULT_HUB, projectDirectory }, null, 2)}\n`);
}
function option(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
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

if (["--help", "-h", "help"].includes(command)) { help(); process.exit(0); }
checkNode();
const update = command === "setup" && !rawArgs.includes("--no-update");
syncRuntime(update);
ensureDependencies();

if (command === "setup") {
  writeProjectConfig();
  console.log(`\nMireva pronto nesta pasta. Runtime: ${runtimeDirectory}`);
  console.log("Próximo passo: execute `npx --yes github:RenatoJose7/Mireva-Workspace#main -- office` para abrir o escritório.");
  if (rawArgs.includes("--office")) run("npx", ["--yes", `pnpm@${PNPM_VERSION}`, "--dir", runtimeDirectory, "--filter", "@mireva/office", "dev", "--", "--open"]);
  process.exit(0);
}
if (command === "office") {
  run("npx", ["--yes", `pnpm@${PNPM_VERSION}`, "--dir", runtimeDirectory, "--filter", "@mireva/office", "dev", "--", "--open"]);
  process.exit(0);
}
if (command === "hub:deploy") {
  run("npx", ["--yes", `pnpm@${PNPM_VERSION}`, "--dir", runtimeDirectory, "hub:deploy"]);
  process.exit(0);
}
if (command === "config") {
  if (!existsSync(projectConfigPath())) fail("execute `mireva setup` nesta pasta primeiro");
  console.log(readFileSync(projectConfigPath(), "utf8"));
  process.exit(0);
}
const cliCommands = new Set(["init", "login", "create", "join", "start", "work", "orchestrate", "status", "agents", "task-create", "tasks", "task-claim", "task-update", "limit-report", "doctor", "leave"]);
if (!cliCommands.has(command)) { help(); fail(`comando desconhecido: ${command}`); }
runCli(command, rawArgs);
