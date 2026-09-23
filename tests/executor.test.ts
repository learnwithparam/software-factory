// Replay executor unit tests, plus the full state-machine pipeline driven
// through watch.ts with fake GitHub/git and a real in-memory FactoryState.
// No model, no network: ReplayExecutor reads fixture stream-json lines, and
// FakeGitHub/FakeGit are in-memory subclasses (GitHub/Git hold a private
// CommandRunner field, so a plain object can't structurally satisfy the
// type — subclassing and overriding every public method is the honest way
// to fake them without touching `gh` or `git`).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aggregateStageEvents,
  claudeArgs,
  parseStreamJsonLine,
  ReplayExecutor,
  type StageName,
} from "../src/executor";
import { DEFAULT_CONFIG, mergeConfig } from "../src/config";
import { runDir } from "../src/artifacts";
import { GitHub, type CreatePrOptions, type GhComment, type GhIssue, type GhPr } from "../src/github";
import { Git } from "../src/git";
import { FactoryState } from "../src/state";
import { LABEL } from "../src/labels";
import { processReadyIssue, resumeNeedsInfo } from "../src/watch";

// ---------- pure function tests ----------

describe("parseStreamJsonLine", () => {
  test("parses assistant text and tool_use blocks plus usage", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Looking at the issue" },
          { type: "tool_use", name: "Read" },
        ],
        usage: { input_tokens: 120, output_tokens: 40 },
      },
    });
    const events = parseStreamJsonLine(line);
    expect(events).toEqual([
      { kind: "text", text: "Looking at the issue" },
      { kind: "tool_use", toolName: "Read" },
      { kind: "usage", tokensIn: 120, tokensOut: 40 },
    ]);
  });

  test("parses a result line's cost", () => {
    const line = JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.42 });
    expect(parseStreamJsonLine(line)).toEqual([{ kind: "result", costUsd: 0.42, text: "success" }]);
  });

  test("returns nothing for a blank line or unparsable JSON", () => {
    expect(parseStreamJsonLine("")).toEqual([]);
    expect(parseStreamJsonLine("not json")).toEqual([]);
  });
});

describe("aggregateStageEvents", () => {
  test("totals tool calls, tokens, and cost across events", () => {
    const result = aggregateStageEvents(
      [
        { kind: "tool_use", toolName: "Read" },
        { kind: "tool_use", toolName: "Edit" },
        { kind: "usage", tokensIn: 100, tokensOut: 20 },
        { kind: "usage", tokensIn: 50, tokensOut: 10 },
        { kind: "result", costUsd: 0.03 },
      ],
      0,
    );
    expect(result.toolCalls).toBe(2);
    expect(result.tokensIn).toBe(150);
    expect(result.tokensOut).toBe(30);
    expect(result.costUsd).toBe(0.03);
    expect(result.exitCode).toBe(0);
  });
});

describe("claudeArgs", () => {
  test("builds the exact invocation documented in executor.ts", () => {
    const args = claudeArgs({ stage: "build", issue: 7, cwd: "/tmp/x", maxBudgetUsd: 5 });
    expect(args).toEqual([
      "-p",
      "/factory-build 7",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "dontAsk",
      "--setting-sources",
      "project,local",
      "--no-session-persistence",
      "--max-budget-usd",
      "5",
    ]);
  });
});

describe("ReplayExecutor", () => {
  test("aggregates a recorded fixture with no process and no network", async () => {
    const executor = ReplayExecutor.fromLines("triage", 1, [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }),
      JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.01 }),
    ]);
    const result = await executor.runStage({ stage: "triage", issue: 1, cwd: "/tmp", maxBudgetUsd: 1 });
    expect(result.toolCalls).toBe(1);
    expect(result.costUsd).toBe(0.01);
    expect(result.exitCode).toBe(0);
  });

  test("throws for a stage/issue with no recorded fixture", async () => {
    const executor = ReplayExecutor.fromLines("triage", 1, ["{}"]);
    await expect(executor.runStage({ stage: "plan", issue: 1, cwd: "/tmp", maxBudgetUsd: 1 })).rejects.toThrow(
      /no fixture recorded/,
    );
  });
});

