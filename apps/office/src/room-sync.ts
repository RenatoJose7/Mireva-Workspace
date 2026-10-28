import type { RoomEvent } from "@mireva/protocol";

export const mergeRoomEvents = (current: RoomEvent[], incoming: RoomEvent[]): RoomEvent[] => {
  const merged = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) merged.set(event.id, event);
  return [...merged.values()].sort((left, right) => left.sequence - right.sequence);
};

export const readableChatText = (value: unknown): string => {
  const text = String(value ?? "").replaceAll("\r", "").trim();
  if (!text || text.includes("\n")) return text;
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
  const paragraphs: string[] = [];
  let chunk = "";
  for (const sentence of sentences) {
    if (chunk && `${chunk} ${sentence}`.length > 260) {
      paragraphs.push(chunk);
      chunk = sentence;
    } else {
      chunk = `${chunk} ${sentence}`.trim();
    }
  }
  if (chunk) paragraphs.push(chunk);
  return paragraphs.join("\n\n");
};

export const withReadableOrchestratorText = (event: RoomEvent): RoomEvent => {
  if (event.kind !== "ORCHESTRATOR_RESPONSE") return event;
  const orchestrator = (event.payload.orchestrator ?? {}) as Record<string, unknown>;
  return {
    ...event,
    payload: {
      ...event.payload,
      orchestrator: {
        ...orchestrator,
        summary: readableChatText(orchestrator.summary ?? event.payload.message ?? "Plano atualizado"),
      },
    },
  };
};
