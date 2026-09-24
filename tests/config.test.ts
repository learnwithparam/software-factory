import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { configProblems, DEFAULT_CONFIG, loadConfig } from "../src/config";

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

describe("config validation at boot", () => {
  test("an unknown top-level key refuses to start and names the key", async () => {
    await expect(loadConfig(repoWith({ repo: "a/b", maxOpenFactoryPr: 3 }))).rejects.toThrow(/maxOpenFactoryPr: unknown key/);
  });

  test("a wrong type is refused, and every problem is listed at once", () => {
    const problems = configProblems({ repo: "a/b", concurrency: "3", riskPolicy: { autoApproveLowRisk: "yes" }, maxBudgetUsd: { build: 0, bulid: 1 }, gates: [{ name: "t", cmd: "x", required: 1 }] });
    expect(problems).toHaveLength(5);
    expect(problems.join("\n")).toMatch(/concurrency: expected posInt/);
    expect(problems.join("\n")).toMatch(/riskPolicy\.autoApproveLowRisk: expected boolean/);
    expect(problems.join("\n")).toMatch(/maxBudgetUsd\.build: expected positive/);
    expect(problems.join("\n")).toMatch(/maxBudgetUsd\.bulid: unknown key/);
    expect(problems.join("\n")).toMatch(/gates\[0\]\.required: expected boolean/);
  });

  test("agent-facing riskCriteria and _comment keys are allowed", () => {
    expect(configProblems({ repo: "a/b", _comment: "hi", riskCriteria: { low: {} } })).toEqual([]);
  });

  test("every key of DEFAULT_CONFIG validates, and the shipped example config passes", () => {
    expect(configProblems({ ...DEFAULT_CONFIG, repo: "a/b" })).toEqual([]);
    const example = JSON.parse(readFileSync(join(import.meta.dir, "../template/.factory/config.example.json"), "utf8"));
    expect(configProblems(example)).toEqual([]);
  });
});
