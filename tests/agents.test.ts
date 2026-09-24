// The agent layer: the Claude command is pinned byte for byte, the config that
// picks an agent is validated, and an agent with no preset and no JSON output
// completes a whole run through CommandExecutor. Also structural: every stage's
// artifact contract reaches the prompt, and every preset can be diagnosed.

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandExecutor, renderCommand, resolveAgent } from "../src/agents/executor";
import { artifactContract, renderPrompt, stripFrontmatter } from "../src/agents/prompt";
import { claudeArgs } from "../src/agents/presets/claude";
import { PRESETS } from "../src/agents/presets";
import { COMMENT_FILENAMES, JSON_FILENAMES } from "../src/artifacts";
import { configProblems, DEFAULT_CONFIG, mergeConfig } from "../src/config";
import type { StageName } from "../src/executor";
import { STAGE_GUIDANCE, stageSettings } from "../src/stage-permissions";
import { FactoryState } from "../src/state";
import { LABEL } from "../src/labels";
import { processReadyIssue } from "../src/watch";
import { baseIssue, FakeGateRunner, FakeGit, FakeGitHub } from "./harness";

const STAGES: StageName[] = ["triage", "plan", "build", "verify", "pr"];
const scratch = mkdtempSync(join(tmpdir(), "factory-agents-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("claude preset", () => {
  test("the argv is what v2.4.0 sent, byte for byte", () => {
    const opts = { stage: "build" as const, issue: 12, cwd: "/w", maxBudgetUsd: 5 };
    expect(claudeArgs(opts)).toEqual([
      "-p", "/factory-build 12",
      "--output-format", "stream-json", "--verbose",
      "--permission-mode", "dontAsk", "--permission-prompts", "none",
      "--setting-sources", "project,local",
      "--settings", stageSettings("build", 12, undefined),
      "--append-system-prompt", STAGE_GUIDANCE,
      "--no-session-persistence",
      "--max-budget-usd", "5",
    ]);
    expect(STAGE_GUIDANCE).toBe("Read files with the Read tool, one call per file. Run shell commands one at a time: no &&, ;, pipes or brace expansion.");
    expect(PRESETS.claude!.command(opts, { preset: "claude" }, "").argv).toEqual(["claude", ...claudeArgs(opts)]);
  });

  test("a configured model is added and nothing else changes", () => {
    const opts = { stage: "plan" as const, issue: 1, cwd: "/w", maxBudgetUsd: 2 };
    const argv = PRESETS.claude!.command(opts, { preset: "claude", model: "opus" }, "").argv;
    expect(argv.slice(0, -2)).toEqual(["claude", ...claudeArgs(opts)]);
    expect(argv.slice(-2)).toEqual(["--model", "opus"]);
  });
});

describe("codex preset", () => {
  test("prompt on stdin, JSON events, workspace-write", () => {
    const inv = PRESETS.codex!.command({ stage: "plan", issue: 1, cwd: "/w", maxBudgetUsd: 2 }, { preset: "codex", model: "gpt-5.6-terra" }, "the prompt");
    expect(inv.argv).toEqual(["codex", "exec", "--json", "-s", "workspace-write", "-m", "gpt-5.6-terra", "-"]);
    expect(inv.stdin).toBe("the prompt");
  });
});

describe("agents config", () => {
  test("the default is Claude for every stage", () => {
    expect(DEFAULT_CONFIG.stages).toEqual({ default: "claude" });
    expect(mergeConfig({ repo: "a/b", agents: { codex: { preset: "codex" } }, stages: { verify: "codex" } }).stages).toEqual({ default: "claude", verify: "codex" });
  });

  test.each([
    [{ agents: { x: {} } }, /needs a "preset" or a "command"/],
    [{ agents: { x: { preset: "nope" } } }, /unknown "nope"/],
    [{ agents: { x: { command: [] } } }, /must not be empty/],
    [{ agents: { x: { command: ["{{prompt}}"] } } }, /executable cannot be a placeholder/],
    [{ agents: { x: { command: ["a"], sandbox: true } } }, /unknown key/],
    [{ stages: { verify: "ghost" } }, /"ghost" is not an agent/],
    [{ stages: { deploy: "claude" } }, /unknown stage/],
  ])("refuses %j", (cfg, want) => {
    expect(configProblems({ repo: "a/b", ...cfg }).join("\n")).toMatch(want);
  });

  test("a valid mix is accepted", () => {
    expect(configProblems({ repo: "a/b", agents: { codex: { preset: "codex" }, aider: { command: ["aider", "--message-file", "{{promptFile}}"] } }, stages: { default: "claude", build: "aider" } })).toEqual([]);
  });

  test("resolveAgent picks the stage's agent, else the default, else claude", () => {
    const agents = { claude: { preset: "claude" }, codex: { preset: "codex" } };
    expect(resolveAgent(agents, { default: "claude", verify: "codex" }, "verify").name).toBe("codex");
    expect(resolveAgent(agents, { default: "codex" }, "plan").name).toBe("codex");
    expect(resolveAgent(agents, {}, "plan").name).toBe("claude");
    expect(() => resolveAgent(agents, { plan: "ghost" }, "plan")).toThrow(/not in config.agents/);
  });

  test("renderCommand fills placeholders and knows when the prompt is not on stdin", () => {
    const v = { prompt: "P", promptFile: "/f", model: "m" };
    expect(renderCommand(["a", "--model", "{{model}}"], v)).toEqual({ argv: ["a", "--model", "m"], usesStdin: true });
    expect(renderCommand(["a", "{{prompt}}"], v)).toEqual({ argv: ["a", "P"], usesStdin: false });
    expect(renderCommand(["a", "--f={{promptFile}}"], v)).toEqual({ argv: ["a", "--f=/f"], usesStdin: false });
  });
});

