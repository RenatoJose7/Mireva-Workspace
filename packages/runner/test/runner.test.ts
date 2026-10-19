import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startLocalHub, type LocalHub } from "../../../apps/hub/src/server.js";
import { joinRunner, MirevaRunner } from "../src/index.js";

let hub: LocalHub | undefined;
afterEach(async () => { await hub?.close(); });
describe("MirevaRunner", () => {
  it("syncs an event published by a separate runner", async () => {
    hub = await startLocalHub({ dataFile: join(await mkdtemp(join(tmpdir(), "mireva-runner-")), "hub.json") });
    const room = await fetch(`${hub.url}/rooms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sync", ownerName: "Owner" }) }).then((r) => r.json()) as { room: { code: string } };
    const first = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner A", "mock"));
    const delivered: string[] = []; const second = new MirevaRunner(await joinRunner(hub.url, room.room.code, "Runner B", "mock"), { onEvent: (event) => { if (event.kind === "MESSAGE") delivered.push(String(event.payload.text)); } });
    await first.publish("MESSAGE", { text: "contexto da tarefa A" });
    await second.poll();
    expect(delivered).toEqual(["contexto da tarefa A"]);
  });
});
