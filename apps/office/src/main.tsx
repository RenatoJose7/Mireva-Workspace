import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import type { HubSnapshot, Participant, RoomEvent, Task } from "@mireva/protocol";
import "./styles.css";

const defaultHub = "https://mireva-hub.renatojosesfc.workers.dev";
const stateInfo: Record<string, { label: string; color: string; icon: string }> = {
  AVAILABLE: { label: "Disponível", color: "#55b9ff", icon: "✦" }, WORKING: { label: "Trabalhando", color: "#52e09d", icon: "↟" }, RESEARCHING: { label: "Pesquisando", color: "#ffd85c", icon: "⌕" }, TESTING: { label: "Testando", color: "#b08cff", icon: "✓" }, WAITING_APPROVAL: { label: "Aguardando aprovação", color: "#ffab65", icon: "!" }, BLOCKED: { label: "Bloqueado", color: "#ff6876", icon: "×" }, DISCONNECTED: { label: "Desconectado", color: "#7d849b", icon: "○" },
};
const taskStates = ["BACKLOG", "READY", "CLAIMED", "RUNNING", "REVIEW", "DONE"];
const progressFor = (task?: Task) => !task ? 0 : ({ BACKLOG: 5, READY: 15, CLAIMED: 30, RUNNING: 58, REVIEW: 88, DONE: 100, FAILED: 100, BLOCKED: 38, CANCELLED: 100, WAITING_APPROVAL: 92 }[task.status] ?? 0);
const taskStateLabel = (status: string) => ({ BACKLOG: "Fila", READY: "Pronta", CLAIMED: "Assumida", RUNNING: "Em execução", REVIEW: "Em revisão", DONE: "Concluída" }[status] ?? status);

