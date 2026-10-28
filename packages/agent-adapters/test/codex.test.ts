import { describe, expect, it } from "vitest";
import { buildCodexExecArgs, buildCodexPlanningPrompt, buildCodexPrompt, parseCodexPlanOutput } from "../src/index.js";
describe("CodexCliAdapter", () => {
  it("builds a scoped task prompt", () => { expect(buildCodexPrompt({ taskId: "t", title: "Implementar", instructions: "Criar teste", workingDirectory: "repo", context: ["Use TypeScript"] })).toContain("Não faça operações destrutivas"); });
  it("reads the final structured plan from Codex JSONL output", () => {
    const output = '{"type":"thread.started"}\n{"type":"item.completed","item":{"type":"agent_message","text":"{\\"summary\\":\\"Planejar\\",\\"tasks\\":[{\\"title\\":\\"Base\\",\\"description\\":\\"Criar\\",\\"dependencies\\":[],\\"priority\\":50,\\"requiredCapabilities\\":[\\"CODE\\"],\\"acceptanceCriteria\\":[]}] }"}}';
    expect(parseCodexPlanOutput(output).tasks[0]?.title).toBe("Base");
    const prompt = buildCodexPlanningPrompt({ request: "Criar app", workingDirectory: ".", projectContext: "{}" });
    expect(prompt).toContain("SOMENTE com JSON válido");
    expect(prompt).toContain("Uma aprovação do plano deve bastar");
    expect(prompt).toContain("2 a 5 tópicos");
  });
  it("places the global search flag before the exec subcommand", () => {
    expect(buildCodexExecArgs("FULL", ["--json", "prompt"])).toEqual([
      "--search", "exec", "--json", "prompt", "--dangerously-bypass-approvals-and-sandbox",
    ]);
    expect(buildCodexExecArgs("PROJECT_NETWORK", ["--json", "prompt"])).toEqual([
      "--search", "exec", "--json", "prompt", "--sandbox", "workspace-write", "-c", "sandbox_workspace_write.network_access=true",
    ]);
    expect(buildCodexExecArgs("PROJECT", ["--json", "prompt"], "gpt-5.6-sol")).toEqual([
      "exec", "--model", "gpt-5.6-sol", "--json", "prompt", "--sandbox", "workspace-write",
    ]);
  });
});
