#!/usr/bin/env node
const http = require("node:http");
const { accessSync, appendFileSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } = require("node:fs");
const { randomBytes, randomUUID } = require("node:crypto");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const DEFAULT_HUB = "https://mireva-hub.renatojosesfc.workers.dev";
const PNPM_VERSION = "11.25.0";
const AGENT_CONFIG_VERSION = 8;
const configFile = () => join(process.env.MIREVA_HOME || join(homedir(), ".mireva"), "agent.json");
const executable = (name) => process.platform === "win32" ? `${name}.cmd` : name;
function agentConfig() {
  const file = configFile();
  let previous;
  try { const config = JSON.parse(readFileSync(file, "utf8")); if (config.version === AGENT_CONFIG_VERSION && config.token && config.port) return config; previous = config; } catch {}
  mkdirSync(dirname(file), { recursive: true });
  // A new bridge version deliberately moves to a fresh local port. Older
  // detached agents can survive a terminal/PC restart; rotating the endpoint
  // lets an updated launcher start cleanly instead of talking to a
  // stale process that still has the old bridge code in memory.
  const config = { version: AGENT_CONFIG_VERSION, port: 49328, token: randomBytes(24).toString("hex"), legacy: previous?.token && previous?.port ? { port: previous.port, token: previous.token } : undefined };
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
function json(response, status, body) { response.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-mireva-token", "access-control-allow-methods": "GET,POST,OPTIONS" }); response.end(JSON.stringify(body)); }
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
function codexConfiguredModel() {
  try {
    const config = readFileSync(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml"), "utf8");
    return config.match(/^model\s*=\s*["']([^"']+)["']/m)?.[1]?.trim() || null;
  } catch { return null; }
}
function valid(input) {
  if (!/^[A-Z0-9]{8}$/.test(String(input.roomCode ?? "").toUpperCase())) throw new Error("Código da sala inválido");
  if (!["copilot", "codex", "claude", "antigravity", "mock"].includes(input.agent)) throw new Error("IA não suportada");
  if (!["GENERAL", "ORCHESTRATOR", "DEVELOPMENT", "RESEARCH", "TEST", "REVIEW"].includes(input.role)) throw new Error("Função inválida");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80) throw new Error("Informe um nome para a estação");
  const projectDirectory = resolve(String(input.projectDirectory ?? process.cwd()));
  if (!existsSync(projectDirectory)) throw new Error("A pasta do projeto não existe neste computador");
  const permissionProfile = ["READ_ONLY", "PROJECT", "PROJECT_NETWORK", "FULL"].includes(input.permissionProfile) ? input.permissionProfile : input.role === "ORCHESTRATOR" ? "READ_ONLY" : "PROJECT";
  const requestedModel = String(input.model ?? "").trim();
  const model = requestedModel || (input.agent === "codex" ? codexConfiguredModel() : null);
  if (model && (model.length > 120 || /[\r\n]/.test(model))) throw new Error("Modelo inválido");
  const participantId = typeof input.participantId === "string" && /^[0-9a-f-]{36}$/i.test(input.participantId) ? input.participantId : undefined;
  return { roomCode: input.roomCode.toUpperCase(), hub: String(input.hub || DEFAULT_HUB).replace(/\/$/, ""), participantId, name: input.name.trim(), agent: input.agent, model, role: input.role, capabilities: Array.isArray(input.capabilities) ? input.capabilities.map(String).map((value) => value.trim().toUpperCase()).filter(Boolean).slice(0, 12) : [], permissionProfile, projectDirectory };
}
// The runtime uses Corepack/npx to install dependencies, which does not place a
// `pnpm` executable in its node_modules/.bin directory. Invoke the pinned
// package manager through npx as well, so a fresh installation can start a
// runner without a separate global pnpm install.
function command(runtime, args, options = {}) {
  return spawn(executable("npx"), ["--yes", `pnpm@${PNPM_VERSION}`, "--dir", runtime, "--filter", "@mireva/cli", "mireva", ...args], options);
}
function terminateProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    killer.unref();
    return;
  }
  try { process.kill(-child.pid, "SIGTERM"); }
  catch { try { child.kill(); } catch {} }
}
function savedParticipantId(state, input) {
  try { const saved = JSON.parse(readFileSync(state, "utf8")); return saved.roomCode === input.roomCode && String(saved.hubUrl ?? "").replace(/\/$/, "") === input.hub && saved.participantId ? String(saved.participantId) : undefined; }
  catch { return undefined; }
}
function runJoin(runtime, input, state) { return new Promise((resolve, reject) => { const modelArgs = input.model ? ["--model", input.model] : []; const participantId = input.participantId || savedParticipantId(state, input); const reconnectArgs = participantId ? ["--participant-id", participantId] : []; const child = command(runtime, ["join", input.roomCode, "--hub", input.hub, "--name", input.name, "--agent", input.agent, ...modelArgs, ...reconnectArgs, "--role", input.role, "--capabilities", input.capabilities.join(","), "--permissions", input.permissionProfile, "--state", state], { cwd: input.projectDirectory, stdio: "pipe" }); let error = ""; child.stderr.on("data", (chunk) => { error += chunk; }); child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(error.trim() || "Não foi possível entrar na sala"))); }); }
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function logTail(filename) {
  try { return readFileSync(filename, "utf8").trim().split("\n").slice(-8).join("\n"); }
  catch { return ""; }
}
async function verifyStartup(child, log) {
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(logTail(log) || `A IA encerrou ao iniciar (código ${child.exitCode})`);
    const output = logTail(log);
    if (output.includes('"message"') || output.includes('"event"')) return;
    await delay(200);
  }
  if (child.exitCode !== null) throw new Error(logTail(log) || `A IA encerrou ao iniciar (código ${child.exitCode})`);
}
function agentCommand(agent) { return agent === "antigravity" ? "agy" : agent; }
function programCheck(agent) {
  if (agent === "mock") return { ok: true, detail: "Adapter de teste disponível" };
  const commandName = agentCommand(agent); const result = spawnSync(executable(commandName), ["--version"], { encoding: "utf8", windowsHide: true });
  const fixes = { codex: "Instale com npm install -g @openai/codex", copilot: "Instale a GitHub Copilot CLI e abra copilot uma vez para autenticar", claude: "Instale o Claude Code e abra claude uma vez para autenticar", antigravity: "Instale o Antigravity CLI e abra agy uma vez para autenticar" };
  return result.status === 0 ? { ok: true, detail: (result.stdout || result.stderr || "Instalado").trim().split("\n")[0] } : { ok: false, detail: `${commandName} não foi encontrado no PATH`, fix: fixes[agent] || "Instale o CLI deste provider" };
}
async function diagnostics(input) {
  const projectDirectory = resolve(String(input.projectDirectory ?? process.cwd())); const checks = []; const model = String(input.model ?? "").trim() || (input.agent === "codex" ? codexConfiguredModel() : null); let models = input.agent === "claude" ? ["sonnet", "opus"] : [];
  try { accessSync(projectDirectory, constants.R_OK); checks.push({ key: "folder-read", status: "ok", title: "Pasta legível", detail: projectDirectory }); } catch { checks.push({ key: "folder-read", status: "error", title: "Pasta inacessível", detail: projectDirectory, fix: "Escolha uma pasta existente com permissão de leitura" }); }
  try { accessSync(projectDirectory, constants.W_OK); checks.push({ key: "folder-write", status: "ok", title: "Pasta gravável", detail: "A IA pode alterar arquivos nesta pasta" }); } catch { checks.push({ key: "folder-write", status: "error", title: "Sem permissão de escrita", detail: projectDirectory, fix: "Ajuste as permissões da pasta ou use Somente leitura" }); }
  const program = programCheck(input.agent); checks.push({ key: "provider", status: program.ok ? "ok" : "error", title: program.ok ? `${input.agent} instalado` : `${input.agent} indisponível`, detail: `${program.detail}${input.agent !== "copilot" && input.agent !== "mock" ? ` · modelo: ${model || "padrão do provider"}` : ""}`, fix: program.fix });
  if (input.agent === "codex" && program.ok) { const auth = spawnSync(executable("codex"), ["login", "status"], { encoding: "utf8", windowsHide: true }); checks.push({ key: "auth", status: auth.status === 0 ? "ok" : "error", title: auth.status === 0 ? "Codex autenticado" : "Login do Codex necessário", detail: (auth.stdout || auth.stderr || "").trim(), fix: auth.status === 0 ? undefined : "Execute codex login no terminal" }); }
  else if (input.agent === "claude" && program.ok) { const auth = spawnSync(executable("claude"), ["auth", "status"], { encoding: "utf8", windowsHide: true }); checks.push({ key: "auth", status: auth.status === 0 ? "ok" : "error", title: auth.status === 0 ? "Claude autenticado" : "Login do Claude necessário", detail: (auth.stdout || auth.stderr || "").trim(), fix: auth.status === 0 ? undefined : "Abra claude no terminal e conclua o login" }); }
  else if (input.agent === "antigravity" && program.ok) { const auth = spawnSync(executable("agy"), ["models"], { encoding: "utf8", windowsHide: true, timeout: 30_000 }); const modelOutput = String(auth.stdout || auth.stderr || ""); models = [...new Set(modelOutput.match(/\b(?:gemini|claude)-[a-z0-9][a-z0-9.-]*\b/gi) || [])]; checks.push({ key: "auth", status: auth.status === 0 ? "ok" : "error", title: auth.status === 0 ? "Antigravity autenticado" : "Login do Antigravity necessário", detail: modelOutput.trim().split("\n").slice(0, 4).join("\n"), fix: auth.status === 0 ? undefined : "Abra agy no terminal e conclua o login" }); }
  else checks.push({ key: "auth", status: program.ok ? "warning" : "error", title: input.agent === "copilot" ? "Login confirmado ao iniciar" : "Autenticação", detail: input.agent === "copilot" ? "A Copilot CLI valida a sessão na primeira execução" : "Não aplicável", fix: input.agent === "copilot" ? "Se falhar, abra copilot no terminal e conclua o login" : undefined });
  try { const response = await fetch(`${String(input.hub || DEFAULT_HUB).replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5_000) }); checks.push({ key: "hub", status: response.ok ? "ok" : "error", title: response.ok ? "Hub acessível" : "Hub respondeu com erro", detail: `HTTP ${response.status}`, fix: response.ok ? undefined : "Confira a internet ou o endereço do Hub" }); }
  catch (error) { checks.push({ key: "hub", status: "error", title: "Hub inacessível", detail: error instanceof Error ? error.message : String(error), fix: "Confira a conexão com a internet e tente novamente" }); }
  return { ok: !checks.some((check) => check.status === "error"), checkedAt: new Date().toISOString(), projectDirectory, model, models, checks };
}
async function reportStartupFailure(stateFile, cause) {
  try { const state = JSON.parse(readFileSync(stateFile, "utf8")); const details = cause instanceof Error ? cause.stack || cause.message : String(cause); const text = details.toLowerCase(); const auth = /auth|login|não autentic|not authenticated/.test(text); const missing = /enoent|command not found|não encontrado|cannot find/.test(text); const payload = { code: auth ? "AUTH_REQUIRED" : missing ? "TOOL_MISSING" : "STARTUP_FAILED", title: auth ? "Login necessário" : missing ? "Ferramenta não encontrada" : "Runner não iniciou", message: auth ? "A IA precisa ser autenticada neste computador." : missing ? "A ferramenta da IA não foi encontrada no PATH." : "O processo do runner encerrou durante a inicialização.", operation: "START_RUNNER", retryable: true, suggestedAction: auth ? "Abra a IA no terminal, conclua o login e tente novamente." : missing ? "Execute o diagnóstico e instale a ferramenta indicada." : "Confira o log local e tente iniciar a estação novamente.", taskId: null, technicalDetails: details, occurredAt: new Date().toISOString(), state: auth ? "AUTH_REQUIRED" : "BLOCKED" }; const base = String(state.hubUrl).replace(/\/$/, ""); await fetch(`${base}/rooms/${state.roomCode}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: state.participantId, kind: "RUNNER_ERROR", payload }) }); await fetch(`${base}/rooms/${state.roomCode}/presence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: state.participantId, state: payload.state }) }); } catch {}
}
async function stopLegacyAgent(legacy) {
  if (!legacy?.port || !legacy?.token) return;
  try { const headers = { "x-mireva-token": legacy.token }; const health = await fetch(`http://127.0.0.1:${legacy.port}/health`, { headers, signal: AbortSignal.timeout(1_500) }); if (!health.ok) return; const result = await health.json(); for (const session of Array.isArray(result.sessions) ? result.sessions : []) if (session.id) await fetch(`http://127.0.0.1:${legacy.port}/sessions/${session.id}/stop`, { method: "POST", headers, signal: AbortSignal.timeout(1_500) }).catch(() => undefined); } catch {}
}
function startAgentServer({ runtimeDirectory = process.env.MIREVA_RUNTIME_DIR, port = agentConfig().port, token = agentConfig().token } = {}) {
  if (!runtimeDirectory) throw new Error("MIREVA_RUNTIME_DIR não informado");
  const sessions = new Map();
  const sessionsFile = join(process.env.MIREVA_HOME || join(homedir(), ".mireva"), "sessions.json");
  const persistSessions = () => { mkdirSync(dirname(sessionsFile), { recursive: true }); writeFileSync(sessionsFile, `${JSON.stringify([...sessions.values()].filter((session) => !session.stopped).map(({ child, timer, ...session }) => session), null, 2)}\n`); };
  const launch = async (input, saved = {}) => {
    const sessionId = saved.id || randomUUID(); const state = saved.state || join(input.projectDirectory, ".mireva", `runner-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent"}.json`); mkdirSync(dirname(state), { recursive: true });
    // A reconexão atualiza a estação existente no Hub e preserva o mesmo ID,
    // inclusive quando modelo, função ou permissões mudam.
    await runJoin(runtimeDirectory, input, state);
    const log = saved.log || join(input.projectDirectory, ".mireva", `agent-${sessionId}.log`); const workerCommand = input.role === "ORCHESTRATOR" ? "orchestrate" : "work"; const logFd = openSync(log, "a"); let child;
    try { child = command(runtimeDirectory, [workerCommand, "--state", state, "--adapter", input.agent, "--project-dir", input.projectDirectory], { cwd: input.projectDirectory, detached: true, stdio: ["ignore", logFd, logFd] }); } finally { closeSync(logFd); }
    child.unref(); const session = { ...saved, id: sessionId, ...input, state, log, startedAt: saved.startedAt || new Date().toISOString(), restartedAt: saved.startedAt ? new Date().toISOString() : undefined, restartCount: Number(saved.restartCount || 0), stopped: false, child }; sessions.set(sessionId, session); persistSessions();
    child.on("exit", (code) => { const current = sessions.get(sessionId); if (!current || current.stopped || current.child !== child) return; current.restartCount += 1; appendFileSync(log, `\n[Mireva] Runner encerrou com código ${code}. Tentativa ${current.restartCount}/5.\n`); if (current.restartCount > 5) { current.stopped = true; persistSessions(); return; } const wait = Math.min(30_000, 1_000 * 2 ** (current.restartCount - 1)); current.timer = setTimeout(() => void launch(input, current).catch((error) => appendFileSync(log, `\n[Mireva] Falha ao reiniciar: ${error instanceof Error ? error.message : String(error)}\n`)), wait); });
    return session;
  };
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") return json(response, 204, {});
    if (request.headers["x-mireva-token"] !== token) return json(response, 401, { error: "Mireva Agent não autorizado" });
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, sessions: [...sessions.values()].map((session) => ({ id: session.id, name: session.name, agent: session.agent, model: session.model ?? null, role: session.role, projectDirectory: session.projectDirectory, log: session.log, startedAt: session.startedAt, restartedAt: session.restartedAt, restartCount: session.restartCount, running: session.child.exitCode === null && !session.stopped })) });
      if (request.method === "POST" && url.pathname === "/diagnostics") return json(response, 200, await diagnostics(await body(request)));
      const sessionLog = url.pathname.match(/^\/sessions\/([^/]+)\/log$/);
      if (request.method === "GET" && sessionLog) { const session = sessions.get(sessionLog[1]); if (!session) return json(response, 404, { error: "Runner não encontrado" }); return json(response, 200, { id: session.id, log: logTail(session.log), filename: session.log }); }
      if (request.method === "POST" && url.pathname === "/connect") {
        const input = valid(await body(request));
        const activeSession = [...sessions.values()].find((session) => !session.stopped && session.name === input.name && session.agent === input.agent && (session.model ?? null) === (input.model ?? null) && session.projectDirectory === input.projectDirectory && session.child.exitCode === null);
        if (activeSession) return json(response, 200, { id: activeSession.id, log: activeSession.log, model: activeSession.model ?? null, reused: true });
        for (const previous of sessions.values()) if (!previous.stopped && previous.name === input.name && previous.projectDirectory === input.projectDirectory) { previous.stopped = true; if (previous.timer) clearTimeout(previous.timer); terminateProcessTree(previous.child); }
        const session = await launch(input); try { await verifyStartup(session.child, session.log); } catch (error) { await reportStartupFailure(session.state, error); throw error; }
        return json(response, 201, { id: session.id, log: session.log, model: session.model ?? null });
      }
      const stop = url.pathname.match(/^\/sessions\/([^/]+)\/stop$/);
      if (request.method === "POST" && stop) { const session = sessions.get(stop[1]); if (!session) return json(response, 404, { error: "Runner não encontrado nesta sessão" }); session.stopped = true; if (session.timer) clearTimeout(session.timer); terminateProcessTree(session.child); persistSessions(); return json(response, 200, { stopped: true }); }
      return json(response, 404, { error: "Rota não encontrada" });
    } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
  });
  server.listen(port, "127.0.0.1", () => { const address = server.address(); const restoreProject = process.env.MIREVA_PROJECT_DIR ? resolve(process.env.MIREVA_PROJECT_DIR) : null; console.log(`Mireva Agent ativo em http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`); void stopLegacyAgent(agentConfig().legacy); try { const saved = JSON.parse(readFileSync(sessionsFile, "utf8")); for (const session of Array.isArray(saved) ? saved : []) if (!session.stopped && existsSync(session.projectDirectory) && (!restoreProject || resolve(session.projectDirectory) === restoreProject)) void launch(session, session).catch((error) => console.error(`Não foi possível restaurar ${session.name}:`, error)); } catch {} });
  return server;
}
if (require.main === module) startAgentServer();
module.exports = { agentConfig, startAgentServer, terminateProcessTree };
