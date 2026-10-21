import { describe, expect, it } from "vitest";
import { agentStateSchema, createTaskSchema, runnerErrorSchema, taskStatusSchema } from "../src/index.js";

describe("protocol contracts", () => {
  it("accepts a task with empty defaults and rejects unknown task states", () => {
    expect(createTaskSchema.parse({ title: "Implementar Hub" })).toEqual({ title: "Implementar Hub", description: "", dependencies: [], priority: 50, requiredCapabilities: [], acceptanceCriteria: [], maxAttempts: 3 });
    expect(() => taskStatusSchema.parse("DEPLOYED")).toThrow();
  });
  it("accepts detailed runner states and structured errors", () => {
    expect(agentStateSchema.parse("WAITING_PERMISSION")).toBe("WAITING_PERMISSION");
    expect(runnerErrorSchema.parse({ code: "NO_NETWORK", title: "Sem conexão", message: "Falhou", operation: "EXECUTE_TASK", retryable: true, suggestedAction: "Tente novamente", occurredAt: new Date().toISOString() })).toMatchObject({ code: "NO_NETWORK", taskId: null });
  });
});