// ---------- fakes: in-memory GitHub and Git, no `gh`/`git` process ----------

class FakeGitHub extends GitHub {
  issues = new Map<number, GhIssue>();
  prs: GhPr[] = [];
  createdPrs: CreatePrOptions[] = [];
  private nextCommentId = 1000;
  private nextPrNumber = 1;

  constructor(issues: GhIssue[]) {
    super();
    for (const i of issues) this.issues.set(i.number, i);
  }

  override async listIssuesByLabel(_repo: string, label: string): Promise<GhIssue[]> {
    return [...this.issues.values()].filter((i) => i.labels.some((l) => l.name === label));
  }

  override async getIssue(_repo: string, number: number): Promise<GhIssue> {
    const issue = this.issues.get(number);
    if (!issue) throw new Error(`no such issue ${number}`);
    return issue;
  }

  override async listOpenIssues(_repo: string): Promise<GhIssue[]> {
    return [...this.issues.values()];
  }

  override async commentIssue(_repo: string, number: number, body: string): Promise<number> {
    const issue = this.issues.get(number)!;
    const id = this.nextCommentId++;
    const comment: GhComment = { id, author: "factory-bot", authorAssociation: "NONE", body, createdAt: new Date().toISOString() };
    issue.comments = [...issue.comments, comment];
    return id;
  }

  editCount = 0;

  override async editComment(_repo: string, commentId: number, body: string): Promise<void> {
    this.editCount += 1;
    for (const issue of this.issues.values()) {
      const comment = issue.comments.find((c) => c.id === commentId);
      if (comment) (comment as { body: string }).body = body;
    }
  }

  override async addLabels(_repo: string, number: number, labels: string[]): Promise<void> {
    const issue = this.issues.get(number)!;
    const names = new Set(issue.labels.map((l) => l.name));
    for (const l of labels) names.add(l);
    issue.labels = [...names].map((name) => ({ name }));
  }

  override async removeLabels(_repo: string, number: number, labels: string[]): Promise<void> {
    const issue = this.issues.get(number)!;
    const remove = new Set(labels);
    issue.labels = issue.labels.filter((l) => !remove.has(l.name));
  }

  override async createPr(opts: CreatePrOptions): Promise<string> {
    this.createdPrs.push(opts);
    const number = this.nextPrNumber++;
    const url = `https://github.com/${opts.repo}/pull/${number}`;
    this.prs.push({ number, url, state: "open", headRefName: opts.head, isDraft: Boolean(opts.draft) });
    return url;
  }

  override async listPrs(): Promise<GhPr[]> {
    return this.prs.filter((p) => p.state === "open");
  }

  override async closePr(_repo: string, number: number): Promise<void> {
    const pr = this.prs.find((p) => p.number === number);
    if (pr) (pr as { state: string }).state = "closed";
  }

  override async listLabels(): Promise<string[]> {
    return [];
  }

  override async ensureLabel(): Promise<void> {}
  override async currentLogin(): Promise<string> {
    return "factory-bot";
  }
}

class FakeGit extends Git {
  claimResult = true;
  pushed: number[] = [];

  override async claim(): Promise<boolean> {
    return this.claimResult;
  }

  override async addWorktree(_cloneDir: string, worktreeDir: string, issue: number): Promise<void> {
    mkdirSync(join(worktreeDir, runDir(issue)), { recursive: true });
  }

  override async removeWorktree(_cloneDir: string, worktreeDir: string): Promise<void> {
    rmSync(worktreeDir, { recursive: true, force: true });
  }

  override async push(_worktreeDir: string, issue: number) {
    this.pushed.push(issue);
    return { stdout: "", stderr: "", code: 0 };
  }

  override async hasCommits(): Promise<boolean> {
    return true;
  }
}

function baseIssue(number: number, labels: string[]): GhIssue {
  return { number, title: `Issue ${number}`, body: "do the thing", labels: labels.map((name) => ({ name })), comments: [] };
}

