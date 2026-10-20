import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import type { HubSnapshot, OrchestrationPlanRecord, Participant, RoomEvent, Task } from "@mireva/protocol";
import "./styles.css";
import "./sprites.css";
import "./monitor.css";
import "./runner-connect.css";

const defaultHub = "https://mireva-hub.renatojosesfc.workers.dev";
const inviteParameters = new URLSearchParams(window.location.search);
const initialHub = inviteParameters.get("hub") ?? localStorage.getItem("mireva:hub") ?? defaultHub;
const initialRoom = inviteParameters.get("room") ?? localStorage.getItem("mireva:room") ?? "";
const localAgentUrl = import.meta.env.VITE_MIREVA_AGENT_URL ?? "http://127.0.0.1:49321";
const localAgentToken = import.meta.env.VITE_MIREVA_AGENT_TOKEN ?? "";
const inviteBaseUrl = import.meta.env.VITE_MIREVA_INVITE_BASE_URL || window.location.origin;
const roles = ["GENERAL", "ORCHESTRATOR", "DEVELOPMENT", "RESEARCH", "TEST", "REVIEW"] as const;
const roleInfo: Record<(typeof roles)[number], { label: string; icon: string; capabilities: string[] }> = {
  GENERAL: { label: "Geral", icon: "✦", capabilities: [] }, ORCHESTRATOR: { label: "Orquestrador", icon: "◎", capabilities: ["ORCHESTRATE"] }, DEVELOPMENT: { label: "Desenvolvimento", icon: "⌘", capabilities: ["CODE", "GIT"] }, RESEARCH: { label: "Pesquisa", icon: "⌕", capabilities: ["RESEARCH"] }, TEST: { label: "Testes", icon: "✓", capabilities: ["TEST"] }, REVIEW: { label: "Revisão", icon: "◇", capabilities: ["REVIEW", "GIT"] },
};
const stateInfo: Record<string, { label: string; color: string; icon: string }> = {
  AVAILABLE: { label: "Disponível", color: "#55b9ff", icon: "✦" }, WORKING: { label: "Trabalhando", color: "#52e09d", icon: "↟" }, RESEARCHING: { label: "Pesquisando", color: "#ffd85c", icon: "⌕" }, TESTING: { label: "Testando", color: "#b08cff", icon: "✓" }, WAITING_APPROVAL: { label: "Aguardando aprovação", color: "#ffab65", icon: "!" }, BLOCKED: { label: "Bloqueado", color: "#ff6876", icon: "×" }, DISCONNECTED: { label: "Desconectado", color: "#7d849b", icon: "○" },
};
const taskStates = ["BACKLOG", "READY", "CLAIMED", "RUNNING", "REVIEW", "DONE"];
const progressFor = (task?: Task) => !task ? 0 : ({ BACKLOG: 5, READY: 15, CLAIMED: 30, RUNNING: 58, REVIEW: 88, DONE: 100, FAILED: 100, BLOCKED: 38, CANCELLED: 100, WAITING_APPROVAL: 92 }[task.status] ?? 0);
const taskStateLabel = (status: string) => ({ BACKLOG: "Fila", READY: "Pronta", CLAIMED: "Assumida", RUNNING: "Em execução", REVIEW: "Em revisão", DONE: "Concluída" }[status] ?? status);
const spriteNames = ["renato", "codex", "copilot", "gemini", "qa"];
const pixelAvatarUrl = (seed: string) => `/sprites/${spriteNames[[...seed].reduce((total, char) => total + char.charCodeAt(0), 0) % spriteNames.length]}.svg`;
const usagePercent = (usage: Participant["usage"]) => usage ? Math.min(100, Math.round((usage.used / usage.limit) * 100)) : null;
const usageTone = (usage: Participant["usage"]) => { const percent = usagePercent(usage) ?? 0; return percent >= 90 ? "danger" : percent >= 70 ? "warning" : "safe"; };
const seenLabel = (value: string) => { const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000)); return seconds < 10 ? "agora" : seconds < 60 ? `há ${seconds}s` : seconds < 3_600 ? `há ${Math.floor(seconds / 60)} min` : `há ${Math.floor(seconds / 3_600)} h`; };

