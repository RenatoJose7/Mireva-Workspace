import { describe, expect, it } from "vitest";
import { buildClaudeArgs, claudePermissionArgs, parseClaudeResponse } from "../src/index.js";

describe("ClaudeCliAdapter", () => {
  it("pins the requested model in headless mode", () => { expect(buildClaudeArgs("Faça", "PROJECT", "opus")).toContain("opus"); expect(buildClaudeArgs("Faça", "PROJECT", "opus").slice(0, 2)).toEqual(["-p", "Faça"]); });
  it("uses plan mode for read-only planning", () => { expect(claudePermissionArgs("READ_ONLY")).toEqual(["--permission-mode", "plan"]); });
  it("reads Claude's structured result", () => { expect(parseClaudeResponse('{"type":"result","subtype":"success","is_error":false,"result":"Pronto"}')).toBe("Pronto"); });
});
