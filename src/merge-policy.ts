// Ported from owainlewis/machinist@3943516 risk_delivery/gate.py (MIT, Copyright (c) 2026 Owain Lewis). Deviations: the refusal list also follows owainlewis/agent-skills@766699e skills/herdr-issue-coordinator/SKILL.md:209-226 (MIT, Copyright (c) 2026 Owain Lewis), reused as ten named refusal reasons rather than copied code; gate.py's hardcoded docs/README-only, 10-file, 200-line allow-list becomes repo config (merge.autoPaths/maxFiles/maxLines), since a blog post is often longer than 200 lines; validate/auto_eligible/run become checkReadiness/autoEligible/decideMerge+attemptMerge, split so a caller can render the "dry-run" audit comment without ever calling mergePr; the merge always runs `gh pr merge --squash --match-head-commit`, never `--admin`, so a branch-protection block is respected even under policy "auto"; the audit comment carries a `factory:merge-policy:<headSha>` marker instead of gate.py's own comment format, to match this codebase's data-marker convention (src/watch.ts).

import type { Risk } from "./artifacts";
import { touchesProtectedPath } from "./boundary";
import type { CiResult } from "./ci";
import type { MergeConfig } from "./config";
import type { GitHub, MergeReadiness } from "./github";

export interface ChangedFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
}

// The herdr-issue-coordinator merge-gate checklist (SKILL.md:209-226): ten
// conditions, any one of which blocks a merge regardless of the others.
export type MergeRefusalReason =
  | "not-open"
  | "draft"
  | "base-changed"
  | "head-changed"
  | "not-mergeable"
  | "ci-missing"
  | "ci-failed"
  | "reviews-required"
  | "unresolved-threads"
  | "risk-not-low"
  | "not-auto-eligible"
  | "policy-not-auto";

export interface MergeRefusal {
  readonly reason: MergeRefusalReason;
  readonly detail: string;
}

export type MergeDecision =
  | { readonly outcome: "merge"; readonly headSha: string }
  | { readonly outcome: "refuse"; readonly headSha: string; readonly refusals: readonly MergeRefusal[] }
  | { readonly outcome: "dry-run"; readonly headSha: string; readonly eligible: boolean; readonly refusals: readonly MergeRefusal[] };

// Readiness- and CI-derived refusals: the PR's own state, independent of
// what changed. A head or base that moved since the caller's own snapshot
// blocks the merge rather than trusting a stale comparison.
export function checkReadiness(readiness: MergeReadiness, ci: CiResult, expectedBaseRefName: string): MergeRefusal[] {
  const refusals: MergeRefusal[] = [];
  if (readiness.state !== "open") refusals.push({ reason: "not-open", detail: `PR state is "${readiness.state}"` });
  if (readiness.isDraft) refusals.push({ reason: "draft", detail: "PR is still a draft" });
  if (readiness.baseRefName !== expectedBaseRefName) {
    refusals.push({ reason: "base-changed", detail: `base is "${readiness.baseRefName}", expected "${expectedBaseRefName}"` });
  }
  if (readiness.headRefOid !== ci.headSha) {
    refusals.push({ reason: "head-changed", detail: `PR head is ${readiness.headRefOid}, CI result is for ${ci.headSha}` });
  }
  if (readiness.mergeable !== "MERGEABLE") {
    refusals.push({ reason: "not-mergeable", detail: `mergeable state is "${readiness.mergeable}"` });
  }
  if (ci.checks.length === 0) {
    refusals.push({ reason: "ci-missing", detail: "no CI checks are registered on this commit" });
  } else if (ci.status !== "passed") {
    refusals.push({ reason: "ci-failed", detail: `CI status is "${ci.status}"` });
  }
  if (readiness.reviewDecision === "CHANGES_REQUESTED" || readiness.reviewDecision === "REVIEW_REQUIRED") {
    refusals.push({ reason: "reviews-required", detail: `review decision is "${readiness.reviewDecision}"` });
  }
  if (readiness.hasUnresolvedReviewThreads) {
    refusals.push({ reason: "unresolved-threads", detail: "one or more review threads are unresolved" });
  }
  return refusals;
}

