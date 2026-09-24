// `factory reset --dry-run` must plan the right actions without touching a
// real `gh` or `git`: close factory PRs, delete factory/* branches, force
// main back to the baseline tag, close every open issue, recreate the
// seeded issues, ensure every label exists, and wipe worktrees/state. This
// drives planReset directly against an injected fake gh/git.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseIssueSeed, planReset, rebaseline, reset, type ResetDeps } from "../src/reset";
import { GitHub, type CommandResult, type CommandRunner, type GhIssue, type GhPr } from "../src/github";
import { LABELS } from "../src/labels";

class FakeGitHub extends GitHub {
  openIssues: GhIssue[];
  openPrs: GhPr[];
  closedPrs: number[] = [];
  closedIssues: number[] = [];
  createdIssues: { title: string; body: string; labels: string[] }[] = [];
  ensuredLabels: string[] = [];

  constructor(openIssues: GhIssue[], openPrs: GhPr[]) {
    super();
    this.openIssues = openIssues;
    this.openPrs = openPrs;
  }

  override async listOpenIssues(): Promise<GhIssue[]> {
    return this.openIssues;
  }

  override async listPrs(): Promise<GhPr[]> {
    return this.openPrs;
  }

  override async closePr(_repo: string, number: number): Promise<void> {
    this.closedPrs.push(number);
  }

  override async closeIssue(_repo: string, number: number): Promise<void> {
    this.closedIssues.push(number);
  }

  override async createIssue(_repo: string, title: string, body: string, labels: string[]): Promise<number> {
    this.createdIssues.push({ title, body, labels });
    return 1000 + this.createdIssues.length;
  }

  override async ensureLabel(_repo: string, name: string): Promise<void> {
    this.ensuredLabels.push(name);
  }
}

class FakeGitRunner implements CommandRunner {
  calls: string[][] = [];
  lsRemoteOutput = "";
  revParseSha = "abc123";
  logOutput = "";
  failPush = false;

  async run(args: string[]): Promise<CommandResult> {
    this.calls.push(args);
    if (args[0] === "ls-remote") return { stdout: this.lsRemoteOutput, stderr: "", code: 0 };
    if (args[0] === "log") return { stdout: this.logOutput, stderr: "", code: 0 };
    if (args[0] === "push" && this.failPush) return { stdout: "", stderr: "protected branch", code: 1 };
    if (args[0] === "rev-parse") return { stdout: `${this.revParseSha}\n`, stderr: "", code: 0 };
    return { stdout: "", stderr: "", code: 0 };
  }
}

function issue(number: number, title: string): GhIssue {
  return { number, title, body: "", labels: [], comments: [] };
}

function pr(number: number, headRefName: string): GhPr {
  return { number, url: `https://github.com/acme/widgets/pull/${number}`, state: "open", headRefName, isDraft: true };
}

describe("parseIssueSeed", () => {
  test("parses frontmatter title/type/labels and the body", () => {
    const seed = parseIssueSeed('---\ntitle: "Add rate limit"\ntype: feature\nlabels: feature, backend\n---\nDo the thing.');
    expect(seed).toEqual({ title: "Add rate limit", type: "feature", labels: ["feature", "backend"], body: "Do the thing." });
  });

  test("strips YAML-array brackets from labels", () => {
    const seed = parseIssueSeed('---\ntitle: "Docs fix"\nlabels: [docs]\n---\nBody.');
    expect(seed.labels).toEqual(["docs"]);
  });

  test("falls back to the first heading when there is no frontmatter", () => {
    const seed = parseIssueSeed("# Fix the login bug\n\nSteps to reproduce...");
    expect(seed.title).toBe("Fix the login bug");
    expect(seed.labels).toEqual(["feature"]);
  });
});

