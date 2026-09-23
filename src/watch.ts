// The runner: polls GitHub, claims issues, drives each stage's executor in a
// worktree, and is the only thing that talks to GitHub (plan section 9). A
// stage skill never calls `gh` or pushes; it writes its comment bodies and
// verdicts to `.factory/runs/issue-<N>/*` (see artifacts.ts) and this file
// posts them, sets labels, pushes, and opens the draft PR.

import type { FactoryConfig } from "./config";
import type { Executor } from "./executor";
import { readStageArtifacts, runDir, type BuildArtifact, type PlanArtifact, type TriageArtifact, type VerdictArtifact } from "./artifacts";
import { latestTrustedCommentAfter, parseChatOps } from "./chatops";
import type { GhIssue, GitHub } from "./github";
import type { Git } from "./git";
import { FactoryState, type Stage } from "./state";
import { LABEL } from "./labels";

export type { Stage };
export type Outcome =
  | "needs-info"
  | "awaiting-approval"
  | "needs-human"
  | "failed"
  | "shipped"
  | "cancelled"
  | "lost-claim"
  | "waiting";

const STAGE_LABEL: Record<Stage, string> = {
  triage: LABEL.triaging,
  plan: LABEL.planning,
  build: LABEL.building,
  verify: LABEL.verifying,
  pr: LABEL.inReview,
};

const MAX_VERIFY_REJECTS = 2;

export interface WatchDeps {
  readonly github: GitHub;
  readonly git: Git;
  readonly state: FactoryState;
  readonly executor: Executor;
  readonly cloneDir: string;
  readonly workspacesDir: string;
}

export interface PollResult {
  readonly paused: boolean;
  readonly reason?: string;
  readonly processed: number[];
}

function worktreeFor(deps: WatchDeps, issue: number): string {
  return `${deps.workspacesDir}/issue-${issue}`;
}

function labelsOf(issue: Pick<GhIssue, "labels">): string[] {
  return issue.labels.map((l) => l.name);
}

async function setLabel(deps: WatchDeps, config: FactoryConfig, issueNumber: number, next: string): Promise<void> {
  const run = deps.state.getRun(config.repo, issueNumber);
  const current = run ? [STAGE_LABEL[run.stage] ?? LABEL.ready] : [LABEL.ready];
  await deps.github.setStateLabel(config.repo, issueNumber, current, next);
}

async function postComment(deps: WatchDeps, config: FactoryConfig, issueNumber: number, body: string): Promise<void> {
  if (!body.trim()) return;
  await deps.github.commentIssue(config.repo, issueNumber, body);
}

// Build's status-comment.md is the one comment the runner keeps and edits in
// place, rather than posting fresh each time (factory-comment's contract).
// The id is remembered on the run row so a later build round finds it again.
async function upsertStatusComment(deps: WatchDeps, config: FactoryConfig, issueNumber: number, body: string): Promise<void> {
  if (!body.trim()) return;
  const run = deps.state.getRun(config.repo, issueNumber);
  if (run?.status_comment_id) {
    await deps.github.editComment(config.repo, run.status_comment_id, body);
    return;
  }
  const id = await deps.github.commentIssue(config.repo, issueNumber, body);
  if (id !== undefined) deps.state.updateRun(config.repo, issueNumber, { status_comment_id: id });
}

function finish(
  deps: WatchDeps,
  config: FactoryConfig,
  issueNumber: number,
  status: "needs-info" | "awaiting-approval" | "needs-human" | "failed" | "shipped" | "cancelled",
  reason?: string,
): void {
  deps.state.updateRun(config.repo, issueNumber, { status, reason: reason ?? null });
}

// Skills never call `gh` (only the runner talks to GitHub), so the current
// issue thread is handed to them as a file: they read it instead of fetching
// it themselves. Written fresh before every stage so a resumed stage sees any
// new trusted reply.
async function writeIssueSnapshot(worktree: string, issue: GhIssue): Promise<void> {
  await Bun.write(`${worktree}/${runDir(issue.number)}/issue.json`, JSON.stringify(issue, null, 2));
}

