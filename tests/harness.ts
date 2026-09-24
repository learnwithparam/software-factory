// Shared in-memory fakes for the state-machine tests: GitHub, git, gates and
// a scripted per-stage executor. No `gh`, `git`, model or network. GitHub and
// Git hold a private CommandRunner field, so a plain object can't satisfy the
// type; subclassing and overriding every public method is the honest fake.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReplayExecutor, type StageName, type StageRunResult } from "../src/executor";
import { runDir } from "../src/artifacts";
import { GitHub, type CreatePrOptions, type GhComment, type GhIssue, type GhPr } from "../src/github";
import { Git } from "../src/git";
import type { GateRunner } from "../src/gates";

// Strictly increasing timestamps, so "newer than" comparisons never tie the
// way `new Date()` can inside one millisecond.
let clock = Date.parse("2026-01-01T00:00:00Z");
export function nextIso(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

// ---------- fakes: in-memory GitHub and Git, no `gh`/`git` process ----------

export class FakeGitHub extends GitHub {
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
    const comment: GhComment = { id, author: "factory-bot", authorAssociation: "OWNER", body, createdAt: nextIso() };
    issue.comments = [...issue.comments, comment];
    return id;
  }

  editCount = 0;
  // Comments and reviews a human left on the draft PR.
  prComments: GhComment[] = [];

  override async findPrByHead(_repo: string, head: string): Promise<GhPr | undefined> {
    return this.prs.find((p) => p.state === "open" && p.headRefName === head);
  }

  override async prFeedback(): Promise<GhComment[]> {
    return this.prComments;
  }

  // A human comment on the issue, from any association (default: the owner).
  say(issue: number, body: string, authorAssociation = "OWNER"): void {
    const i = this.issues.get(issue)!;
    i.comments = [...i.comments, { id: this.nextCommentId++, author: "human", authorAssociation, body, createdAt: nextIso() }];
  }

  sayOnPr(body: string, authorAssociation = "OWNER"): void {
    this.prComments = [...this.prComments, { id: 0, author: "human", authorAssociation, body, createdAt: nextIso() }];
  }


  override async editComment(_repo: string, commentId: number, body: string): Promise<void> {
    this.editCount += 1;
    for (const issue of this.issues.values()) {
      const comment = issue.comments.find((c) => c.id === commentId);
      if (comment) (comment as { body: string }).body = body;
    }
  }

  // Every label this fake ever applied, so a test can prove which states were reached.
  seenLabels = new Set<string>();

  override async addLabels(_repo: string, number: number, labels: string[]): Promise<void> {
    for (const l of labels) this.seenLabels.add(l);
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

  // Ready-for-review flips, in order: [head, ready].
  readyCalls: [string, boolean][] = [];

  override async markReady(_repo: string, ref: string | number, ready: boolean): Promise<void> {
    this.readyCalls.push([String(ref), ready]);
    const pr = this.prs.find((p) => p.headRefName === ref || p.number === ref);
    if (pr) (pr as { isDraft: boolean }).isDraft = !ready;
  }

  override async listPrs(): Promise<GhPr[]> {
    return this.prs.filter((p) => p.state === "open");
  }

  override async closePr(_repo: string, number: number): Promise<void> {
    const pr = this.prs.find((p) => p.number === number);
    if (pr) (pr as { state: string }).state = "closed";
  }

  closed: number[] = [];

  override async closeIssue(_repo: string, number: number): Promise<void> {
    this.closed.push(number);
  }

  override async listLabels(): Promise<string[]> {
    return [];
  }

  override async ensureLabel(): Promise<void> {}
  override async currentLogin(): Promise<string> {
    return "factory-bot";
  }
}

export class FakeGit extends Git {
  claimResult = true;
  pushed: number[] = [];
  committed: string[] = [];

  override async claim(): Promise<boolean> {
    return this.claimResult;
  }

  override async ensureWorktree(_cloneDir: string, worktreeDir: string, issue: number): Promise<void> {
    mkdirSync(join(worktreeDir, runDir(issue)), { recursive: true });
  }

  override async removeWorktree(_cloneDir: string, worktreeDir: string): Promise<void> {
    rmSync(worktreeDir, { recursive: true, force: true });
  }

  // The runner commits (audit finding #4) and diffs against base before
  // pushing (finding #12); this fake just records that it happened, since
  // there's no real git repo backing the temp worktree in these tests.
  override async commitAll(_worktreeDir: string, message: string): Promise<boolean> {
    this.committed.push(message);
    return true;
  }

  changed: string[] = [];

  override async changedFiles(): Promise<string[]> {
    return this.changed;
  }

  override async push(_worktreeDir: string, issue: number) {
    this.pushed.push(issue);
    return { stdout: "", stderr: "", code: 0 };
  }

  trees = ["faketree"];
  // Each call returns the next tree, then repeats the last, so a test can move HEAD between build and verify.
  override async treeHash(): Promise<string> {
    return this.trees.length > 1 ? this.trees.shift()! : this.trees[0]!;
  }

  override async hasCommits(): Promise<boolean> {
    return true;
  }
}

// The runner grades the build itself now (audit finding #11), so every test
// that reaches the build stage needs a gate result. Defaults to green; a
// test can swap `line` for a red one to exercise the failure path.
export class FakeGateRunner implements GateRunner {
  line = "FACTORY_GATES: status=GREEN passed=10 failed=0 skipped=0 failed_gates=-";
  runs = 0;
  async run(_worktreeDir: string) {
    this.runs++;
    return { stdout: this.line, stderr: "", code: 0 };
  }
}

export function baseIssue(number: number, labels: string[]): GhIssue {
  return { number, title: `Issue ${number}`, body: "do the thing", labels: labels.map((name) => ({ name })), comments: [] };
}

export function fixtureFor(stage: StageName, issue: number) {
  return ReplayExecutor.fromLines(stage, issue, [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Write" }] } }),
    JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.01 }),
  ]);
}

// watch.ts now clears a stage's artifact files before running it (audit
// finding #9), so a test can no longer pre-seed them on disk before calling
// processReadyIssue/resumeNeedsInfo — they'd be deleted before the fake
// executor ever runs. Instead each `push` carries the files that round's
// "claude" run would have written, and runStage() writes them itself, right
// where the clear just happened. A queue per stage:issue key lets a resumed
// stage (needs-info, reject-and-rebuild) return different output each round.
export class MultiStageExecutor {
  private readonly queue = new Map<string, Array<{ executor: ReplayExecutor; files?: Record<string, string>; result?: Partial<StageRunResult> }>>();

  // `result` overrides fields of the replayed result (a kill, a denial, a non-zero exit).
  push(stage: StageName, issue: number, executor: ReplayExecutor, files?: Record<string, string>, result?: Partial<StageRunResult>): void {
    const key = `${stage}:${issue}`;
    const arr = this.queue.get(key) ?? [];
    arr.push({ executor, files, result });
    this.queue.set(key, arr);
  }

  async runStage(opts: { stage: StageName; issue: number; cwd: string; maxBudgetUsd: number }) {
    const key = `${opts.stage}:${opts.issue}`;
    const arr = this.queue.get(key);
    const next = arr?.shift();
    if (!next) throw new Error(`no executor registered for ${key}`);
    if (next.files) {
      const dir = join(opts.cwd, runDir(opts.issue));
      mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(next.files)) writeFileSync(join(dir, name), content);
    }
    return { ...(await next.executor.runStage(opts)), ...next.result };
  }
}

