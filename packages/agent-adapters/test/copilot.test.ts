import { describe, expect, it } from "vitest";
import { buildCopilotPlanningPrompt, buildCopilotPrompt, copilotPermissionArgs, parseCopilotPlan } from "../src/index.js";

describe("CopilotCliAdapter", () => {
  it("builds a scoped task prompt", () => {
    const prompt = buildCopilotPrompt({ taskId: "t", title: "Implementar", instructions: "Criar teste", workingDirectory: "repo", context: ["Use TypeScript"] });
    expect(prompt).toContain("Mireva Workspace");
    expect(prompt).toContain("Não faça operações destrutivas");
    expect(prompt).toContain("Use TypeScript");
  });
  it("parses a structured plan returned by the CLI", () => {
    const plan = parseCopilotPlan('```json\n{"summary":"Base e tela","tasks":[{"title":"Base","description":"Criar a base","dependencies":[],"priority":70,"requiredCapabilities":["CODE"],"acceptanceCriteria":["Compila"]},{"title":"Tela","description":"Criar tela","dependencies":[0],"priority":50,"requiredCapabilities":["CODE"],"acceptanceCriteria":[]}]}\n```');
    expect(plan.tasks[1]).toMatchObject({ dependencies: [0], requiredCapabilities: ["CODE"] });
    const prompt = buildCopilotPlanningPrompt({ request: "Criar app", workingDirectory: ".", projectContext: "Agentes: []" });
    expect(prompt).toContain("SOMENTE com JSON válido");
    expect(prompt).toContain("Uma aprovação do plano deve bastar");
    expect(prompt).toContain("2 a 5 tópicos");
  });
  it("accepts a conversational reply without tasks", () => {
    expect(parseCopilotPlan('{"summary":"Qual público você quer atender?","tasks":[]}')).toEqual({ summary: "Qual público você quer atender?", tasks: [] });
  });
  it("maps the Office permission profile to non-interactive Copilot flags", () => {
    expect(copilotPermissionArgs("READ_ONLY")).toContain("--deny-tool=shell");
    expect(copilotPermissionArgs("PROJECT_NETWORK")).toContain("--allow-all-urls");
    expect(copilotPermissionArgs("FULL")).toEqual(["--allow-all"]);
  });
});