describe("the prompt", () => {
  test.each(STAGES)("%s: every artifact the stage may write is named in the contract", (stage) => {
    const c = artifactContract({ stage, issue: 4 });
    expect(c).toContain(JSON_FILENAMES[stage]);
    expect(c).toContain(COMMENT_FILENAMES[stage]);
    expect(c).toContain("question-comment.md");
    expect(c).toContain(".factory/runs/issue-4/");
  });

  test.each(STAGES)("%s: the rendered prompt is the skill body plus the contract", async (stage) => {
    const cwd = mkdtempSync(join(scratch, "prompt-"));
    cpSync(join(import.meta.dir, "../template/.claude/skills"), join(cwd, ".claude/skills"), { recursive: true });
    const prompt = await renderPrompt({ stage, issue: 4, cwd, maxBudgetUsd: 1 });
    const body = stripFrontmatter(readFileSync(join(cwd, `.claude/skills/factory-${stage}/SKILL.md`), "utf8")).trim();
    expect(prompt).toContain(body);
    expect(prompt).toContain("Issue number: 4");
    expect(prompt).toContain(artifactContract({ stage, issue: 4 }));
    expect(prompt).not.toContain("name: factory-");
  });

  test("a missing skill says how to fix it", async () => {
    await expect(renderPrompt({ stage: "plan", issue: 1, cwd: scratch, maxBudgetUsd: 1 })).rejects.toThrow(/factory install --update/);
  });
});

describe("an agent with no preset", () => {
  class SkillGit extends FakeGit {
    override async ensureWorktree(cloneDir: string, worktreeDir: string, issue: number) {
      await super.ensureWorktree(cloneDir, worktreeDir, issue);
      cpSync(join(import.meta.dir, "../template/.claude/skills"), join(worktreeDir, ".claude/skills"), { recursive: true });
    }
  }

  test("completes triage to PR from a script that only writes files", async () => {
    const workspacesDir = mkdtempSync(join(scratch, "ws-"));
    const cloneDir = mkdtempSync(join(scratch, "clone-"));
    const log = mkdtempSync(join(scratch, "log-"));
    process.env.FAKE_AGENT_LOG = log;
    const issue = baseIssue(1, [LABEL.ready]);
    const github = new FakeGitHub([issue]);
    const state = new FactoryState(":memory:");
    state.setToggle("auto_approve_low_risk", true);
    const config = mergeConfig({
      repo: "acme/widgets",
      agents: { scripted: { command: [join(import.meta.dir, "fixtures/agents/fake-agent.sh")] } },
      stages: { default: "scripted" },
    });
    const deps = { github, git: new SkillGit(), state, executor: new CommandExecutor(config.agents, config.stages), gateRunner: new FakeGateRunner(), cloneDir, workspacesDir };
    try {
      expect(await processReadyIssue(issue, deps, config)).toBe("shipped");
    } finally {
      delete process.env.FAKE_AGENT_LOG;
    }
    expect(github.createdPrs[0]!.body).toContain("Closes #1");
    // Every stage was handed its contract on stdin.
    for (const stage of STAGES) expect(readFileSync(join(log, `${stage}.prompt`), "utf8")).toContain(JSON_FILENAMES[stage]);
    // The run history names the agent and says the numbers are not reported.
    const rows = state.listStageRuns("acme/widgets");
    expect(rows.map((r) => r.agent)).toEqual(Array(rows.length).fill("scripted"));
    expect(rows.length).toBe(5);
    state.close();
  });
});

describe("every preset is diagnosable", () => {
  test("has a binary, parses a blank line to nothing, and never lets the prompt into argv when it owns stdin", () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      expect(preset.name).toBe(name);
      expect(preset.binary.length).toBeGreaterThan(0);
      expect(preset.parseLine("")).toEqual([]);
      const inv = preset.command({ stage: "plan", issue: 1, cwd: "/w", maxBudgetUsd: 1 }, { preset: name }, "SECRET-PROMPT");
      expect(inv.argv[0]).toBe(preset.binary);
      if (!preset.ownsPrompt) expect(inv.argv.join(" ")).not.toContain("SECRET-PROMPT");
    }
  });
});
