// The runner: polls GitHub, claims issues, drives each stage's executor in a
// worktree, and is the only thing that talks to GitHub (plan section 9). A
// stage skill never calls `gh` or pushes; it writes its comment bodies and
// verdicts to `.factory/runs/issue-<N>/*` (see artifacts.ts) and this file
// posts them, sets labels, runs gates, commits, pushes, and opens the PR.
//
// GitHub is the state (audit findings #18-#21): nothing here is required to
// survive in the local SQLite DB. `deriveIssueState` (derive.ts) recovers
// stage, round counts and the status-comment id from the issue's labels and
// comment thread alone, so a restarted watcher, a fresh CI job, or a runner
// on a different machine can all resume any issue.

import type { FactoryConfig } from "./config";
import type { Executor, StageName, StageRunResult } from "./executor";
import {
  clearStageArtifacts,
  readStageArtifacts,
  runDir,
  type BuildArtifact,
  type PlanArtifact,
  type TriageArtifact,
  type VerdictArtifact,
} from "./artifacts";
import { isTrusted, latestTrustedCommentAfter, parseChatOps } from "./chatops";
import { deriveIssueState } from "./derive";
import { rehydrate } from "./rehydrate";
import { runGates, type GateRunner } from "./gates";
import { touchesProtectedPath } from "./boundary";
import { runPool } from "./pool";
import type { GhComment, GhIssue, GitHub } from "./github";
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
const MAX_QUESTION_ROUNDS = 2;
const RUNNING_LABELS = [LABEL.triaging, LABEL.planning, LABEL.building, LABEL.verifying] as const;