function writeArtifact(worktree: string, issue: number, name: string, content: string): void {
  writeFileSync(join(worktree, runDir(issue), name), content);
}

function fixtureFor(stage: StageName, issue: number) {
  return ReplayExecutor.fromLines(stage, issue, [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write" }] } }),
    JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.01 }),
  ]);
}

class MultiStageExecutor {
  private readonly byKey = new Map<string, ReplayExecutor>();
  set(stage: StageName, issue: number, executor: ReplayExecutor): void {
    this.byKey.set(`${stage}:${issue}`, executor);
  }
  async runStage(opts: { stage: StageName; issue: number; cwd: string; maxBudgetUsd: number }) {
    const executor = this.byKey.get(`${opts.stage}:${opts.issue}`);
    if (!executor) throw new Error(`no executor registered for ${opts.stage}:${opts.issue}`);
    return executor.runStage(opts);
  }
}

// ---------- full pipeline ----------

describe("full happy-path pipeline (triage -> plan -> build -> verify -> pr)", () => {
  test("ships a draft PR end to end with no model and no network", async () => {
    const workspacesDir = mkdtempSync(join(tmpdir(), "factory-ws-"));
    const cloneDir = mkdtempSync(join(tmpdir(), "factory-clone-"));
    const issue = baseIssue(1, [LABEL.ready]);
    const github = new FakeGitHub([issue]);
    const git = new FakeGit();
    const state = new FactoryState(":memory:");
    state.setToggle("auto_approve_low_risk", true);
    const config = mergeConfig({ ...DEFAULT_CONFIG, repo: "acme/widgets" });

    const executor = new MultiStageExecutor();
    for (const stage of ["triage", "plan", "build", "verify", "pr"] as const) {
      executor.set(stage, 1, fixtureFor(stage, 1));
    }

    const worktree = join(workspacesDir, "issue-1");
    // processReadyIssue calls git.addWorktree itself, but the stage fixtures
    // below have to exist on disk before it runs each stage, so create the
    // directory FakeGit.addWorktree would create and seed it up front.
    mkdirSync(join(worktree, runDir(1)), { recursive: true });
    writeArtifact(worktree, 1, "triage-comment.md", "<!-- factory:triage v1 -->\nlooks good");
    writeArtifact(
      worktree,
      1,
      "triage.json",
      JSON.stringify({ disposition: "proceed", type: "bug", risk: "low", done_when: "tests pass", files_expected: ["src/a.ts"], gate_level: "make check", confidence: 0.9 }),
    );
    writeArtifact(worktree, 1, "plan-comment.md", "<!-- factory:plan v1 rev=1 -->\nplan body");
    writeArtifact(worktree, 1, "plan.json", JSON.stringify({ risk: "low", revision: 1, files: ["src/a.ts"], autoApproveEligible: true }));
    writeArtifact(worktree, 1, "status-comment.md", "<!-- factory:status v1 -->\nbuilding");
    writeArtifact(worktree, 1, "build.json", JSON.stringify({ status: "green", gate_line: "make check: 10 pass", rounds: 1 }));
    writeArtifact(worktree, 1, "verdict-comment.md", "<!-- factory:verdict v1 -->\npass");
    writeArtifact(worktree, 1, "verdict.json", JSON.stringify({ result: "pass", rounds: 1, findings: [] }));
    writeArtifact(worktree, 1, "pr-body.md", "## Summary\nDid the thing.\nCloses #1");

    const deps = { github, git, state, executor, cloneDir, workspacesDir };
    const outcome = await processReadyIssue(issue, deps, config);

    expect(outcome).toBe("shipped");
    expect(github.createdPrs).toHaveLength(1);
    expect(github.createdPrs[0]!.draft).toBe(true);
    expect(github.createdPrs[0]!.body).toContain("Closes #1");
    expect(git.pushed).toEqual([1]);

    const run = state.getRun("acme/widgets", 1)!;
    expect(run.status).toBe("shipped");
    expect(run.pr_url).toBe(github.prs[0]!.url);

    const finalLabels = issue.labels.map((l) => l.name);
    expect(finalLabels).toContain(LABEL.inReview);
    expect(finalLabels).not.toContain(LABEL.ready);

    // Build's status comment is posted once and its id remembered, not
    // reposted as a fresh comment on every stage.
    expect(run.status_comment_id).toBeDefined();
    expect(issue.comments.filter((c) => c.body.includes("factory:status")).length).toBe(1);

    state.close();
    rmSync(workspacesDir, { recursive: true, force: true });
    rmSync(cloneDir, { recursive: true, force: true });
  });
});

