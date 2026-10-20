import { describe, expect, it } from "vitest";
import { buildCopilotPrompt } from "../src/index.js";

describe("CopilotCliAdapter", () => {
  it("builds a scoped task prompt", () => {
    const prompt = buildCopilotPrompt({ taskId: "t", title: "Implementar", instructions: "Criar teste", workingDirectory: "repo", context: ["Use TypeScript"] });
    expect(prompt).toContain("Mireva Workspace");
    expect(prompt).toContain("Não faça operações destrutivas");
    expect(prompt).toContain("Use TypeScript");
  });
});