// The size/shape gate: even a fully green, fully reviewed PR only qualifies
// for auto-merge if the plan called it low risk and every changed file is
// small, few, and inside merge.autoPaths and outside protectedPaths. A file
// under protectedPaths is never eligible, whatever autoPaths says.
export function autoEligible(
  risk: Risk,
  changedFiles: readonly ChangedFile[],
  merge: Pick<MergeConfig, "autoPaths" | "maxFiles" | "maxLines">,
  protectedPaths: readonly string[],
): MergeRefusal[] {
  const refusals: MergeRefusal[] = [];
  if (risk !== "low") {
    refusals.push({ reason: "risk-not-low", detail: `plan risk is "${risk}", auto-merge requires "low"` });
  }
  const paths = changedFiles.map((f) => f.path);
  const protectedHits = touchesProtectedPath(paths, protectedPaths);
  if (protectedHits.length > 0) {
    refusals.push({ reason: "not-auto-eligible", detail: `protected path(s): ${protectedHits.join(", ")}` });
  }
  const globs = merge.autoPaths.map((pattern) => new Bun.Glob(pattern));
  const outside = paths.filter((path) => !globs.some((g) => g.match(path)));
  if (outside.length > 0) {
    refusals.push({ reason: "not-auto-eligible", detail: `outside merge.autoPaths: ${outside.join(", ")}` });
  }
  if (changedFiles.length > merge.maxFiles) {
    refusals.push({ reason: "not-auto-eligible", detail: `${changedFiles.length} files changed, over merge.maxFiles (${merge.maxFiles})` });
  }
  const totalLines = changedFiles.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  if (totalLines > merge.maxLines) {
    refusals.push({ reason: "not-auto-eligible", detail: `${totalLines} lines changed, over merge.maxLines (${merge.maxLines})` });
  }
  return refusals;
}

export interface DecideMergeInput {
  readonly readiness: MergeReadiness;
  readonly ci: CiResult;
  readonly risk: Risk;
  readonly changedFiles: readonly ChangedFile[];
  readonly merge: MergeConfig;
  readonly protectedPaths: readonly string[];
  readonly expectedBaseRefName: string;
}

// Authority is explicit only (herdr SKILL.md:18-23): "merge" is returned only
// when policy is exactly "auto" and every readiness and eligibility check
// holds. "off" and any unrecognized policy always refuse, never merge —
// there is no default-allow path.
export function decideMerge(input: DecideMergeInput): MergeDecision {
  const headSha = input.readiness.headRefOid;
  const readinessRefusals = checkReadiness(input.readiness, input.ci, input.expectedBaseRefName);
  const eligibilityRefusals = autoEligible(input.risk, input.changedFiles, input.merge, input.protectedPaths);
  const refusals = [...readinessRefusals, ...eligibilityRefusals];

  if (input.merge.policy === "dry-run") {
    return { outcome: "dry-run", headSha, eligible: refusals.length === 0, refusals };
  }
  if (input.merge.policy !== "auto") {
    return { outcome: "refuse", headSha, refusals: [{ reason: "policy-not-auto", detail: `merge.policy is "${input.merge.policy}"` }] };
  }
  if (refusals.length > 0) return { outcome: "refuse", headSha, refusals };
  return { outcome: "merge", headSha };
}

// Never called for a "refuse" or "dry-run" decision: this is the only path
// in this module that can reach GitHub.mergePr, and it only reaches it for
// outcome "merge". A retried call against an already-merged PR re-derives
// "refuse" (not-open) from a fresh readiness read upstream, so this never
// double-merges.
export async function attemptMerge(github: Pick<GitHub, "mergePr">, repo: string, prNumber: number, decision: MergeDecision): Promise<boolean> {
  if (decision.outcome !== "merge") return false;
  await github.mergePr(repo, prNumber, decision.headSha);
  return true;
}

export function mergePolicyMarker(headSha: string): string {
  return `<!-- factory:merge-policy:${headSha} -->`;
}

// The comment posted to the PR either way: what was decided, and why, so a
// human reviewing a "dry-run" or "refuse" outcome sees every reason at once.
export function renderAuditComment(decision: MergeDecision): string {
  const marker = mergePolicyMarker(decision.headSha);
  if (decision.outcome === "merge") {
    return `${marker}\nMerge policy: **auto** — all gates passed, merging \`${decision.headSha.slice(0, 7)}\`.`;
  }
  const label = decision.outcome === "dry-run" ? "dry-run" : "auto";
  const verdict =
    decision.outcome === "dry-run"
      ? decision.eligible
        ? 'would auto-merge once merge.policy is "auto"'
        : "would NOT auto-merge"
      : "blocked";
  const lines = decision.refusals.map((r) => `- **${r.reason}**: ${r.detail}`);
  return [marker, `Merge policy: **${label}** — ${verdict}.`, ...(lines.length ? ["", "Refusals:", ...lines] : [])].join("\n");
}
