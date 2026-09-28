import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { configProblems, DEFAULT_CONFIG, holdoutEnabled, loadConfig } from "../src/config";

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

// A config generated for a repo whose default branch is not "main" must not
// silently point PRs and reset at a branch that does not exist (plan v2.6.2
// item 3). Local `--repo-dir` mode has no `ensureRepoClone` (VM/CI-only) to
// resolve this, so loadConfig has to do it itself.
describe("base branch defaults to origin/HEAD, not the hard-coded \"main\"", () => {
  function git(cwd: string, ...args: string[]): void {
    const r = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  }

  function cloneOfTrunkRepo(): string {
    const src = mkdtempSync(join(dir, "src-"));
    git(src, "init", "-q", "-b", "trunk");
    writeFileSync(join(src, "f.txt"), "x");
    git(src, "add", ".");
    git(src, "-c", "user.email=a@b.c", "-c", "user.name=a", "commit", "-q", "-m", "x");
    const bare = `${mkdtempSync(join(dir, "bare-"))}.git`;
    git(dir, "clone", "-q", "--bare", src, bare);
    const wd = join(dir, `wd-${Math.random().toString(36).slice(2)}`);
    git(dir, "clone", "-q", bare, wd);
    return wd;
  }

  test("a config that omits base picks up origin/HEAD's branch", async () => {
    const wd = cloneOfTrunkRepo();
    mkdirSync(join(wd, ".factory"));
    writeFileSync(join(wd, ".factory/config.json"), JSON.stringify({ repo: "acme/x", gates: [] }));
    const c = await loadConfig(wd);
    expect(c.base).toBe("trunk");
  });

  test("a config that names base explicitly, even \"main\", is never overridden", async () => {
    const wd = cloneOfTrunkRepo();
    mkdirSync(join(wd, ".factory"));
    writeFileSync(join(wd, ".factory/config.json"), JSON.stringify({ repo: "acme/x", base: "main", gates: [] }));
    const c = await loadConfig(wd);
    expect(c.base).toBe("main");
  });
});

describe("holdoutEnabled", () => {
  test("off when cmd is empty, on otherwise, regardless of paths", () => {
    expect(holdoutEnabled({ paths: [], cmd: "" })).toBe(false);
    expect(holdoutEnabled({ paths: [".factory/holdout/**"], cmd: "" })).toBe(false);
    expect(holdoutEnabled({ paths: [], cmd: "bun test .factory/holdout" })).toBe(true);
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

  // Plan v2.11.0 item C: holdout is off by default (empty cmd), so "" must
  // pass even though every other "string"-kind key requires non-empty.
  test("holdout.cmd may be empty (the off switch), but not the wrong type", () => {
    expect(configProblems({ repo: "a/b", holdout: { paths: [], cmd: "" } })).toEqual([]);
    const problems = configProblems({ repo: "a/b", holdout: { cmd: 1, paths: "nope", extra: true } });
    expect(problems.join("\n")).toMatch(/holdout\.cmd: expected string/);
    expect(problems.join("\n")).toMatch(/holdout\.paths: expected strings/);
    expect(problems.join("\n")).toMatch(/holdout\.extra: unknown key/);
  });

  test("every key of DEFAULT_CONFIG validates, and the shipped example config passes", () => {
    expect(configProblems({ ...DEFAULT_CONFIG, repo: "a/b" })).toEqual([]);
    const example = JSON.parse(readFileSync(join(import.meta.dir, "../template/.factory/config.example.json"), "utf8"));
    expect(configProblems(example)).toEqual([]);
  });
});
