import { describe, expect, it } from "vitest";
import { antigravityPermissionArgs, buildAntigravityArgs, parseAntigravityResponse } from "../src/index.js";

describe("AntigravityCliAdapter", () => {
  it("pins the requested Gemini model in headless mode", () => { const args = buildAntigravityArgs("Faça", "PROJECT", "gemini-3.8-flash-medium"); expect(args).toContain("gemini-3.8-flash-medium"); expect(args).toContain("--output-format"); });
  it("uses sandboxed plan mode for read-only planning", () => { expect(antigravityPermissionArgs("READ_ONLY")).toEqual(["--mode=plan", "--sandbox"]); });
  it("reads Antigravity's structured response", () => { expect(parseAntigravityResponse('{"status":"SUCCESS","response":"Pronto"}')).toBe("Pronto"); });
});