async function runStage(
  deps: WatchDeps,
  config: FactoryConfig,
  issue: GhIssue,
  stage: Stage,
  worktree: string,
): Promise<void> {
  const issueNumber = issue.number;
  await writeIssueSnapshot(worktree, issue);
  deps.state.upsertRun({ issue: issueNumber, repo: config.repo, title: issue.title, stage, status: "running" });
  const run = deps.state.getRun(config.repo, issueNumber)!;
  const result = await deps.executor.runStage({
    stage,
    issue: issueNumber,
    cwd: worktree,
    maxBudgetUsd: config.maxBudgetUsd[stage],
  });
  for (const e of result.events) {
    deps.state.appendEvent(run.id, stage, e.kind, e.text ?? e.toolName ?? "");
  }
  deps.state.updateRun(config.repo, issueNumber, {
    tool_calls: run.tool_calls + result.toolCalls,
    tokens_in: run.tokens_in + result.tokensIn,
    tokens_out: run.tokens_out + result.tokensOut,
    cost_usd: run.cost_usd + result.costUsd,
  });
}

interface RunCtx {
  rejectRound: number;
}

// The heart of the loop: drives one issue forward from `startStage` until it
// hits a stopping point (needs-info, awaiting-approval, needs-human, failed,
// shipped). Called both for a fresh factory:ready pickup and for a resume.
async function runFromStage(
  deps: WatchDeps,
  config: FactoryConfig,
  issue: GhIssue,
  startStage: Stage,
  worktree: string,
  ctx: RunCtx = { rejectRound: 0 },
): Promise<Outcome> {
  const issueNumber = issue.number;
  let stage: Stage = startStage;

  for (;;) {
    if (stage === "triage") {
      await runStage(deps, config, issue, "triage", worktree);
      const art = await readStageArtifacts(worktree, issueNumber, "triage");
      if (art.comment) await postComment(deps, config, issueNumber, art.comment);
      const json = art.json as TriageArtifact | undefined;
      if (!json || json.disposition === "refused" || json.disposition === "duplicate") {
        await setLabel(deps, config, issueNumber, LABEL.needsHuman);
        finish(deps, config, issueNumber, "needs-human", json?.disposition ?? "no-triage-artifact");
        return "needs-human";
      }
      if (json.disposition === "needs-info") {
        if (art.question) await postComment(deps, config, issueNumber, art.question);
        await setLabel(deps, config, issueNumber, LABEL.needsInfo);
        finish(deps, config, issueNumber, "needs-info");
        return "needs-info";
      }
      await setLabel(deps, config, issueNumber, LABEL.planning);
      stage = "plan";
      continue;
    }

    if (stage === "plan") {
      await runStage(deps, config, issue, "plan", worktree);
      const art = await readStageArtifacts(worktree, issueNumber, "plan");
      if (art.comment) await postComment(deps, config, issueNumber, art.comment);
      const json = art.json as PlanArtifact | undefined;
      const autoApproveToggle = deps.state.getToggle("auto_approve_low_risk", false);
      const eligible = Boolean(json && json.risk === "low" && json.autoApproveEligible && autoApproveToggle);
      if (!eligible) {
        await setLabel(deps, config, issueNumber, LABEL.awaitingApproval);
        finish(deps, config, issueNumber, "awaiting-approval");
        return "awaiting-approval";
      }
      await setLabel(deps, config, issueNumber, LABEL.building);
      stage = "build";
      continue;
    }

    if (stage === "build") {
      await runStage(deps, config, issue, "build", worktree);
      const art = await readStageArtifacts(worktree, issueNumber, "build");
      if (art.comment) await upsertStatusComment(deps, config, issueNumber, art.comment);
      const json = art.json as BuildArtifact | undefined;
      if (json?.status === "needs-info") {
        if (art.question) await postComment(deps, config, issueNumber, art.question);
        await setLabel(deps, config, issueNumber, LABEL.needsInfo);
        finish(deps, config, issueNumber, "needs-info");
        return "needs-info";
      }
      if (!json || json.status === "red") {
        await setLabel(deps, config, issueNumber, LABEL.failed);
        deps.state.updateRun(config.repo, issueNumber, { gate_line: json?.gate_line ?? null });
        finish(deps, config, issueNumber, "failed", "gates stayed red");
        return "failed";
      }
      deps.state.updateRun(config.repo, issueNumber, { gate_line: json.gate_line });
      await deps.git.push(worktree, issueNumber);
      await setLabel(deps, config, issueNumber, LABEL.verifying);
      stage = "verify";
      continue;
    }

    if (stage === "verify") {
      await runStage(deps, config, issue, "verify", worktree);
      const art = await readStageArtifacts(worktree, issueNumber, "verify");
      if (art.comment) await postComment(deps, config, issueNumber, art.comment);
      const json = art.json as VerdictArtifact | undefined;
      if (!json || json.result === "uncertain") {
        await setLabel(deps, config, issueNumber, LABEL.needsHuman);
        finish(deps, config, issueNumber, "needs-human", "verify uncertain");
        return "needs-human";
      }
      if (json.result === "reject") {
        ctx.rejectRound += 1;
        if (ctx.rejectRound > MAX_VERIFY_REJECTS) {
          await setLabel(deps, config, issueNumber, LABEL.needsHuman);
          finish(deps, config, issueNumber, "needs-human", `rejected ${ctx.rejectRound} times`);
          return "needs-human";
        }
        await setLabel(deps, config, issueNumber, LABEL.building);
        stage = "build";
        continue;
      }
      await setLabel(deps, config, issueNumber, LABEL.inReview);
      stage = "pr";
      continue;
    }

    // stage === "pr"
    await runStage(deps, config, issue, "pr", worktree);
    const art = await readStageArtifacts(worktree, issueNumber, "pr");
    const prUrl = await deps.github.createPr({
      repo: config.repo,
      base: config.base,
      head: deps.git.branchName(issueNumber),
      title: `${issue.title} (#${issueNumber})`,
      body: art.comment ?? `Closes #${issueNumber}`,
      draft: true,
    });
    deps.state.updateRun(config.repo, issueNumber, { pr_url: prUrl });
    finish(deps, config, issueNumber, "shipped");
    return "shipped";
  }
}

