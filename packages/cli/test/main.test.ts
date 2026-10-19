import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const tsx = fileURLToPath(new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url));

describe("mireva CLI", () => {
  it("initializes only Mireva project configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mireva-cli-"));
    const { stdout } = await run(process.execPath, [tsx, cli, "init"], { cwd: directory });
    expect(JSON.parse(stdout)).toEqual({ initialized: true });
    expect(JSON.parse(await readFile(join(directory, ".mireva", "config.json"), "utf8"))).toEqual({ version: 1 });
  });
});