function App() {
  const [hub, setHub] = useState(initialHub);
  const [roomCode, setRoomCode] = useState(initialRoom);
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOrchestrator, setShowOrchestrator] = useState(false);
  const [showRunnerConnect, setShowRunnerConnect] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    if (!roomCode) return;
    try {
      const [room, log] = await Promise.all([
        fetch(`${hub}/rooms/${roomCode}`).then(async (response) => { if (!response.ok) throw new Error("Sala não encontrada"); return response.json() as Promise<HubSnapshot>; }),
        fetch(`${hub}/rooms/${roomCode}/events?after=0`).then(async (response) => { if (!response.ok) throw new Error("Não foi possível carregar os eventos"); return response.json() as Promise<RoomEvent[]>; }),
      ]);
      const normalizedRoom = { ...room, plans: room.plans ?? [] };
      setSnapshot(normalizedRoom); setEvents(log); setSelectedId((current) => current ?? normalizedRoom.participants[0]?.id ?? null); setError("");
      localStorage.setItem("mireva:hub", hub); localStorage.setItem("mireva:room", roomCode);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a sala"); }
  };
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 2_500); return () => window.clearInterval(timer); }, [hub, roomCode]);
  const assigned = useMemo(() => new Map(snapshot?.tasks.filter((task) => task.assignedParticipantId).map((task) => [task.assignedParticipantId!, task])), [snapshot]);
  const selected = selectedId ? snapshot?.participants.find((person) => person.id === selectedId) : undefined;
  const selectedTask = selected ? assigned.get(selected.id) : undefined;
  const desks = Array.from({ length: 5 }, (_, index) => snapshot?.participants[index] ?? null);
  const activeCount = snapshot?.participants.filter((person) => person.state !== "DISCONNECTED").length ?? 0;
  const decide = async (task: Task, status: "DONE" | "WAITING_APPROVAL") => {
    if (!snapshot) return;
    const result = status === "DONE" ? "Aprovada pelo responsável" : window.prompt("Qual ajuste o agente precisa fazer?");
    if (result === null) return;
    try { const response = await fetch(`${hub}/rooms/${roomCode}/tasks/${task.id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownerId: snapshot.room.ownerId, status, result }) }); if (!response.ok) throw new Error("Não foi possível registrar a decisão"); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar a decisão"); }
  };
  const sendRequest = async () => {
    if (!snapshot || !requestText.trim()) return;
    try { const response = await fetch(`${hub}/rooms/${roomCode}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: snapshot.room.ownerId, kind: "ORCHESTRATOR_REQUEST", payload: { message: requestText.trim() } }) }); if (!response.ok) throw new Error("Não foi possível enviar o pedido"); setRequestText(""); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível enviar o pedido"); }
  };
  const decidePlan = async (plan: OrchestrationPlanRecord, status: "APPROVED" | "REJECTED") => {
    if (!snapshot) return;
    try { const response = await fetch(`${hub}/rooms/${roomCode}/plans/${plan.id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownerId: snapshot.room.ownerId, status }) }); if (!response.ok) throw new Error("Não foi possível decidir o plano"); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível decidir o plano"); }
  };
  const dispatchTasks = async () => {
    if (!snapshot) return;
    try { const response = await fetch(`${hub}/rooms/${roomCode}/tasks/dispatch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownerId: snapshot.room.ownerId }) }); if (!response.ok) throw new Error("Não foi possível distribuir as tarefas"); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível distribuir as tarefas"); }
  };
  const updateProjectMemory = async (content: string) => {
    if (!snapshot) return;
    try { const response = await fetch(`${hub}/rooms/${roomCode}/memory`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownerId: snapshot.room.ownerId, content }) }); if (!response.ok) throw new Error("Não foi possível salvar a memória do projeto"); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a memória do projeto"); }
  };
  const configureParticipant = async (participant: Participant, role: (typeof roles)[number], capabilities: string[]) => {
    if (!snapshot) return;
    try {
      const response = await fetch(`${hub}/rooms/${roomCode}/participants/${participant.id}/config`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ownerId: snapshot.room.ownerId, role, capabilities }) });
      if (!response.ok) throw new Error("Não foi possível atualizar a estação");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível atualizar a estação"); }
  };
  const reportUsage = async (participant: Participant, input: { used: number; limit: number; unit: string; resetAt: string | null }) => {
    if (!snapshot) return;
    try {
      const response = await fetch(`${hub}/rooms/${roomCode}/participants/${participant.id}/usage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reporterId: snapshot.room.ownerId, ...input }) });
      if (!response.ok) throw new Error("Não foi possível registrar o limite");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar o limite"); }
  };
  return <main className="office-app">
    <header className="topbar"><div><p className="eyebrow">MIREVA WORKSPACE <span>•</span> LIVE OFFICE</p><h1>{snapshot?.room.name ?? "Seu escritório de IAs"}</h1><p className="subtitle">Acompanhe a equipe, as tarefas e as decisões em um só lugar.</p></div><div className="topbar-status"><span className={snapshot ? "live-dot" : "offline-dot"} />{snapshot ? "Sala sincronizada" : "Aguardando conexão"}</div></header>
    <section className="connect-bar" aria-label="Conectar a uma sala"><label>Hub<input value={hub} onChange={(event) => setHub(event.target.value.replace(/\/$/, ""))} aria-label="URL do Hub" /></label><label>Sala<input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="CÓDIGO DA SALA" aria-label="Código da sala" /></label><button onClick={() => void load()}>Abrir escritório <span>↗</span></button><button className="add-runner-button" onClick={() => setShowRunnerConnect(true)}>+ Conectar IA</button></section>
    {error && <p className="error-message">{error}</p>}
    {showRunnerConnect && <RunnerConnectWizard roomCode={roomCode} hub={hub} onClose={() => setShowRunnerConnect(false)} />}
    {snapshot && <>
      <section className="stats" aria-label="Resumo do projeto"><Metric value={`${activeCount}/5`} label="agentes ativos" /><Metric value={snapshot.tasks.filter((task) => task.status === "RUNNING").length} label="em execução" /><Metric value={snapshot.tasks.filter((task) => task.status === "REVIEW").length} label="pedem decisão" /><Metric value={snapshot.tasks.filter((task) => task.status === "DONE").length} label="entregas feitas" /></section>
      <MonitoringPanel participants={snapshot.participants} assigned={assigned} />
      <section className="workspace-layout"><div className="scene-card"><div className="scene-heading"><div><p className="eyebrow">VISÃO OPERACIONAL</p><h2>O escritório agora</h2></div><span>Atualiza em tempo real</span></div><div className="office-scene pixel-office"><div className="pixel-wall" /><div className="pixel-window window-one" /><div className="pixel-window window-two" /><div className="pixel-rug" /><div className="pixel-cabinet" /><div className="scene-lamp lamp-one" /><div className="scene-lamp lamp-two" /><div className="plant plant-left">✦</div><div className="plant plant-right">✦</div><div className="wall-screen"><span>PROJETO</span><strong>{snapshot.tasks.filter((task) => task.status === "DONE").length}/{snapshot.tasks.length || 0}</strong><small>tarefas concluídas</small></div><button className="orchestrator" onClick={() => { setShowOrchestrator(true); setSelectedId(null); }} aria-label="Centro de orquestração"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><b>MI</b><div><strong>Orquestrador</strong><small>Distribui a próxima tarefa</small></div></button><div className="desk-grid">{desks.map((person, index) => <Desk key={person?.id ?? `slot-${index}`} person={person} task={person ? assigned.get(person.id) : undefined} index={index} selected={person?.id === selected?.id} onSelect={() => { if (person) { setShowOrchestrator(false); setSelectedId(person.id); } }} />)}</div></div><div className="scene-footer"><span><i /> Ativo</span><span><i /> Clique em uma estação para inspecionar</span><span>{activeCount} de 5 mesas conectadas</span></div></div>
        <aside className="agent-panel">{showOrchestrator || !selected ? <OrchestratorDetails snapshot={snapshot} events={events} onDecision={decide} onPlanDecision={decidePlan} onDispatch={dispatchTasks} onMemoryUpdate={updateProjectMemory} requestText={requestText} onRequestText={setRequestText} onRequest={sendRequest} /> : <><AgentDetails person={selected} task={selectedTask} events={events} onConfigure={configureParticipant} /><UsageDetails person={selected} onReport={reportUsage} /></>}</aside></section>
      <section className="flow-section"><div className="section-heading"><div><p className="eyebrow">FLUXO DE TRABALHO</p><h2>Quadro do projeto</h2></div><span>{snapshot.tasks.length} tarefas no total</span></div><div className="task-flow">{taskStates.map((state) => <div className="flow-column" key={state}><h3>{taskStateLabel(state)} <small>{snapshot.tasks.filter((task) => task.status === state).length}</small></h3>{snapshot.tasks.filter((task) => task.status === state).map((task) => <TaskCard key={task.id} task={task} />)}{!snapshot.tasks.some((task) => task.status === state) && <p className="empty-state">Sem tarefas</p>}</div>)}</div></section>
      <ActivityStream events={events} />
    </>}
  </main>;
}
function Metric({ value, label }: { value: string | number; label: string }) { return <div className="metric"><strong>{value}</strong><span>{label}</span></div>; }
function RunnerConnectWizard({ roomCode, hub, onClose }: { roomCode: string; hub: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [agent, setAgent] = useState<"copilot" | "codex">("copilot");
  const [isOrchestrator, setIsOrchestrator] = useState(false);
  const role = isOrchestrator ? "ORCHESTRATOR" : "GENERAL";
  const capabilities = isOrchestrator ? "ORCHESTRATE" : "CODE,RESEARCH,TEST,GIT";
  const [copied, setCopied] = useState(false);
  const [projectDirectory, setProjectDirectory] = useState(import.meta.env.VITE_MIREVA_PROJECT_DIR ?? "");
  const [starting, setStarting] = useState(false);
  const [localMessage, setLocalMessage] = useState("");
  const quote = (value: string) => `"${value.replaceAll("\"", "\\\"")}"`;
  const command = `npx --yes github:RenatoJose7/Mireva-Workspace#main -- connect ${roomCode || "CODIGO_DA_SALA"} --hub ${quote(hub)} --name ${quote(name || "Nome do agente")} --agent ${agent} --role ${role} --capabilities ${quote(capabilities.replaceAll(" ", ""))}`;
  const inviteUrl = `${inviteBaseUrl}${window.location.pathname}?hub=${encodeURIComponent(hub)}&room=${encodeURIComponent(roomCode)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(inviteUrl)}`;
  const copy = async () => { try { await navigator.clipboard.writeText(command); setCopied(true); window.setTimeout(() => setCopied(false), 2_500); } catch { setCopied(false); } };
  const startLocal = async () => { setStarting(true); setLocalMessage(""); try { const response = await fetch(`${localAgentUrl}/connect`, { method: "POST", headers: { "content-type": "application/json", "x-mireva-token": localAgentToken }, body: JSON.stringify({ roomCode, hub, name, agent, role, capabilities: capabilities.split(",").map((value) => value.trim()).filter(Boolean), projectDirectory }) }); const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error ?? "Não foi possível iniciar o runner"); setLocalMessage("Runner iniciado nesta máquina. A estação aparecerá em alguns segundos."); } catch (cause) { setLocalMessage(cause instanceof Error ? cause.message : "Mireva Agent local indisponível. Use o comando copiado."); } finally { setStarting(false); } };
  return <div className="runner-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="runner-modal" role="dialog" aria-modal="true" aria-labelledby="runner-connect-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Fechar">×</button><p className="eyebrow">ENTRADA GUIADA</p><h2 id="runner-connect-title">Conectar uma IA à sala</h2><p className="runner-modal-intro">Os runners entram como agentes gerais e informam apenas o que conseguem fazer. O orquestrador decide as tarefas e a especialização de cada um.</p>{!roomCode && <p className="wizard-warning">Abra uma sala ou informe o código da sala antes de continuar.</p>}<div className="runner-form"><label>Nome da estação<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Copilot Frontend" autoFocus /></label><label>IA que vai trabalhar<select value={agent} onChange={(event) => setAgent(event.target.value as "copilot" | "codex")}><option value="copilot">GitHub Copilot</option><option value="codex">ChatGPT Codex</option></select></label><label className="project-folder">Pasta do projeto neste computador<input value={projectDirectory} onChange={(event) => setProjectDirectory(event.target.value)} placeholder="/home/voce/projetos/meu-site" /></label><label className="orchestrator-choice"><input type="checkbox" checked={isOrchestrator} onChange={(event) => setIsOrchestrator(event.target.checked)} /> Este é o orquestrador inicial da sala <small>Marque apenas para o agente que vai criar os planos.</small></label></div><button className="start-local-button" disabled={!roomCode || !name.trim() || !projectDirectory.trim() || starting} onClick={() => void startLocal()}>{starting ? "Iniciando…" : isOrchestrator ? "Iniciar orquestrador" : "Iniciar runner"}</button>{localMessage && <p className="local-message">{localMessage}</p>}<div className="invite-box"><div><span>CONVITE DA SALA</span><p>Envie este QR ou link para outro computador abrir a mesma sala.</p><code>{inviteUrl}</code></div><img src={qrUrl} alt="QR code do convite da sala" /></div><div className="generated-command"><span>ALTERNATIVA: COMANDO ÚNICO PARA OUTRO RUNNER</span><code>{command}</code><button disabled={!roomCode || !name.trim()} onClick={() => void copy()}>{copied ? "Copiado ✓" : "Copiar comando"}</button></div><p className="runner-footnote">O Copilot ou Codex ainda pede o login normal na primeira vez. O QR contém apenas o endereço do Hub e o código da sala.</p></section></div>;
}
function Desk({ person, task, index, selected, onSelect }: { person: Participant | null; task?: Task; index: number; selected: boolean; onSelect: () => void }) {
  if (!person) return <div className="desk-station vacant"><div className="desk-top"><span className="monitor off">+</span><span className="chair" /></div><div className="desk-label"><small>MESA {String(index + 1).padStart(2, "0")}</small><strong>Disponível</strong><span>Convide outro agente</span></div></div>;
  const info = stateInfo[person.state] ?? stateInfo.DISCONNECTED;
  const role = roleInfo[person.role ?? "GENERAL"] ?? roleInfo.GENERAL;
  return <button className={`desk-station ${selected ? "selected" : ""}`} style={{ "--accent": info.color } as CSSProperties} onClick={onSelect} aria-pressed={selected}><div className="desk-top"><img className="pixel-avatar" src={pixelAvatarUrl(person.name)} alt="" aria-hidden="true" /><span className="monitor"><i>{info.icon}</i></span><span className="keyboard" /><span className="chair" /><span className="presence-light" /></div><div className="desk-label"><small>MESA {String(index + 1).padStart(2, "0")}</small><strong>{person.name}</strong><span>{role.label} · {info.label}</span>{task && <em>{task.title}</em>}</div></button>;
}
function AgentDetails({ person, task, events, onConfigure }: { person: Participant; task?: Task; events: RoomEvent[]; onConfigure: (participant: Participant, role: (typeof roles)[number], capabilities: string[]) => void }) {
  const info = stateInfo[person.state] ?? stateInfo.DISCONNECTED;
  const [role, setRole] = useState<(typeof roles)[number]>(person.role ?? "GENERAL");
  const [capabilities, setCapabilities] = useState((person.capabilities ?? []).join(", "));
  useEffect(() => { setRole(person.role ?? "GENERAL"); setCapabilities((person.capabilities ?? []).join(", ")); }, [person]);
  const relevantEvents = events.filter((event) => event.participantId === person.id || (task && event.payload.taskId === task.id)).slice(-5).reverse();
  const deliveryEvent = relevantEvents.find((event) => typeof event.payload.delivery === "object" && event.payload.delivery !== null);
  const delivery = deliveryEvent?.payload.delivery as { branch?: string; files?: string[] } | undefined;
  const applyRole = () => onConfigure(person, role, capabilities.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
  return <><div className="panel-heading"><p className="eyebrow">ESTAÇÃO SELECIONADA</p><img className="agent-mark sprite-profile" src={pixelAvatarUrl(person.name)} alt="" /><h2>{person.name}</h2><p>{person.agent} <b>·</b> {roleInfo[role].label}</p><span className="state-chip" style={{ "--accent": info.color } as CSSProperties}>{info.icon} {info.label}</span></div><div className="task-focus"><span>TAREFA ATUAL</span>{task ? <><h3>{task.title}</h3><p>{task.description || "Sem descrição adicional."}</p><div className="progress-track"><i style={{ width: `${progressFor(task)}%`, background: info.color }} /></div><small>{progressFor(task)}% · {taskStateLabel(task.status)}</small></> : <p>Este agente está livre para receber a próxima tarefa.</p>}</div><div className="detail-grid"><Detail label="Ferramenta" value={person.agent} /><Detail label="Função" value={roleInfo[role].label} /><Detail label="Branch" value={delivery?.branch ?? "Ainda não informado"} /><Detail label="Arquivos" value={delivery?.files?.length ? `${delivery.files.length} alterado(s)` : "Aguardando runner"} /></div>{person.agent !== "human" && <div className="station-config"><span>CONFIGURAR ESTAÇÃO</span><label>Função<select value={role} onChange={(event) => { const next = event.target.value as (typeof roles)[number]; setRole(next); setCapabilities(roleInfo[next].capabilities.join(", ")); }}>{roles.map((entry) => <option key={entry} value={entry}>{roleInfo[entry].label}</option>)}</select></label><label>Capacidades<input value={capabilities} onChange={(event) => setCapabilities(event.target.value)} placeholder="CODE, TEST" /></label><button onClick={applyRole}>Salvar função</button></div>}{delivery?.files?.length ? <div className="files-list"><span>ARQUIVOS OBSERVADOS</span>{delivery.files.slice(0, 4).map((file) => <code key={file}>{file}</code>)}</div> : null}<div className="panel-log"><div><h3>Eventos e atividade</h3><span>{relevantEvents.length}</span></div>{relevantEvents.length ? relevantEvents.map((event) => <p key={event.id}><i />{event.kind.replaceAll("_", " ")}<time>{new Date(event.createdAt).toLocaleTimeString("pt-BR")}</time></p>) : <p className="muted">Ainda não há eventos deste agente.</p>}</div></>;
}
function MonitoringPanel({ participants, assigned }: { participants: Participant[]; assigned: Map<string, Task> }) {
  const runners = participants.filter((participant) => participant.agent !== "human");
  const reported = runners.filter((participant) => participant.usage).length;
  return <section className="monitoring-section"><div className="section-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Saúde dos runners</h2></div><span>{reported}/{runners.length} limites informados</span></div><div className="runner-watch-list">{runners.map((person) => { const info = stateInfo[person.state] ?? stateInfo.DISCONNECTED; const usage = person.usage; const percent = usagePercent(usage); const task = assigned.get(person.id); return <article className="runner-watch" key={person.id}><header><img src={pixelAvatarUrl(person.name)} alt="" /><div><strong>{person.name}</strong><span>{person.agent} · visto {seenLabel(person.lastSeenAt)}</span></div><i style={{ background: info.color, boxShadow: `0 0 10px ${info.color}` }} /></header><p>{task?.title ?? (person.state === "DISCONNECTED" ? "Runner desconectado" : "Livre para receber tarefa")}</p>{usage && percent !== null ? <><div className={`limit-bar ${usageTone(usage)}`}><i style={{ width: `${percent}%` }} /></div><footer><b>{percent}%</b><span>{usage.used}/{usage.limit} {usage.unit}</span>{usage.resetAt && <em>reinicia {new Date(usage.resetAt).toLocaleDateString("pt-BR")}</em>}</footer></> : <footer className="limit-empty"><span>Limite ainda não informado</span></footer>}</article>; })}{!runners.length && <p className="empty-state">Conecte um runner para acompanhar sua atividade.</p>}</div></section>;
}

function UsageDetails({ person, onReport }: { person: Participant; onReport: (participant: Participant, input: { used: number; limit: number; unit: string; resetAt: string | null }) => void }) {
  const [used, setUsed] = useState(String(person.usage?.used ?? ""));
  const [limit, setLimit] = useState(String(person.usage?.limit ?? ""));
  const [unit, setUnit] = useState(person.usage?.unit ?? "créditos");
  const [resetAt, setResetAt] = useState(person.usage?.resetAt ? person.usage.resetAt.slice(0, 16) : "");
  useEffect(() => { setUsed(String(person.usage?.used ?? "")); setLimit(String(person.usage?.limit ?? "")); setUnit(person.usage?.unit ?? "créditos"); setResetAt(person.usage?.resetAt ? person.usage.resetAt.slice(0, 16) : ""); }, [person]);
  if (person.agent === "human") return null;
  const save = () => { const nextUsed = Number(used); const nextLimit = Number(limit); if (!Number.isFinite(nextUsed) || !Number.isFinite(nextLimit) || nextUsed < 0 || nextLimit <= 0) return; onReport(person, { used: nextUsed, limit: nextLimit, unit: unit.trim() || "créditos", resetAt: resetAt ? new Date(resetAt).toISOString() : null }); };
  const percent = usagePercent(person.usage);
  return <div className="usage-config"><div><span>LIMITE DO PROVEDOR</span>{percent !== null ? <b>{percent}% informado</b> : <b>Configure quando souber seu saldo</b>}</div><p>Registro manual: cada provedor mostra créditos e janelas de uso de um jeito diferente.</p><div className="usage-fields"><label>Usado<input type="number" min="0" value={used} onChange={(event) => setUsed(event.target.value)} placeholder="0" /></label><label>Limite<input type="number" min="1" value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="100" /></label><label>Unidade<input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="créditos" /></label><label>Reinicia em<input type="datetime-local" value={resetAt} onChange={(event) => setResetAt(event.target.value)} /></label></div><button disabled={!limit || Number(limit) <= 0} onClick={save}>Atualizar acompanhamento</button></div>;
}

function ProjectMemory({ content, onSave }: { content: string; onSave: (content: string) => void }) { const [draft, setDraft] = useState(content); useEffect(() => setDraft(content), [content]); return <div className="project-memory"><span>MEMÓRIA DO PROJETO</span><p>Decisões, regras e contexto que o orquestrador e os runners recebem automaticamente.</p><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ex.: usar React, manter o visual sóbrio, não alterar a página inicial..." /><button disabled={draft === content} onClick={() => onSave(draft)}>Salvar memória</button></div>; }
function OrchestratorDetails({ snapshot, events, onDecision, onPlanDecision, onDispatch, onMemoryUpdate, requestText, onRequestText, onRequest }: { snapshot: HubSnapshot; events: RoomEvent[]; onDecision: (task: Task, status: "DONE" | "WAITING_APPROVAL") => void; onPlanDecision: (plan: OrchestrationPlanRecord, status: "APPROVED" | "REJECTED") => void; onDispatch: () => void; onMemoryUpdate: (content: string) => void; requestText: string; onRequestText: (value: string) => void; onRequest: () => void }) { const reviewTasks = snapshot.tasks.filter((task) => task.status === "REVIEW"); const draftPlan = snapshot.plans.find((plan) => plan.status === "DRAFT"); const readyTasks = snapshot.tasks.filter((task) => task.status === "READY"); const conversation = events.filter((event) => ["ORCHESTRATOR_REQUEST", "ORCHESTRATOR_RESPONSE", "PLAN_CREATED"].includes(event.kind)).slice(-5); return <><div className="panel-heading"><p className="eyebrow">CENTRO DE CONTROLE</p><span className="agent-mark orchestrator-mark">MI</span><h2>Orquestrador</h2><p>Organiza a fila de trabalho da sala.</p><span className="state-chip neutral">✦ Monitorando o projeto</span></div><ProjectMemory content={snapshot.projectMemory ?? ""} onSave={onMemoryUpdate} /><div className="orchestrator-chat"><span>CONVERSE COM O ORQUESTRADOR</span><div className="conversation">{conversation.length ? conversation.map((event) => <p className={event.kind === "ORCHESTRATOR_REQUEST" ? "from-owner" : "from-orchestrator"} key={event.id}>{event.kind === "ORCHESTRATOR_REQUEST" ? String(event.payload.message ?? "Pedido enviado") : String((event.payload.orchestrator as { summary?: string } | undefined)?.summary ?? event.payload.message ?? "Plano criado")}</p>) : <p className="chat-hint">Descreva o objetivo do projeto. O orquestrador criará um plano quando estiver conectado.</p>}</div><textarea value={requestText} onChange={(event) => onRequestText(event.target.value)} placeholder="Ex.: Crie um site institucional para uma cafeteria..." /><button disabled={!requestText.trim()} onClick={onRequest}>Enviar pedido <span>↗</span></button></div>{draftPlan ? <div className="plan-card"><span>PLANO PROPOSTO · {draftPlan.tasks.length} TAREFAS</span><strong>{draftPlan.summary}</strong><ol>{draftPlan.tasks.map((task, index) => <li key={`${task.title}-${index}`}>{task.title}{task.dependencies.length ? <small> depende de {task.dependencies.map((dependency) => dependency + 1).join(", ")}</small> : null}</li>)}</ol><div><button onClick={() => onPlanDecision(draftPlan, "APPROVED")}>Aprovar plano</button><button onClick={() => onPlanDecision(draftPlan, "REJECTED")}>Recusar</button></div></div> : null}{readyTasks.length ? <button className="dispatch-button" onClick={onDispatch}>Distribuir {readyTasks.length} tarefa(s) pronta(s)</button> : null}<div className="task-focus"><span>PRÓXIMA DECISÃO</span><h3>{reviewTasks[0]?.title ?? "Nada aguardando aprovação"}</h3><p>{reviewTasks.length ? "Uma entrega está pronta para sua decisão." : "O fluxo está livre para continuar."}</p></div>{reviewTasks.map((task) => <div className="decision-card" key={task.id}><strong>{task.title}</strong><p>{task.result ?? "Entrega aguardando sua revisão."}</p><div><button onClick={() => onDecision(task, "DONE")}>Aprovar</button><button onClick={() => onDecision(task, "WAITING_APPROVAL")}>Pedir ajuste</button></div></div>)}<div className="detail-grid"><Detail label="Tarefas prontas" value={readyTasks.length} /><Detail label="Em revisão" value={reviewTasks.length} /><Detail label="Agentes" value={`${snapshot.participants.length}/5`} /><Detail label="Eventos" value={snapshot.lastSequence} /></div></>;
}
function Detail({ label, value }: { label: string; value: string | number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function TaskCard({ task }: { task: Task }) { return <article className="task-card"><span>P{task.priority}</span><h4>{task.title}</h4>{task.description && <p>{task.description}</p>}<footer>{task.assignedParticipantId ? "Com agente" : "Sem agente"}<b>{task.dependencies.length ? `${task.dependencies.length} dep.` : "Livre"}</b></footer></article>; }
function ActivityStream({ events }: { events: RoomEvent[] }) { const items = events.slice(-10).reverse(); const deliveries = events.filter((event) => typeof event.payload.delivery === "object").length; return <section className="activity-section"><div className="section-heading"><div><p className="eyebrow">ATIVIDADE AO VIVO</p><h2>O que a equipe está fazendo</h2></div><span>{deliveries} entrega(s) registradas · uso de créditos depende do provedor</span></div><div className="activity-list">{items.map((event) => <article key={event.id}><i className={`event-${event.kind.toLowerCase()}`} /><div><strong>{event.kind.replaceAll("_", " ")}</strong><p>{String((event.payload.event as { message?: string } | undefined)?.message ?? (event.payload.orchestrator as { summary?: string } | undefined)?.summary ?? (event.payload.task as { title?: string } | undefined)?.title ?? "Atualização registrada na sala")}</p></div><time>{new Date(event.createdAt).toLocaleTimeString("pt-BR")}</time></article>)}{!items.length && <p className="empty-state">Aguardando atividade na sala.</p>}</div></section>; }

createRoot(document.getElementById("root")!).render(<App />);
