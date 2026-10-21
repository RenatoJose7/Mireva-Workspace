#!/usr/bin/env node
const http = require("node:http");
const { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } = require("node:fs");
const { randomBytes, randomUUID } = require("node:crypto");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const DEFAULT_HUB = "https://mireva-hub.renatojosesfc.workers.dev";
const PNPM_VERSION = "11.25.0";
const configFile = () => join(process.env.MIREVA_HOME || join(homedir(), ".mireva"), "agent.json");
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;
function agentConfig() {
  const file = configFile();
  try { const config = JSON.parse(readFileSync(file, "utf8")); if (config.token && config.port) return config; } catch {}
  mkdirSync(dirname(file), { recursive: true });
  const config = { port: 49321, token: randomBytes(24).toString("hex") };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
function json(response, status, body) { response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-mireva-token", "access-control-allow-methods": "GET,POST,OPTIONS" }); response.end(JSON.stringify(body)); }
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
function valid(input) {
  if (!/^[A-Z0-9]{8}$/.test(String(input.roomCode ?? "").toUpperCase())) throw new Error("Código da sala inválido");
  if (!["copilot", "codex", "mock"].includes(input.agent)) throw new Error("IA não suportada");
  if (!["GENERAL", "ORCHESTRATOR", "DEVELOPMENT", "RESEARCH", "TEST", "REVIEW"].includes(input.role)) throw new Error("Função inválida");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80) throw new Error("Informe um nome para a estação");
  const projectDirectory = resolve(String(input.projectDirectory ?? process.cwd()));
  if (!existsSync(projectDirectory)) throw new Error("A pasta do projeto não existe neste computador");
  return { roomCode: input.roomCode.toUpperCase(), hub: String(input.hub || DEFAULT_HUB).replace(/\/$/, ""), name: input.name.trim(), agent: input.agent, role: input.role, capabilities: Array.isArray(input.capabilities) ? input.capabilities.map(String).map((value) => value.trim().toUpperCase()).filter(Boolean).slice(0, 12) : [], projectDirectory };
}
// The runtime uses Corepack/npx to install dependencies, which does not place a
// `pnpm` executable in its node_modules/.bin directory. Invoke the pinned
// package manager through npx as well, so a fresh installation can start a
// runner without a separate global pnpm install.
function command(runtime, args, options = {}) {
  return spawn(executable("npx"), ["--yes", `pnpm@${PNPM_VERSION}`, "--dir", runtime, "--filter", "@mireva/cli", "mireva", ...args], options);
}
function runJoin(runtime, input, state) { return new Promise((resolve, reject) => { const child = command(runtime, ["join", input.roomCode, "--hub", input.hub, "--name", input.name, "--agent", input.agent, "--role", input.role, "--capabilities", input.capabilities.join(","), "--state", state], { cwd: input.projectDirectory, stdio: "pipe" }); let error = ""; child.stderr.on("data", (chunk) => { error += chunk; }); child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(error.trim() || "Não foi possível entrar na sala"))); }); }
function startAgentServer({ runtimeDirectory = process.env.MIREVA_RUNTIME_DIR, port = agentConfig().port, token = agentConfig().token } = {}) {
  if (!runtimeDirectory) throw new Error("MIREVA_RUNTIME_DIR não informado");
  const sessions = new Map();
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") return json(response, 204, {});
    if (request.headers["x-mireva-token"] !== token) return json(response, 401, { error: "Mireva Agent não autorizado" });
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, sessions: [...sessions.values()].map(({ child, ...session }) => ({ ...session, running: child.exitCode === null })) });
      if (request.method === "POST" && url.pathname === "/connect") {
        const input = valid(await body(request)); const sessionId = randomUUID(); const state = join(input.projectDirectory, ".mireva", `runner-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent"}.json`); mkdirSync(dirname(state), { recursive: true });
        await runJoin(runtimeDirectory, input, state);
        const log = join(input.projectDirectory, ".mireva", `agent-${sessionId}.log`); const workerCommand = input.role === "ORCHESTRATOR" ? "orchestrate" : "work";
        // spawn() requires a stream to have an open file descriptor. A newly
        // created WriteStream may still have fd=null, so open the log
        // synchronously and pass the descriptor directly to the child.
        const logFd = openSync(log, "a");
        let child;
        try { child = command(runtimeDirectory, [workerCommand, "--state", state, "--adapter", input.agent, "--project-dir", input.projectDirectory], { cwd: input.projectDirectory, detached: true, stdio: ["ignore", logFd, logFd] }); }
        finally { closeSync(logFd); }
        child.unref(); sessions.set(sessionId, { id: sessionId, name: input.name, agent: input.agent, role: input.role, projectDirectory: input.projectDirectory, log, startedAt: new Date().toISOString(), child });
        return json(response, 201, { id: sessionId, log });
      }
      const stop = url.pathname.match(/^\/sessions\/([^/]+)\/stop$/);
      if (request.method === "POST" && stop) { const session = sessions.get(stop[1]); if (!session) return json(response, 404, { error: "Runner não encontrado nesta sessão" }); session.child.kill(); return json(response, 200, { stopped: true }); }
      return json(response, 404, { error: "Rota não encontrada" });
    } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
  });
  server.listen(port, "127.0.0.1", () => console.log(`Mireva Agent ativo em http://127.0.0.1:${port}`));
  return server;
}
if (require.main === module) startAgentServer();
module.exports = { agentConfig, startAgentServer };