describe("needs-info path", () => {
  test("posts a question, stops the loop, and resumes on a trusted reply", async () => {
    const workspacesDir = mkdtempSync(join(tmpdir(), "factory-ws-"));
    const cloneDir = mkdtempSync(join(tmpdir(), "factory-clone-"));
    const issue = baseIssue(2, [LABEL.ready]);
    const github = new FakeGitHub([issue]);
    const git = new FakeGit();
    const state = new FactoryState(":memory:");
    const config = mergeConfig({ ...DEFAULT_CONFIG, repo: "acme/widgets" });

    const executor = new MultiStageExecutor();
    executor.set("triage", 2, fixtureFor("triage", 2));

    const worktree = join(workspacesDir, "issue-2");
    mkdirSync(join(worktree, runDir(2)), { recursive: true });
    writeArtifact(worktree, 2, "triage-comment.md", "<!-- factory:triage v1 -->\nneeds more detail");
    writeArtifact(
      worktree,
      2,
      "triage.json",
      JSON.stringify({ disposition: "needs-info", type: "bug", risk: "low", done_when: "", files_expected: [], gate_level: "make check", confidence: 0.2 }),
    );
    writeArtifact(worktree, 2, "question-comment.md", "<!-- factory:question v1 -->\n1. Which environment?\na) staging\nb) production");

    const deps = { github, git, state, executor, cloneDir, workspacesDir };
    const outcome = await processReadyIssue(issue, deps, config);

    expect(outcome).toBe("needs-info");
    expect(issue.labels.map((l) => l.name)).toContain(LABEL.needsInfo);
    expect(issue.comments.some((c) => c.body.includes("factory:question"))).toBe(true);
    expect(state.getRun("acme/widgets", 2)!.status).toBe("needs-info");

    // An untrusted reply does not resume the loop.
    issue.comments.push({ id: 9001, author: "rando", authorAssociation: "NONE", body: "staging please", createdAt: new Date().toISOString() });
    const stillWaiting = await resumeNeedsInfo(issue, deps, config);
    expect(stillWaiting).toBe("waiting");

    // A trusted reply resumes triage; simulate the resumed run's own output
    // by overwriting the artifacts it would produce this time.
    await new Promise((r) => setTimeout(r, 5));
    issue.comments.push({ id: 9002, author: "param", authorAssociation: "OWNER", body: "staging", createdAt: new Date().toISOString() });
    writeArtifact(
      worktree,
      2,
      "triage.json",
      JSON.stringify({ disposition: "proceed", type: "bug", risk: "medium", done_when: "tests pass", files_expected: ["src/b.ts"], gate_level: "make check", confidence: 0.9 }),
    );
    writeArtifact(worktree, 2, "plan-comment.md", "<!-- factory:plan v1 rev=1 -->\nplan body");
    writeArtifact(worktree, 2, "plan.json", JSON.stringify({ risk: "medium", revision: 1, files: ["src/b.ts"], autoApproveEligible: false }));
    executor.set("plan", 2, fixtureFor("plan", 2));

    const resumed = await resumeNeedsInfo(issue, deps, config);
    expect(resumed).toBe("awaiting-approval");
    expect(issue.labels.map((l) => l.name)).toContain(LABEL.awaitingApproval);

    const answer = await Bun.file(join(worktree, runDir(2), "answer.md")).text();
    expect(answer).toBe("staging");

    state.close();
    rmSync(workspacesDir, { recursive: true, force: true });
    rmSync(cloneDir, { recursive: true, force: true });
  });
});