describe("factory reset --dry-run", () => {
  test("plans close-pr, delete-branch, force-main, close-issue, create-issue, ensure-label, wipe actions", async () => {
    const issuesDir = mkdtempSync(join(tmpdir(), "factory-issues-"));
    writeFileSync(join(issuesDir, "001-first.md"), '---\ntitle: "Seed one"\ntype: bug\n---\nBody one.');
    writeFileSync(join(issuesDir, "002-second.md"), "# Seed two\n\nBody two.");

    const github = new FakeGitHub(
      [issue(10, "Old bug"), issue(11, "Old feature")],
      [pr(5, "factory/issue-3"), pr(6, "human/manual-branch")],
    );
    const git = new FakeGitRunner();
    // The real `git ls-remote --heads origin factory/*` already filters to
    // factory/* branches server-side; planReset trusts that and only strips
    // the refs/heads/ prefix, so the fake mirrors a pre-filtered result.
    git.lsRemoteOutput = "abc\trefs/heads/factory/issue-3\n";

    const deps: ResetDeps = { github, git };
    const ctx = {
      repo: "acme/widgets",
      cloneDir: "/tmp/does-not-matter",
      baselineTag: "baseline", base: "main",
      issuesDir,
      workspacesDir: "/tmp/factory-ws-does-not-exist",
      statePath: "/tmp/factory-state-does-not-exist",
    };

    const actions = await planReset(deps, ctx);
    const kinds = actions.map((a) => a.kind);

    expect(kinds.filter((k) => k === "close-pr")).toHaveLength(1);
    expect(actions.find((a) => a.kind === "close-pr")!.detail).toContain("#5");
    // The non-factory PR (human/manual-branch) must not be touched.
    expect(actions.some((a) => a.kind === "close-pr" && a.detail.includes("#6"))).toBe(false);

    expect(kinds.filter((k) => k === "delete-branch")).toHaveLength(1);
    expect(actions.find((a) => a.kind === "delete-branch")!.detail).toBe("factory/issue-3");

    const forceMain = actions.find((a) => a.kind === "force-main")!;
    expect(forceMain.detail).toBe("main <- abc123");

    expect(kinds.filter((k) => k === "close-issue")).toHaveLength(2);
    expect(kinds.filter((k) => k === "create-issue")).toHaveLength(2);
    expect(kinds.filter((k) => k === "ensure-label")).toHaveLength(LABELS.length);
    expect(kinds).toContain("wipe-worktrees");
    expect(kinds).toContain("wipe-state");

    // dry-run: nothing actually called against the fakes.
    const summary = await reset(deps, ctx, true);
    expect(summary.dryRun).toBe(true);
    expect(summary.actions).toEqual(actions);
    expect(github.closedPrs).toEqual([]);
    expect(github.closedIssues).toEqual([]);
    expect(github.createdIssues).toEqual([]);
    expect(git.calls.some((c) => c[0] === "push" && c.includes("--delete"))).toBe(false);

    rmSync(issuesDir, { recursive: true, force: true });
  });

  test("a real (non-dry-run) reset applies every planned action", async () => {
    const issuesDir = mkdtempSync(join(tmpdir(), "factory-issues-"));
    writeFileSync(join(issuesDir, "001.md"), "# Only seed\n\nBody.");
    const github = new FakeGitHub([issue(20, "Stale")], [pr(7, "factory/issue-7")]);
    const git = new FakeGitRunner();
    git.lsRemoteOutput = "sha\trefs/heads/factory/issue-7\n";
    const deps: ResetDeps = { github, git };
    const ctx = {
      repo: "acme/widgets",
      cloneDir: "/tmp/x",
      baselineTag: "baseline", base: "trunk",
      issuesDir,
      workspacesDir: mkdtempSync(join(tmpdir(), "factory-ws-")),
      statePath: mkdtempSync(join(tmpdir(), "factory-state-")),
    };
    mkdirSync(ctx.workspacesDir, { recursive: true });

    await reset(deps, ctx, false);

    expect(github.closedPrs).toEqual([7]);
    expect(github.closedIssues).toEqual([20]);
    expect(github.createdIssues).toHaveLength(1);
    expect(github.ensuredLabels).toHaveLength(LABELS.length);
    expect(git.calls.some((c) => c[0] === "push" && c.includes("--delete") && c.includes("factory/issue-7"))).toBe(true);
    expect(git.calls.some((c) => c[0] === "push" && c.includes("--force") && c.some((a) => a.endsWith(":refs/heads/trunk")))).toBe(true);

    rmSync(issuesDir, { recursive: true, force: true });
  });
});

