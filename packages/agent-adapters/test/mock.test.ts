import { describe, expect, it } from "vitest";
import { MockAgentAdapter } from "../src/index.js";

describe("MockAgentAdapter", () => {
  it("streams a simulated delivery with declared capabilities", async () => {
    const adapter = new MockAgentAdapter(); await adapter.executeTask({ taskId: "task-1", title: "Teste", instructions: "", workingDirectory: ".", context: [] });
    const events = []; for await (const event of adapter.streamEvents("task-1")) events.push(event.type);
    expect(events).toEqual(["STARTED", "PROGRESS", "COMPLETED"]);
    expect((await adapter.getCapabilities()).includes("CANCEL")).toBe(true);
    expect((await adapter.getResult("task-1"))?.status).toBe("COMPLETED");
  });
});
