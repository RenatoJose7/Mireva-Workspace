import { describe, expect, it } from "vitest";
import type { RoomEvent } from "@mireva/protocol";
import { mergeRoomEvents, readableChatText, withReadableOrchestratorText } from "./room-sync.js";

const event = (id: string, sequence: number, kind: RoomEvent["kind"] = "MESSAGE"): RoomEvent => ({
  id,
  sequence,
  kind,
  roomId: "room",
  participantId: null,
  payload: {},
  createdAt: "2026-10-28T00:00:00.000Z",
});

describe("room synchronization", () => {
  it("keeps newer local events when an older poll finishes later", () => {
    const result = mergeRoomEvents([event("new", 2)], [event("old", 1)]);
    expect(result.map((item) => item.id)).toEqual(["old", "new"]);
  });

  it("breaks a long orchestrator response into readable blocks", () => {
    const text = Array.from({ length: 8 }, (_, index) => `Esta é a orientação número ${index + 1}, com detalhes objetivos para a próxima etapa do projeto.`).join(" ");
    const readable = readableChatText(text);
    expect(readable).toContain("\n\n");
    const transformed = withReadableOrchestratorText({ ...event("response", 3, "ORCHESTRATOR_RESPONSE"), payload: { orchestrator: { summary: text } } });
    expect((transformed.payload.orchestrator as { summary: string }).summary).toBe(readable);
  });
});
