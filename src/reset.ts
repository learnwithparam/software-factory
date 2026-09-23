// `factory reset --repo <r> [--dry-run]`: put the target repo back to its
// seeded state, any time, idempotently (plan section 10). Every action is
// data first (planReset), so `--dry-run` and the real run share one plan and
// tests can assert on the plan without touching a real `gh`.

import { readdir } from "node:fs/promises";
import type { CommandRunner, GitHub } from "./github";
import { LABELS } from "./labels";

export type ResetActionKind =
  | "close-pr"
  | "delete-branch"
  | "force-main"
  | "close-issue"
  | "create-issue"
  | "ensure-label"
  | "wipe-worktrees"
  | "wipe-state";

export interface ResetAction {
  readonly kind: ResetActionKind;
  readonly detail: string;
  readonly data?: Record<string, unknown>;
}

export interface ResetContext {
  readonly repo: string;
  readonly cloneDir: string;
  readonly baselineTag: string;
  readonly issuesDir: string; // target's .factory/issues/*.md
  readonly workspacesDir: string;
  readonly statePath: string;
}

export interface ResetDeps {
  readonly github: GitHub;
  readonly git: CommandRunner;
}

export interface IssueSeed {
  readonly title: string;
  readonly type: string;
  readonly labels: string[];
  readonly body: string;
}

// `.factory/issues/*.md`: optional `---` frontmatter (title, type, labels: a,
// b) followed by the issue body. A file with no frontmatter uses its first
// heading as the title.
export function parseIssueSeed(text: string): IssueSeed {
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  let title = "";
  let type = "feature";
  let labels: string[] = [];
  let body = text;
  if (fmMatch) {
    const [, front, rest] = fmMatch;
    body = (rest ?? "").trim();
    for (const line of (front ?? "").split("\n")) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      const value = (rawValue ?? "").trim().replace(/^"(.*)"$/, "$1");
      if (key === "title") title = value;
      else if (key === "type") type = value;
      else if (key === "labels") labels = value.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!title) {
    const heading = body.match(/^#\s+(.+)$/m);
    title = heading ? heading[1]!.trim() : "Untitled";
  }
  if (labels.length === 0) labels = [type];
  return { title, type, labels, body: body.trim() };
}

export async function readIssueSeeds(issuesDir: string): Promise<IssueSeed[]> {
  let entries: string[];
  try {
    entries = await readdir(issuesDir);
  } catch {
    return [];
  }
  const seeds: IssueSeed[] = [];
  for (const name of entries.filter((n) => n.endsWith(".md")).sort()) {
    const text = await Bun.file(`${issuesDir}/${name}`).text();
    seeds.push(parseIssueSeed(text));
  }
  return seeds;
}

function parseRemoteBranches(lsRemoteOutput: string): string[] {
  return lsRemoteOutput
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\t")[1] ?? "")
    .filter((ref) => ref.startsWith("refs/heads/"))
    .map((ref) => ref.replace("refs/heads/", ""));
}

export async function planReset(deps: ResetDeps, ctx: ResetContext): Promise<ResetAction[]> {
  const actions: ResetAction[] = [];

  const prs = await deps.github.listPrs(ctx.repo, { state: "open" });
  for (const pr of prs.filter((p) => p.headRefName.startsWith("factory/"))) {
    actions.push({ kind: "close-pr", detail: `#${pr.number} (${pr.headRefName})`, data: { number: pr.number } });
  }

  const lsRemote = await deps.git.run(["ls-remote", "--heads", "origin", "factory/*"], { cwd: ctx.cloneDir });
  for (const branch of parseRemoteBranches(lsRemote.stdout)) {
    actions.push({ kind: "delete-branch", detail: branch, data: { branch } });
  }

  const tag = await deps.git.run(["rev-parse", ctx.baselineTag], { cwd: ctx.cloneDir });
  const sha = tag.stdout.trim();
  actions.push({ kind: "force-main", detail: sha || `<tag ${ctx.baselineTag} not found>`, data: { sha } });

  const openIssues = await deps.github.listOpenIssues(ctx.repo);
  for (const issue of openIssues) {
    actions.push({ kind: "close-issue", detail: `#${issue.number} ${issue.title}`, data: { number: issue.number } });
  }

  const seeds = await readIssueSeeds(ctx.issuesDir);
  for (const seed of seeds) {
    actions.push({ kind: "create-issue", detail: seed.title, data: { seed } });
  }

  for (const label of LABELS) {
    actions.push({ kind: "ensure-label", detail: label.name, data: { label } });
  }

  actions.push({ kind: "wipe-worktrees", detail: ctx.workspacesDir });
  actions.push({ kind: "wipe-state", detail: ctx.statePath });

  return actions;
}

async function applyAction(deps: ResetDeps, ctx: ResetContext, action: ResetAction): Promise<void> {
  switch (action.kind) {
    case "close-pr":
      await deps.github.closePr(ctx.repo, (action.data!.number as number));
      return;
    case "delete-branch":
      await deps.git.run(["push", "origin", "--delete", action.data!.branch as string], { cwd: ctx.cloneDir });
      return;
    case "force-main": {
      const sha = action.data!.sha as string;
      if (!sha) throw new Error(`baseline tag ${ctx.baselineTag} not found in ${ctx.cloneDir}`);
      await deps.git.run(["push", "--force", "origin", `${sha}:refs/heads/main`], { cwd: ctx.cloneDir });
      return;
    }
    case "close-issue":
      await deps.github.closeIssue(ctx.repo, action.data!.number as number);
      return;
    case "create-issue": {
      const seed = action.data!.seed as IssueSeed;
      await deps.github.createIssue(ctx.repo, seed.title, seed.body, seed.labels);
      return;
    }
    case "ensure-label": {
      const label = action.data!.label as { name: string; color: string; description: string };
      await deps.github.ensureLabel(ctx.repo, label.name, label.color, label.description);
      return;
    }
    case "wipe-worktrees":
      await Bun.$`rm -rf ${action.detail}`.quiet();
      return;
    case "wipe-state":
      await Bun.$`rm -rf ${action.detail}`.quiet();
      return;
  }
}

export interface ResetSummary {
  readonly actions: ResetAction[];
  readonly dryRun: boolean;
}

export async function reset(deps: ResetDeps, ctx: ResetContext, dryRun: boolean): Promise<ResetSummary> {
  const actions = await planReset(deps, ctx);
  if (!dryRun) {
    for (const action of actions) {
      await applyAction(deps, ctx, action);
      console.log(`factory reset: ${action.kind} ${action.detail}`);
    }
  }
  return { actions, dryRun };
}
