import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

const dir = mkdtempSync(join(tmpdir(), "factory-cfg-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function repoWith(config?: object): string {
  const d = mkdtempSync(join(dir, "r-"));
  if (config) {
    mkdirSync(join(d, ".factory"));
    writeFileSync(join(d, ".factory/config.json"), JSON.stringify(config));
  }
  return d;
}

describe("loadConfig", () => {
  test("refuses to start without a config file, and says how to fix it", async () => {
    await expect(loadConfig(repoWith())).rejects.toThrow(/factory install/);
  });

  test("refuses an empty or malformed repo", async () => {
    await expect(loadConfig(repoWith({}))).rejects.toThrow(/owner\/name/);
    await expect(loadConfig(repoWith({ repo: "just-a-name" }))).rejects.toThrow(/owner\/name/);
  });

  test("fills defaults around a minimal config", async () => {
    const c = await loadConfig(repoWith({ repo: "acme/widgets", agentCommands: { build: ["make *"] } }));
    expect(c.agentCommands).toEqual({ read: [], build: ["make *"], verify: [] });
    expect(c.base).toBe("main");
  });
});