export interface WatchDeps {
  readonly github: GitHub;
  readonly git: Git;
  readonly state: FactoryState;
  readonly executor: Executor;
  readonly gateRunner: GateRunner;
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

// Every label transition names its own "from" — always the label the caller
// just set (the loop's own `stage` variable, or the specific parked label a
// resume function is leaving) — rather than guessing at the issue's current
// label list, which is what let a restarted process reconstruct the wrong
// state (audit finding #21).
async function moveLabel(deps: WatchDeps, config: FactoryConfig, issueNumber: number, from: string, to: string): Promise<void> {
  await deps.github.setStateLabel(config.repo, issueNumber, [from], to);
}

function withDataMarker(body: string, stage: string, json: unknown): string {
  return `${body}\n\n<!-- factory:data ${JSON.stringify({ stage, json })} -->`;
}

async function postComment(
  deps: WatchDeps,
  config: FactoryConfig,
  issueNumber: number,
  body: string,
  dataTag?: { stage: string; json: unknown },
): Promise<void> {
  if (!body.trim()) return;
  const full = dataTag ? withDataMarker(body, dataTag.stage, dataTag.json) : body;
  await deps.github.commentIssue(config.repo, issueNumber, full);
}

// Build's status-comment.md is the one comment the runner keeps and edits in
// place. Its id comes from SQLite when this process ran the earlier rounds,
// or — for a resumed/restarted run — from the thread itself, so a restart
// never posts a duplicate status comment (audit finding #21).
async function upsertStatusComment(
  deps: WatchDeps,
  config: FactoryConfig,
  issue: GhIssue,
  body: string,
  json?: unknown,
): Promise<void> {
  if (!body.trim()) return;
  const full = json !== undefined ? withDataMarker(body, "build", json) : body;
  const run = deps.state.getRun(config.repo, issue.number);
  const existingId = run?.status_comment_id ?? deriveIssueState(issue).statusCommentId;
  if (existingId) {
    await deps.github.editComment(config.repo, existingId, full);
    deps.state.updateRun(config.repo, issue.number, { status_comment_id: existingId });
    return;
  }
  const id = await deps.github.commentIssue(config.repo, issue.number, full);
  if (id !== undefined) deps.state.updateRun(config.repo, issue.number, { status_comment_id: id });
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
  stage: StageName,
  worktree: string,
): Promise<StageRunResult> {
  const issueNumber = issue.number;
  // rehydrate before clearing: rehydrate only ever repopulates *earlier*
  // stages' artifacts from the thread, never this stage's own output, so the
  // order only matters for readability, not correctness — but clearing after
  // guarantees this stage never starts with a stale copy of its own last
  // attempt (audit finding #9).
  await rehydrate(worktree, issue);
  await writeIssueSnapshot(worktree, issue);
  await clearStageArtifacts(worktree, issueNumber, stage);

  deps.state.upsertRun({ issue: issueNumber, repo: config.repo, title: issue.title, stage: stage as Stage, status: "running" });
  const run = deps.state.getRun(config.repo, issueNumber)!;
  const result = await deps.executor.runStage({
    stage,
    issue: issueNumber,
    cwd: worktree,
    maxBudgetUsd: config.maxBudgetUsd[stage],
    timeoutMinutes: config.stageTimeoutMinutes,
    maxToolCalls: config.maxToolCalls,
  });
  for (const e of result.events) deps.state.appendEvent(run.id, stage as Stage, e.kind, e.text ?? e.toolName ?? "");
  deps.state.updateRun(config.repo, issueNumber, {
    tool_calls: run.tool_calls + result.toolCalls,
    tokens_in: run.tokens_in + result.tokensIn,
    tokens_out: run.tokens_out + result.tokensOut,
    cost_usd: run.cost_usd + result.costUsd,
  });
  return result;
}

interface RunCtx {
  rejectRound: number;
  questionRound: number;
}

// The heart of the loop: drives one issue forward from `startStage` until it
// hits a stopping point (needs-info, awaiting-approval, needs-human, failed,
// shipped). Called for a fresh factory:ready pickup, a resume, or a retry —
// `ctx` carries the round counts recovered by deriveIssueState so a resumed
// run doesn't reset the needs-info/reject caps to zero.
async function runFromStage(
  deps: WatchDeps,
  config: FactoryConfig,
  issue: GhIssue,
  startStage: Stage,
  worktree: string,
  ctx: RunCtx = { rejectRound: 0, questionRound: 0 },
): Promise<Outcome> {
  const issueNumber = issue.number;
  let stage: Stage = startStage;

  for (;;) {
    if (stage === "triage") {
      const result = await runStage(deps, config, issue, "triage", worktree);
      const art = await readStageArtifacts(worktree, issueNumber, "triage");
      const json = art.json as TriageArtifact | undefined;
      if (result.exitCode !== 0 || !json) {
        await moveLabel(deps, config, issueNumber, LABEL.triaging, LABEL.failed);
        finish(deps, config, issueNumber, "failed", result.killedReason ?? "triage produced no valid triage.json");
        return "failed";
      }
      if (art.comment) await postComment(deps, config, issueNumber, art.comment, { stage: "triage", json });
      if (json.disposition === "refused" || json.disposition === "duplicate") {
        await moveLabel(deps, config, issueNumber, LABEL.triaging, LABEL.needsHuman);
        finish(deps, config, issueNumber, "needs-human", json.disposition);
        return "needs-human";
      }
      if (json.disposition === "needs-info") {
        if (ctx.questionRound >= MAX_QUESTION_ROUNDS) {
          await moveLabel(deps, config, issueNumber, LABEL.triaging, LABEL.needsHuman);
          finish(deps, config, issueNumber, "needs-human", `unresolved after ${ctx.questionRound} rounds of questions`);
          return "needs-human";
        }
        ctx.questionRound += 1;
        if (art.question) await postComment(deps, config, issueNumber, art.question, { stage: "question", json: { round: ctx.questionRound } });
        await moveLabel(deps, config, issueNumber, LABEL.triaging, LABEL.needsInfo);
        finish(deps, config, issueNumber, "needs-info");
        return "needs-info";
      }
      await moveLabel(deps, config, issueNumber, LABEL.triaging, LABEL.planning);
      stage = "plan";
      continue;
    }

    if (stage === "plan") {
      const result = await runStage(deps, config, issue, "plan", worktree);
      const art = await readStageArtifacts(worktree, issueNumber, "plan");
      const json = art.json as PlanArtifact | undefined;
      // A plan stage that crashes (or writes nothing) used to fall through
      // to "not eligible" and park as awaiting-approval with no plan comment
      // to approve against — stuck forever (audit finding #10).
      if (result.exitCode !== 0 || !json) {
        await moveLabel(deps, config, issueNumber, LABEL.planning, LABEL.failed);
        finish(deps, config, issueNumber, "failed", result.killedReason ?? "plan produced no valid plan.json");
        return "failed";
      }
      if (art.comment) await postComment(deps, config, issueNumber, art.comment, { stage: "plan", json });
      const autoApproveToggle = deps.state.getToggle("auto_approve_low_risk", config.riskPolicy.autoApproveLowRisk);
      const eligible = json.risk === "low" && json.autoApproveEligible && autoApproveToggle;
      if (!eligible) {
        await moveLabel(deps, config, issueNumber, LABEL.planning, LABEL.awaitingApproval);
        finish(deps, config, issueNumber, "awaiting-approval");
        return "awaiting-approval";
      }
      await moveLabel(deps, config, issueNumber, LABEL.planning, LABEL.building);
      stage = "build";
      continue;
    }

    if (stage === "build") {
      const result = await runStage(deps, config, issue, "build", worktree);
      const art = await readStageArtifacts(worktree, issueNumber, "build");
      const json = art.json as BuildArtifact | undefined;

      // The agent's own "needs-info" is a legitimate escape hatch (not a
      // crash), matched to the runner's exact spelling (audit finding #5:
      // the skill used to say `needs_info`).
      if (json?.status === "needs-info") {
        if (ctx.questionRound >= MAX_QUESTION_ROUNDS) {
          await moveLabel(deps, config, issueNumber, LABEL.building, LABEL.needsHuman);
          finish(deps, config, issueNumber, "needs-human", `unresolved after ${ctx.questionRound} rounds of questions`);
          return "needs-human";
        }
        ctx.questionRound += 1;
        if (art.comment) await upsertStatusComment(deps, config, issue, art.comment, json);
        if (art.question) await postComment(deps, config, issueNumber, art.question, { stage: "question", json: { round: ctx.questionRound } });
        await moveLabel(deps, config, issueNumber, LABEL.building, LABEL.needsInfo);
        finish(deps, config, issueNumber, "needs-info");
        return "needs-info";
      }

      // The runner grades the build, not the agent (audit finding #11): run
      // the target's own gates.sh here and trust only its FACTORY_GATES line.
      const gate = await runGates(deps.gateRunner, worktree);
      if (art.comment) await upsertStatusComment(deps, config, issue, art.comment, { build: json ?? null, gate });

      if (result.exitCode !== 0 || !json || gate.status !== "GREEN") {
        await moveLabel(deps, config, issueNumber, LABEL.building, LABEL.failed);
        deps.state.updateRun(config.repo, issueNumber, { gate_line: gate.raw });
        const reason =
          result.killedReason ?? `gates ${gate.status.toLowerCase()}${gate.failedGates.length ? `: ${gate.failedGates.join(", ")}` : ""}`;
        finish(deps, config, issueNumber, "failed", reason);
        return "failed";
      }

      // The runner commits — the build skill's own instructions say so, but
      // nothing enforced it before (audit finding #4). `.factory/runs/` is
      // excluded; it's the stage handoff, never meant to land in the repo.
      await deps.git.commitAll(worktree, `factory: build #${issueNumber}`);

      // Defense in depth behind the guard hook: a Bash-made edit to a
      // protected path never reaches Edit/Write, so the hook never sees it
      // (audit finding #12). Diff the branch itself before pushing anything.
      const changed = await deps.git.changedFiles(worktree, config.base);
      const hits = touchesProtectedPath(changed, config.protectedPaths);
      if (hits.length) {
        await moveLabel(deps, config, issueNumber, LABEL.building, LABEL.needsHuman);
        finish(deps, config, issueNumber, "needs-human", `touched protected path(s): ${hits.join(", ")}`);
        return "needs-human";
      }

      deps.state.updateRun(config.repo, issueNumber, { gate_line: gate.raw });
      await deps.git.push(worktree, issueNumber);
      await moveLabel(deps, config, issueNumber, LABEL.building, LABEL.verifying);
      stage = "verify";
      continue;
    }

    if (stage === "verify") {
      const result = await runStage(deps, config, issue, "verify", worktree);
      const art = await readStageArtifacts(worktree, issueNumber, "verify");
      const json = art.json as VerdictArtifact | undefined;
      if (result.exitCode !== 0 || !json || json.result === "uncertain") {
        await moveLabel(deps, config, issueNumber, LABEL.verifying, LABEL.needsHuman);
        finish(
          deps,
          config,
          issueNumber,
          "needs-human",
          result.killedReason ?? (json ? "verify uncertain" : "verify produced no valid verdict.json"),
        );
        return "needs-human";
      }
      if (art.comment) await postComment(deps, config, issueNumber, art.comment, { stage: "verify", json });
      if (json.result === "reject") {
        ctx.rejectRound += 1;
        if (ctx.rejectRound > MAX_VERIFY_REJECTS) {
          await moveLabel(deps, config, issueNumber, LABEL.verifying, LABEL.needsHuman);
          finish(deps, config, issueNumber, "needs-human", `rejected ${ctx.rejectRound} times`);
          return "needs-human";
        }
        await moveLabel(deps, config, issueNumber, LABEL.verifying, LABEL.building);
        stage = "build";
        continue;
      }
      await moveLabel(deps, config, issueNumber, LABEL.verifying, LABEL.inReview);
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
  if (!claimed) {
    // Another runner may have claimed it first, or `factory:ready` was
    // re-applied to an issue whose branch already exists from an earlier,
    // now-parked run. Either way, silently dropping it would strand the
    // issue — say so instead of losing the claim quietly.
    await postComment(
      deps,
      config,
      issue.number,
      "This issue's `factory/issue-" +
        issue.number +
        "` branch already exists, so the claim was not renewed — either another run is already in flight, or a previous run parked here. Use `/factory retry` on the parked labels, not a fresh `factory:ready`.",
    );
    return "lost-claim";
  }
  const worktree = worktreeFor(deps, issue.number);
  await deps.git.ensureWorktree(deps.cloneDir, worktree, issue.number);
  await deps.github.setStateLabel(config.repo, issue.number, [LABEL.ready], LABEL.triaging);
  return runFromStage(deps, config, issue, "triage", worktree);
}

function findQuestionComment(issue: GhIssue): GhComment | undefined {
  return [...issue.comments].reverse().find((c) => c.body.includes("<!-- factory:question v1 -->"));
}

function findPlanComment(issue: GhIssue): GhComment | undefined {
  return [...issue.comments].reverse().find((c) => c.body.includes("<!-- factory:plan v1"));
}

function ctxFrom(issue: GhIssue): RunCtx {
  const derived = deriveIssueState(issue);
  return { rejectRound: derived.rejectRounds, questionRound: derived.questionRounds };
}

// A trusted reply newer than the open question resumes the same stage, with
// the reply appended as context (plan section 3). The stage to resume comes
// from deriveIssueState, not SQLite, so this works after a restart with an
// empty DB (audit finding #21).
export async function resumeNeedsInfo(issue: GhIssue, deps: WatchDeps, config: FactoryConfig): Promise<Outcome | undefined> {
  const question = findQuestionComment(issue);
  if (!question) return undefined;
  const reply = latestTrustedCommentAfter(issue.comments, question.createdAt);
  if (!reply) return "waiting";

  const derived = deriveIssueState(issue);
  const worktree = worktreeFor(deps, issue.number);
  await deps.git.ensureWorktree(deps.cloneDir, worktree, issue.number);
  await Bun.write(`${worktree}/${runDir(issue.number)}/answer.md`, reply.body);
  await deps.github.setStateLabel(config.repo, issue.number, [LABEL.needsInfo], STAGE_LABEL[derived.resumeStage]);
  return runFromStage(deps, config, issue, derived.resumeStage, worktree, ctxFrom(issue));
}

// `/factory approve|revise|retry|cancel` on a plan awaiting approval (plan
// section 4). A plain reply here is not a command and is ignored: only a
// question comment accepts a plain-text answer.
export async function resumeAwaitingApproval(issue: GhIssue, deps: WatchDeps, config: FactoryConfig): Promise<Outcome | undefined> {
  const plan = findPlanComment(issue);
  if (!plan) return undefined;
  const reply = latestTrustedCommentAfter(issue.comments, plan.createdAt);
  if (!reply) return "waiting";
  const command = parseChatOps(reply.body);
  const worktree = worktreeFor(deps, issue.number);

  if (command.type === "approve") {
    await deps.git.ensureWorktree(deps.cloneDir, worktree, issue.number);
    await deps.github.setStateLabel(config.repo, issue.number, [LABEL.awaitingApproval], LABEL.building);
    return runFromStage(deps, config, issue, "build", worktree, ctxFrom(issue));
  }
  if (command.type === "revise") {
    await deps.git.ensureWorktree(deps.cloneDir, worktree, issue.number);
    await Bun.write(`${worktree}/${runDir(issue.number)}/revise.md`, command.text);
    await deps.github.setStateLabel(config.repo, issue.number, [LABEL.awaitingApproval], LABEL.planning);
    return runFromStage(deps, config, issue, "plan", worktree, ctxFrom(issue));
  }
  if (command.type === "cancel") {
    await deps.github.removeLabels(config.repo, issue.number, [LABEL.awaitingApproval]);
    finish(deps, config, issue.number, "cancelled");
    return "cancelled";
  }
  // retry, or a plain reply that is not a command: nothing to do yet.
  return "waiting";
}

// `/factory retry` on a `failed` or `needs-human` issue (audit finding #18):
// before this, both were dead ends. Resumes from whichever stage last
// posted a data marker, recovered by deriveIssueState.
export async function resumeParked(issue: GhIssue, deps: WatchDeps, config: FactoryConfig): Promise<Outcome | undefined> {
  const trusted = issue.comments.filter((c) => isTrusted(c));
  const latest = trusted[trusted.length - 1];
  if (!latest || parseChatOps(latest.body).type !== "retry") return undefined;

  const currentLabel = labelsOf(issue).find((n) => n === LABEL.failed || n === LABEL.needsHuman);
  if (!currentLabel) return undefined;

  const derived = deriveIssueState(issue);
  const worktree = worktreeFor(deps, issue.number);
  await deps.git.ensureWorktree(deps.cloneDir, worktree, issue.number);
  await deps.github.setStateLabel(config.repo, issue.number, [currentLabel], STAGE_LABEL[derived.resumeStage]);
  return runFromStage(deps, config, issue, derived.resumeStage, worktree, {
    rejectRound: derived.rejectRounds,
    questionRound: 0, // a human asked for a retry; give it a fresh round of questions if needed
  });
}

// `/factory revise <text>` on an in-review issue (audit finding #19): sends
// the change back to build with the feedback as `revise.md`.
export async function resumeInReview(issue: GhIssue, deps: WatchDeps, config: FactoryConfig): Promise<Outcome | undefined> {
  const trusted = issue.comments.filter((c) => isTrusted(c));
  const latest = trusted[trusted.length - 1];
  if (!latest) return undefined;
  const command = parseChatOps(latest.body);
  if (command.type !== "revise") return undefined;

  const worktree = worktreeFor(deps, issue.number);
  await deps.git.ensureWorktree(deps.cloneDir, worktree, issue.number);
  await Bun.write(`${worktree}/${runDir(issue.number)}/revise.md`, command.text);
  await deps.github.setStateLabel(config.repo, issue.number, [LABEL.inReview], LABEL.building);
  return runFromStage(deps, config, issue, "build", worktree, ctxFrom(issue));
}

// The single entry point every mode drives through: the pool (watch), a
// one-off CLI call (`factory run --issue N`, for CI), and crash recovery all
// call this with nothing but the issue's current GitHub state.
export async function advanceIssue(deps: WatchDeps, config: FactoryConfig, issue: GhIssue): Promise<Outcome> {
  const names = labelsOf(issue);
  if (names.includes(LABEL.ready)) return processReadyIssue(issue, deps, config);
  if (names.includes(LABEL.needsInfo)) return (await resumeNeedsInfo(issue, deps, config)) ?? "waiting";
  if (names.includes(LABEL.awaitingApproval)) return (await resumeAwaitingApproval(issue, deps, config)) ?? "waiting";
  if (names.includes(LABEL.failed) || names.includes(LABEL.needsHuman)) return (await resumeParked(issue, deps, config)) ?? "waiting";
  if (names.includes(LABEL.inReview)) return (await resumeInReview(issue, deps, config)) ?? "waiting";
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

  const autoStart = deps.state.getToggle("auto_start", true);
  const buckets = await Promise.all([
    autoStart ? deps.github.listIssuesByLabel(config.repo, LABEL.ready) : Promise.resolve([]),
    deps.github.listIssuesByLabel(config.repo, LABEL.needsInfo),
    deps.github.listIssuesByLabel(config.repo, LABEL.awaitingApproval),
    deps.github.listIssuesByLabel(config.repo, LABEL.failed),
    deps.github.listIssuesByLabel(config.repo, LABEL.needsHuman),
    deps.github.listIssuesByLabel(config.repo, LABEL.inReview),
  ]);

  const seen = new Set<number>();
  const candidates = buckets.flat().filter((issue) => {
    if (seen.has(issue.number)) return false;
    seen.add(issue.number);
    return true;
  });

  // A pool of `concurrency` workers, not one-at-a-time and not
  // Promise.all-everything: before this, issue #4 never started until #1's
  // whole five-stage chain finished (audit finding #2).
  const outcomes = await runPool(candidates, config.concurrency, (issue) => advanceIssue(deps, config, issue));
  const processed = candidates.filter((_, i) => outcomes[i] && outcomes[i] !== "waiting").map((issue) => issue.number);
  return { paused: false, processed };
}

// Re-drives any issue a crashed or restarted process left sitting in a
// running label — otherwise it just sits there forever, since none of those
// labels are ones pollOnce's resume functions look for (audit finding #21).
// Call once, before the first poll.
export async function recoverInFlight(deps: WatchDeps, config: FactoryConfig): Promise<number[]> {
  const lists = await Promise.all(RUNNING_LABELS.map((l) => deps.github.listIssuesByLabel(config.repo, l)));
  const issues = lists.flat();
  await runPool(issues, config.concurrency, async (issue) => {
    const derived = deriveIssueState(issue);
    const worktree = worktreeFor(deps, issue.number);
    await deps.git.ensureWorktree(deps.cloneDir, worktree, issue.number);
    return runFromStage(deps, config, issue, derived.resumeStage, worktree, {
      rejectRound: derived.rejectRounds,
      questionRound: derived.questionRounds,
    });
  });
  return issues.map((i) => i.number);
}

// Awaits each poll before scheduling the next one, instead of `setInterval`
// (which fires on a fixed clock regardless of whether the previous tick
// finished) — that overlap is what let the same issue get double-dispatched
// (audit finding #2).
export function startWatch(deps: WatchDeps, config: FactoryConfig, onTick?: (r: PollResult) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function loop(): Promise<void> {
    if (stopped) return;
    try {
      const result = await pollOnce(deps, config);
      onTick?.(result);
    } catch (err) {
      console.error("factory watch: poll failed", err);
    }
    if (!stopped) timer = setTimeout(loop, config.pollIntervalSeconds * 1000);
  }

  timer = setTimeout(loop, 0);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