function App() {
  const [hub, setHub] = useState(localStorage.getItem("mireva:hub") ?? defaultHub);
  const [roomCode, setRoomCode] = useState(localStorage.getItem("mireva:room") ?? "");
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    if (!roomCode) return;
    try {
      const [room, log] = await Promise.all([
        fetch(`${hub}/rooms/${roomCode}`).then(async (response) => { if (!response.ok) throw new Error("Sala não encontrada"); return response.json() as Promise<HubSnapshot>; }),
        fetch(`${hub}/rooms/${roomCode}/events?after=0`).then(async (response) => { if (!response.ok) throw new Error("Não foi possível carregar os eventos"); return response.json() as Promise<RoomEvent[]>; }),
      ]);
      setSnapshot(room); setEvents(log); setSelectedId((current) => current ?? room.participants[0]?.id ?? null); setError("");
      localStorage.setItem("mireva:hub", hub); localStorage.setItem("mireva:room", roomCode);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a sala"); }
  };
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 2_500); return () => window.clearInterval(timer); }, [hub, roomCode]);
  const assigned = useMemo(() => new Map(snapshot?.tasks.filter((task) => task.assignedParticipantId).map((task) => [task.assignedParticipantId!, task])), [snapshot]);
  const selected = selectedId ? snapshot?.participants.find((person) => person.id === selectedId) : undefined;
  const selectedTask = selected ? assigned.get(selected.id) : undefined;
  const desks = Array.from({ length: 5 }, (_, index) => snapshot?.participants[index] ?? null);
  const activeCount = snapshot?.participants.filter((person) => person.state !== "DISCONNECTED").length ?? 0;
  return <main className="office-app">
    <header className="topbar"><div><p className="eyebrow">MIREVA WORKSPACE <span>•</span> LIVE OFFICE</p><h1>{snapshot?.room.name ?? "Seu escritório de IAs"}</h1><p className="subtitle">Acompanhe a equipe, as tarefas e as decisões em um só lugar.</p></div><div className="topbar-status"><span className={snapshot ? "live-dot" : "offline-dot"} />{snapshot ? "Sala sincronizada" : "Aguardando conexão"}</div></header>
    <section className="connect-bar" aria-label="Conectar a uma sala"><label>Hub<input value={hub} onChange={(event) => setHub(event.target.value.replace(/\/$/, ""))} aria-label="URL do Hub" /></label><label>Sala<input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="CÓDIGO DA SALA" aria-label="Código da sala" /></label><button onClick={() => void load()}>Abrir escritório <span>↗</span></button></section>
    {error && <p className="error-message">{error}</p>}
    {snapshot && <>
      <section className="stats" aria-label="Resumo do projeto"><Metric value={`${activeCount}/5`} label="agentes ativos" /><Metric value={snapshot.tasks.filter((task) => task.status === "RUNNING").length} label="em execução" /><Metric value={snapshot.tasks.filter((task) => task.status === "REVIEW").length} label="pedem decisão" /><Metric value={snapshot.tasks.filter((task) => task.status === "DONE").length} label="entregas feitas" /></section>
      <section className="workspace-layout"><div className="scene-card"><div className="scene-heading"><div><p className="eyebrow">VISÃO OPERACIONAL</p><h2>O escritório agora</h2></div><span>Atualiza em tempo real</span></div><div className="office-scene"><div className="scene-lamp lamp-one" /><div className="scene-lamp lamp-two" /><div className="plant plant-left">✦</div><div className="plant plant-right">✦</div><div className="wall-screen"><span>PROJETO</span><strong>{snapshot.tasks.filter((task) => task.status === "DONE").length}/{snapshot.tasks.length || 0}</strong><small>tarefas concluídas</small></div><button className="orchestrator" onClick={() => setSelectedId(null)} aria-label="Centro de orquestração"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><b>MI</b><div><strong>Orquestrador</strong><small>Distribui a próxima tarefa</small></div></button><div className="desk-grid">{desks.map((person, index) => <Desk key={person?.id ?? `slot-${index}`} person={person} task={person ? assigned.get(person.id) : undefined} index={index} selected={person?.id === selected?.id} onSelect={() => person && setSelectedId(person.id)} />)}</div></div><div className="scene-footer"><span><i /> Ativo</span><span><i /> Clique em uma estação para inspecionar</span><span>{activeCount} de 5 mesas conectadas</span></div></div>
        <aside className="agent-panel">{selected ? <AgentDetails person={selected} task={selectedTask} events={events} /> : <OrchestratorDetails snapshot={snapshot} />}</aside></section>
      <section className="flow-section"><div className="section-heading"><div><p className="eyebrow">FLUXO DE TRABALHO</p><h2>Quadro do projeto</h2></div><span>{snapshot.tasks.length} tarefas no total</span></div><div className="task-flow">{taskStates.map((state) => <div className="flow-column" key={state}><h3>{taskStateLabel(state)} <small>{snapshot.tasks.filter((task) => task.status === state).length}</small></h3>{snapshot.tasks.filter((task) => task.status === state).map((task) => <TaskCard key={task.id} task={task} />)}{!snapshot.tasks.some((task) => task.status === state) && <p className="empty-state">Sem tarefas</p>}</div>)}</div></section>
    </>}
  </main>;
}
function Metric({ value, label }: { value: string | number; label: string }) { return <div className="metric"><strong>{value}</strong><span>{label}</span></div>; }
function Desk({ person, task, index, selected, onSelect }: { person: Participant | null; task?: Task; index: number; selected: boolean; onSelect: () => void }) {
  if (!person) return <div className="desk-station vacant"><div className="desk-top"><span className="monitor off">+</span><span className="chair" /></div><div className="desk-label"><small>MESA {String(index + 1).padStart(2, "0")}</small><strong>Disponível</strong><span>Convide outro agente</span></div></div>;
  const info = stateInfo[person.state] ?? stateInfo.DISCONNECTED;
  return <button className={`desk-station ${selected ? "selected" : ""}`} style={{ "--accent": info.color } as CSSProperties} onClick={onSelect} aria-pressed={selected}><div className="desk-top"><span className="monitor"><i>{info.icon}</i></span><span className="keyboard" /><span className="chair" /><span className="presence-light" /></div><div className="desk-label"><small>MESA {String(index + 1).padStart(2, "0")}</small><strong>{person.name}</strong><span>{info.label}</span>{task && <em>{task.title}</em>}</div></button>;
}
function AgentDetails({ person, task, events }: { person: Participant; task?: Task; events: RoomEvent[] }) {
  const info = stateInfo[person.state] ?? stateInfo.DISCONNECTED;
  const relevantEvents = events.filter((event) => event.participantId === person.id || (task && event.payload.taskId === task.id)).slice(-5).reverse();
  return <><div className="panel-heading"><p className="eyebrow">ESTAÇÃO SELECIONADA</p><span className="agent-mark" style={{ background: info.color }}>{person.name.slice(0, 1).toUpperCase()}</span><h2>{person.name}</h2><p>{person.agent} <b>·</b> Responsável: {person.name}</p><span className="state-chip" style={{ "--accent": info.color } as CSSProperties}>{info.icon} {info.label}</span></div><div className="task-focus"><span>TAREFA ATUAL</span>{task ? <><h3>{task.title}</h3><p>{task.description || "Sem descrição adicional."}</p><div className="progress-track"><i style={{ width: `${progressFor(task)}%`, background: info.color }} /></div><small>{progressFor(task)}% · {taskStateLabel(task.status)}</small></> : <p>Este agente está livre para receber a próxima tarefa.</p>}</div><div className="detail-grid"><Detail label="Ferramenta" value={person.agent} /><Detail label="Entrou na sala" value={new Date(person.joinedAt).toLocaleTimeString("pt-BR")} /><Detail label="Branch" value="Ainda não informado" /><Detail label="Arquivos" value="Aguardando runner" /></div><div className="panel-log"><div><h3>Eventos e atividade</h3><span>{relevantEvents.length}</span></div>{relevantEvents.length ? relevantEvents.map((event) => <p key={event.id}><i />{event.kind.replaceAll("_", " ")}<time>{new Date(event.createdAt).toLocaleTimeString("pt-BR")}</time></p>) : <p className="muted">Ainda não há eventos deste agente.</p>}</div></>;
}
function OrchestratorDetails({ snapshot }: { snapshot: HubSnapshot }) { return <><div className="panel-heading"><p className="eyebrow">CENTRO DE CONTROLE</p><span className="agent-mark orchestrator-mark">MI</span><h2>Orquestrador</h2><p>Organiza a fila de trabalho da sala.</p><span className="state-chip neutral">✦ Monitorando o projeto</span></div><div className="task-focus"><span>PRÓXIMA DECISÃO</span><h3>{snapshot.tasks.find((task) => task.status === "REVIEW")?.title ?? "Nada aguardando aprovação"}</h3><p>{snapshot.tasks.some((task) => task.status === "REVIEW") ? "Uma entrega está pronta para revisão humana." : "O fluxo está livre para continuar."}</p></div><div className="detail-grid"><Detail label="Tarefas prontas" value={snapshot.tasks.filter((task) => task.status === "READY").length} /><Detail label="Em revisão" value={snapshot.tasks.filter((task) => task.status === "REVIEW").length} /><Detail label="Agentes" value={`${snapshot.participants.length}/5`} /><Detail label="Eventos" value={snapshot.lastSequence} /></div></>;
}
function Detail({ label, value }: { label: string; value: string | number }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function TaskCard({ task }: { task: Task }) { return <article className="task-card"><span>P{task.priority}</span><h4>{task.title}</h4>{task.description && <p>{task.description}</p>}<footer>{task.assignedParticipantId ? "Com agente" : "Sem agente"}<b>{task.dependencies.length ? `${task.dependencies.length} dep.` : "Livre"}</b></footer></article>; }

createRoot(document.getElementById("root")!).render(<App />);