describe("reset wipes the WAL files with the state database", () => {
  test("factory.db-wal and -shm go too", async () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-wal-"));
    const db = join(dir, "factory.db");
    for (const f of [db, `${db}-wal`, `${db}-shm`]) writeFileSync(f, "x");
    const github = new FakeGitHub([], []);
    const ctx = { repo: "acme/widgets", cloneDir: "/tmp/x", baselineTag: "baseline", base: "trunk", issuesDir: mkdtempSync(join(tmpdir(), "factory-i-")), workspacesDir: join(dir, "ws"), statePath: db };
    await reset({ github, git: new FakeGitRunner() }, ctx, false);
    expect(readdirSync(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("reset keeps merged setup safe", () => {
  const ctxFor = (issuesDir: string) => ({
    repo: "acme/widgets",
    cloneDir: "/tmp/x",
    baselineTag: "baseline",
    base: "main",
    issuesDir,
    workspacesDir: "/tmp/factory-ws-none",
    statePath: "/tmp/factory-state-none",
  });

  test("plan lists the commits the force push would drop", async () => {
    const git = new FakeGitRunner();
    git.logOutput = "1a2b3c Declare agentCommands\n4d5e6f Add runbook\n";
    const actions = await planReset({ github: new FakeGitHub([], []), git }, ctxFor("/tmp/none"));
    expect(actions.filter((a) => a.kind === "drop-commit").map((a) => a.detail)).toEqual([
      "1a2b3c Declare agentCommands",
      "4d5e6f Add runbook",
    ]);
  });

  test("a rejected force push fails the reset instead of reporting success", async () => {
    const git = new FakeGitRunner();
    git.failPush = true;
    await expect(reset({ github: new FakeGitHub([], []), git }, ctxFor("/tmp/none"), false)).rejects.toThrow(/protected branch/);
  });

  test("a refused force push of main leaves PRs, branches and issues untouched", async () => {
    const github = new FakeGitHub([issue(10, "Old bug")], [pr(5, "factory/issue-3")]);
    const git = new FakeGitRunner();
    git.failPush = true;
    git.lsRemoteOutput = "abc\trefs/heads/factory/issue-3\n";
    await expect(reset({ github, git }, ctxFor("/tmp/none"), false)).rejects.toThrow(/protected branch/);
    expect(github.closedPrs).toEqual([]);
    expect(github.closedIssues).toEqual([]);
    expect(github.createdIssues).toEqual([]);
    expect(git.calls.some((c) => c[0] === "push" && c.includes("--delete"))).toBe(false);
  });

  test("rebaseline moves the tag and pushes it; dry-run only lists", async () => {
    const git = new FakeGitRunner();
    git.logOutput = "1a2b3c Declare agentCommands\n";
    const deps = { github: new FakeGitHub([], []), git };
    expect(await rebaseline(deps, ctxFor("/tmp/none"), true)).toEqual(["1a2b3c Declare agentCommands"]);
    expect(git.calls.some((c) => c[0] === "tag")).toBe(false);
    await rebaseline(deps, ctxFor("/tmp/none"), false);
    expect(git.calls).toContainEqual(["tag", "-f", "baseline", "origin/main"]);
    expect(git.calls).toContainEqual(["push", "--force", "origin", "refs/tags/baseline"]);
  });

  test("rebaseline with nothing to move touches nothing", async () => {
    const git = new FakeGitRunner();
    await rebaseline({ github: new FakeGitHub([], []), git }, ctxFor("/tmp/none"), false);
    expect(git.calls.some((c) => c[0] === "tag" || c[0] === "push")).toBe(false);
  });
});
