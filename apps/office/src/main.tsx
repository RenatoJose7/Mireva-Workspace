import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HubSnapshot, RoomEvent, Task } from "@mireva/protocol";
import "./styles.css";

const defaultHub = "https://mireva-hub.renatojosesfc.workers.dev";
const states: Record<string, string> = { AVAILABLE: "Disponível", WORKING: "Trabalhando", RESEARCHING: "Pesquisando", TESTING: "Testando", WAITING_APPROVAL: "Aguardando aprovação", BLOCKED: "Bloqueado", DISCONNECTED: "Desconectado" };
const taskStates = ["BACKLOG", "READY", "CLAIMED", "RUNNING", "REVIEW", "DONE"];

function App() {
  const [hub, setHub] = useState(localStorage.getItem("mireva:hub") ?? defaultHub);
  const [roomCode, setRoomCode] = useState(localStorage.getItem("mireva:room") ?? "");
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [error, setError] = useState("");
  const load = async () => {
    if (!roomCode) return;
    try { const [room, log] = await Promise.all([fetch(`${hub}/rooms/${roomCode}`).then(async (r) => { if (!r.ok) throw new Error("Sala não encontrada"); return r.json() as Promise<HubSnapshot>; }), fetch(`${hub}/rooms/${roomCode}/events?after=0`).then((r) => r.json() as Promise<RoomEvent[]>)]); setSnapshot(room); setEvents(log); setError(""); localStorage.setItem("mireva:hub", hub); localStorage.setItem("mireva:room", roomCode); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar a sala"); }
  };
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 2500); return () => clearInterval(timer); }, [hub, roomCode]);
  const assigned = useMemo(() => new Map(snapshot?.tasks.filter((task) => task.assignedParticipantId).map((task) => [task.assignedParticipantId!, task])), [snapshot]);
  return <main>
    <header><div><p className="eyebrow">MIREVA OFFICE · AO VIVO</p><h1>{snapshot?.room.name ?? "Conectar à sua sala"}</h1></div><span className="connection">● Hub conectado</span></header>
    <section className="connect"><input value={hub} onChange={(e) => setHub(e.target.value.replace(/\/$/, ""))} aria-label="URL do Hub" /><input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="CÓDIGO DA SALA" aria-label="Código da sala" /><button onClick={() => void load()}>Abrir sala</button></section>
    {error && <p className="error">{error}</p>}
    {snapshot && <>
      <section className="summary"><div><strong>{snapshot.participants.length}</strong><span>participantes</span></div><div><strong>{snapshot.tasks.length}</strong><span>tarefas</span></div><div><strong>{snapshot.tasks.filter((task) => task.status === "DONE").length}</strong><span>entregas</span></div><div><strong>{snapshot.lastSequence}</strong><span>eventos</span></div></section>
      <section><div className="section-title"><h2>Escritório</h2><span>Atualiza a cada 2 segundos</span></div><div className="desks">{snapshot.participants.map((person, index) => <article className={`desk state-${person.state.toLowerCase()}`} key={person.id}><div className="avatar">{person.name.slice(0, 1).toUpperCase()}</div><div><h3>{person.name}</h3><p>{person.agent}</p><span className="badge">{states[person.state] ?? person.state}</span>{assigned.get(person.id) && <small>Trabalhando em: {assigned.get(person.id)!.title}</small>}</div><span className="desk-number">{String(index + 1).padStart(2, "0")}</span></article>)}</div></section>
      <section><div className="section-title"><h2>Fluxo de trabalho</h2><span>Dados reais da sala</span></div><div className="board">{taskStates.map((state) => <div className="column" key={state}><h3>{state.replace("_", " ")}</h3>{snapshot.tasks.filter((task) => task.status === state).map((task) => <TaskCard task={task} key={task.id} />)}{!snapshot.tasks.some((task) => task.status === state) && <p className="empty">Nenhuma tarefa</p>}</div>)}</div></section>
      <section className="log"><div className="section-title"><h2>Eventos recentes</h2></div>{events.slice(-8).reverse().map((event) => <div className="event" key={event.id}><span>{event.kind.replaceAll("_", " ")}</span><time>{new Date(event.createdAt).toLocaleTimeString("pt-BR")}</time></div>)}</section>
    </>}
  </main>;
}
function TaskCard({ task }: { task: Task }) { return <article className="task"><span className="priority">P{task.priority}</span><h4>{task.title}</h4>{task.description && <p>{task.description}</p>}<small>{task.dependencies.length ? `${task.dependencies.length} dependência(s)` : "Sem dependências"}</small>{task.result && <em>{task.result}</em>}</article>; }
createRoot(document.getElementById("root")!).render(<App />);