export async function processReadyIssue(issue: GhIssue, deps: WatchDeps, config: FactoryConfig): Promise<Outcome> {
  const claimed = await deps.git.claim(deps.cloneDir, issue.number, config.base);
  if (!claimed) return "lost-claim";
  const worktree = worktreeFor(deps, issue.number);
  await deps.git.addWorktree(deps.cloneDir, worktree, issue.number);
  await deps.github.setStateLabel(config.repo, issue.number, labelsOf(issue), LABEL.triaging);
  deps.state.upsertRun({ issue: issue.number, repo: config.repo, title: issue.title, stage: "triage", status: "running" });
  return runFromStage(deps, config, issue, "triage", worktree);
}

async function findQuestionComment(issue: GhIssue) {
  return [...issue.comments].reverse().find((c) => c.body.includes("<!-- factory:question v1 -->"));
}

async function findPlanComment(issue: GhIssue) {
  return [...issue.comments].reverse().find((c) => c.body.includes("<!-- factory:plan v1"));
}

// A trusted reply newer than the open question resumes the same stage, with
// the reply appended as context (plan section 3).
export async function resumeNeedsInfo(issue: GhIssue, deps: WatchDeps, config: FactoryConfig): Promise<Outcome | undefined> {
  const question = await findQuestionComment(issue);
  if (!question) return undefined;
  const reply = latestTrustedCommentAfter(issue.comments, question.createdAt);
  if (!reply) return "waiting";

  const run = deps.state.getRun(config.repo, issue.number);
  const stage: Stage = run?.stage ?? "triage";
  const worktree = worktreeFor(deps, issue.number);
  await Bun.write(`${worktree}/${runDir(issue.number)}/answer.md`, reply.body);
  await deps.github.setStateLabel(config.repo, issue.number, [LABEL.needsInfo], STAGE_LABEL[stage]);
  deps.state.updateRun(config.repo, issue.number, { status: "running" });
  return runFromStage(deps, config, issue, stage, worktree);
}

