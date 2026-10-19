import { describe, expect, it } from "vitest";
import { createTaskSchema, taskStatusSchema } from "../src/index.js";

describe("protocol contracts", () => {
  it("accepts a task with empty defaults and rejects unknown task states", () => {
    expect(createTaskSchema.parse({ title: "Implementar Hub" })).toEqual({ title: "Implementar Hub", description: "", dependencies: [], priority: 50, requiredCapabilities: [], acceptanceCriteria: [], maxAttempts: 3 });
    expect(() => taskStatusSchema.parse("DEPLOYED")).toThrow();
  });
});
