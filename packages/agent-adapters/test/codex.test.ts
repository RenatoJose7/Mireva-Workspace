import { describe, expect, it } from "vitest";
import { buildCodexPrompt } from "../src/index.js";
describe("CodexCliAdapter", () => { it("builds a scoped task prompt", () => { expect(buildCodexPrompt({ taskId: "t", title: "Implementar", instructions: "Criar teste", workingDirectory: "repo", context: ["Use TypeScript"] })).toContain("Não faça operações destrutivas"); }); });