// `/factory approve|revise|retry|cancel` on a plan awaiting approval (plan
// section 4). A plain reply here is not a command and is ignored: only a
// question comment accepts a plain-text answer.
export async function resumeAwaitingApproval(issue: GhIssue, deps: WatchDeps, config: FactoryConfig): Promise<Outcome | undefined> {
  const plan = await findPlanComment(issue);
  if (!plan) return undefined;
  const reply = latestTrustedCommentAfter(issue.comments, plan.createdAt);
  if (!reply) return "waiting";
  const command = parseChatOps(reply.body);
  const worktree = worktreeFor(deps, issue.number);

  if (command.type === "approve") {
    await deps.github.setStateLabel(config.repo, issue.number, [LABEL.awaitingApproval], LABEL.building);
    deps.state.updateRun(config.repo, issue.number, { status: "running" });
    return runFromStage(deps, config, issue, "build", worktree);
  }
  if (command.type === "revise") {
    await Bun.write(`${worktree}/${runDir(issue.number)}/revise.md`, command.text);
    await deps.github.setStateLabel(config.repo, issue.number, [LABEL.awaitingApproval], LABEL.planning);
    deps.state.updateRun(config.repo, issue.number, { status: "running" });
    return runFromStage(deps, config, issue, "plan", worktree);
  }
  if (command.type === "cancel") {
    await deps.github.removeLabels(config.repo, issue.number, [LABEL.awaitingApproval]);
    finish(deps, config, issue.number, "cancelled");
    return "cancelled";
  }
  // retry, or a plain reply that is not a command: nothing to do yet.
  return "waiting";
}

export async function pollOnce(deps: WatchDeps, config: FactoryConfig): Promise<PollResult> {
  const openPrs = await deps.github.listPrs(config.repo, { state: "open" });
  const factoryPrs = openPrs.filter((p) => p.headRefName.startsWith("factory/"));
  if (factoryPrs.length >= config.maxOpenFactoryPrs) {
    return {
      paused: true,
      reason: `STOP_IF: ${factoryPrs.length} factory PRs open in review (limit ${config.maxOpenFactoryPrs})`,
      processed: [],
    };
  }

  const processed: number[] = [];
  const autoStart = deps.state.getToggle("auto_start", true);
  if (autoStart) {
    const ready = await deps.github.listIssuesByLabel(config.repo, LABEL.ready);
    for (const issue of ready.slice(0, config.concurrency)) {
      await processReadyIssue(issue, deps, config);
      processed.push(issue.number);
    }
  }

  const needsInfo = await deps.github.listIssuesByLabel(config.repo, LABEL.needsInfo);
  for (const issue of needsInfo) {
    const outcome = await resumeNeedsInfo(issue, deps, config);
    if (outcome && outcome !== "waiting") processed.push(issue.number);
  }

  const awaitingApproval = await deps.github.listIssuesByLabel(config.repo, LABEL.awaitingApproval);
  for (const issue of awaitingApproval) {
    const outcome = await resumeAwaitingApproval(issue, deps, config);
    if (outcome && outcome !== "waiting") processed.push(issue.number);
  }

  return { paused: false, processed };
}

export function startWatch(deps: WatchDeps, config: FactoryConfig, onTick?: (r: PollResult) => void): () => void {
  const timer = setInterval(() => {
    pollOnce(deps, config)
      .then((r) => onTick?.(r))
      .catch((err) => console.error("factory watch: poll failed", err));
  }, config.pollIntervalSeconds * 1000);
  return () => clearInterval(timer);
}
