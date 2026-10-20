import { describe, expect, it } from "vitest";
import { buildCodexPlanningPrompt, buildCodexPrompt, parseCodexPlanOutput } from "../src/index.js";
describe("CodexCliAdapter", () => {
  it("builds a scoped task prompt", () => { expect(buildCodexPrompt({ taskId: "t", title: "Implementar", instructions: "Criar teste", workingDirectory: "repo", context: ["Use TypeScript"] })).toContain("Não faça operações destrutivas"); });
  it("reads the final structured plan from Codex JSONL output", () => {
    const output = '{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":\\"Planejar\\",\\"tasks\\":[{\\"title\\":\\"Base\\",\\"description\\":\\"Criar\\",\\"dependencies\\":[],\\"priority\\":50,\\"requiredCapabilities\\":[\\"CODE\\"],\\"acceptanceCriteria\\":[]}] }"}}';
    expect(parseCodexPlanOutput(output).tasks[0]?.title).toBe("Base");
    expect(buildCodexPlanningPrompt({ request: "Criar app", workingDirectory: ".", projectContext: "{}" })).toContain("SOMENTE com JSON válido");
  });
});
