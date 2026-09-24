// The contract between a stage skill (running inside `claude`, sandboxed by
// guard-paths.sh + settings.json) and the runner. Section 9 of the plan says
// "the agent cannot push, merge or call gh; only the runner talks to GitHub" —
// enforced here: skills write their comment bodies and structured verdicts to
// `.factory/runs/issue-<N>/*`, which the guard hook always allows, and the
// runner is the only thing that turns those files into GitHub API calls.

import { mkdir, unlink } from "node:fs/promises";

export type Disposition = "proceed" | "needs-info" | "refused" | "duplicate";
export type Risk = "low" | "medium" | "high";
export type VerdictResult = "pass" | "reject" | "uncertain";
export type BuildStatus = "green" | "red" | "needs-info";

export interface TriageArtifact {
  readonly disposition: Disposition;
  readonly type: "bug" | "feature" | "docs" | "security" | "dependency";
  readonly risk: Risk;
  readonly done_when: string;
  readonly files_expected: string[];
  readonly gate_level: string;
  readonly confidence: number;
}

export interface PlanArtifact {
  readonly status?: "needs-info";
  readonly risk: Risk;
  readonly revision: number;
  readonly files: string[];
  readonly autoApproveEligible: boolean;
  readonly commentId?: number;
}

export interface BuildArtifact {
  readonly status: BuildStatus;
  readonly gate_line: string;
  readonly rounds: number;
}

// A finding is a plain string (older verdicts) or the blueprint review shape:
// severity, a 0-5 confidence, and what/why/where/fix. Strings never block a pass.
export type Severity = "must" | "should" | "could";
export interface Finding {
  readonly severity: Severity;
  readonly confidence: number;
  readonly what: string;
  readonly where?: string;
  readonly why?: string;
  readonly fix?: string;
}
export interface Criterion {
  readonly id: string;
  readonly status: "pass" | "fail" | "unverified";
  readonly gap?: string;
}

export interface VerdictArtifact {
  readonly result: VerdictResult;
  readonly rounds: number;
  readonly findings: (string | Finding)[];
  readonly criteria?: Criterion[];
}

// A step result is one JSON object of at most 16 KiB (machinist workflow.go).
export const MAX_STEP_JSON_BYTES = 16 * 1024;
const VERDICT_KEYS = new Set(["result", "rounds", "findings", "criteria"]);
const FINDING_KEYS = new Set(["severity", "confidence", "what", "where", "why", "fix"]);
const CRITERION_KEYS = new Set(["id", "status", "gap"]);
// A finding this sure and this serious contradicts a pass.
export const BLOCKING_CONFIDENCE = 3;

function unknownKey(obj: object, allowed: Set<string>): string | undefined {
  return Object.keys(obj).find((k) => !allowed.has(k));
}

// Rejects a verdict that is malformed or contradicts itself. The runner never
// trusts a "pass" that lists a blocking finding or an unverified criterion.
export function validateVerdict(raw: unknown): { ok: true; verdict: VerdictArtifact } | { ok: false; reason: string } {
  const bad = (reason: string) => ({ ok: false as const, reason });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("verdict.json is not a JSON object");
  const v = raw as Record<string, unknown>;
  const extra = unknownKey(v, VERDICT_KEYS);
  if (extra) return bad(`verdict.json has unknown field "${extra}"`);
  if (v.result !== "pass" && v.result !== "reject" && v.result !== "uncertain") return bad('verdict.json "result" must be pass, reject or uncertain');
  if (!Number.isInteger(v.rounds) || (v.rounds as number) < 0) return bad('verdict.json "rounds" must be a non-negative integer');
  if (!Array.isArray(v.findings)) return bad('verdict.json "findings" must be an array');
  for (const f of v.findings) {
    if (typeof f === "string") continue;
    if (typeof f !== "object" || f === null) return bad("a finding must be a string or an object");
    const key = unknownKey(f, FINDING_KEYS);
    if (key) return bad(`a finding has unknown field "${key}"`);
    const o = f as Record<string, unknown>;
    if (o.severity !== "must" && o.severity !== "should" && o.severity !== "could") return bad("a finding's severity must be must, should or could");
    if (!Number.isInteger(o.confidence) || (o.confidence as number) < 0 || (o.confidence as number) > 5) return bad("a finding's confidence must be an integer from 0 to 5");
    if (typeof o.what !== "string" || !o.what.trim()) return bad("a finding needs a non-empty \"what\"");
  }
  if (v.criteria !== undefined) {
    if (!Array.isArray(v.criteria)) return bad('verdict.json "criteria" must be an array');
    for (const c of v.criteria) {
      if (typeof c !== "object" || c === null) return bad("a criterion must be an object");
      const key = unknownKey(c, CRITERION_KEYS);
      if (key) return bad(`a criterion has unknown field "${key}"`);
      const o = c as Record<string, unknown>;
      if (typeof o.id !== "string" || !/^AC-\d+$/.test(o.id)) return bad("a criterion id must look like AC-1");
      if (o.status !== "pass" && o.status !== "fail" && o.status !== "unverified") return bad("a criterion status must be pass, fail or unverified");
    }
  }
  const verdict = v as unknown as VerdictArtifact;
  if (verdict.result === "pass") {
    const blocking = verdict.findings.find((f) => typeof f !== "string" && f.severity !== "could" && f.confidence >= BLOCKING_CONFIDENCE);
    if (blocking) return bad(`verdict is pass but lists a blocking finding: ${(blocking as Finding).what}`);
    const open = verdict.criteria?.find((c) => c.status !== "pass");
    if (open) return bad(`verdict is pass but ${open.id} is ${open.status}`);
  }
  return { ok: true, verdict };
}

export type ArtifactStage = "triage" | "plan" | "build" | "verify" | "pr";

export function runDir(issue: number): string {
  return `.factory/runs/issue-${issue}`;
}

// The one spelling of each stage's artifact filenames — readStageArtifacts,
// clearStageArtifacts and rehydrate() (see rehydrate.ts) all import these
// rather than repeating the strings.
export const COMMENT_FILENAMES: Record<ArtifactStage, string> = {
  triage: "triage-comment.md",
  plan: "plan-comment.md",
  build: "status-comment.md",
  verify: "verdict-comment.md",
  pr: "pr-body.md",
};

export const JSON_FILENAMES: Record<ArtifactStage, string> = {
  triage: "triage.json",
  plan: "plan.json",
  build: "build.json",
  verify: "verdict.json",
  pr: "pr.json",
};

// Undefined for a missing file, and also for one that is too big, not JSON, or
// not a single object: the caller reports "no valid <stage>.json" either way.
async function readJson<T>(path: string): Promise<T | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists()) || file.size > MAX_STEP_JSON_BYTES) return undefined;
  try {
    const value: unknown = await file.json();
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

// What the runner measured after build, tied to the tree it measured, so a
// read-only verifier can trust it instead of re-running the gates.
export interface GateEvidence {
  readonly line: string;
  readonly status: string;
  readonly tree: string;
}

export async function writeGateEvidence(cwd: string, issue: number, evidence: GateEvidence): Promise<void> {
  await mkdir(`${cwd}/${runDir(issue)}`, { recursive: true });
  await Bun.write(`${cwd}/${runDir(issue)}/gate.json`, `${JSON.stringify(evidence)}\n`);
}

async function readText(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  return await file.text();
}

export interface StageArtifacts {
  comment?: string;
  question?: string;
  json?: unknown;
}

// Reads whatever a stage left behind in cwd/.factory/runs/issue-<N>/ after the
// executor finished. cwd is the worktree the stage ran in.
export async function readStageArtifacts(cwd: string, issue: number, stage: ArtifactStage): Promise<StageArtifacts> {
  const base = `${cwd}/${runDir(issue)}`;
  const comment = await readText(`${base}/${COMMENT_FILENAMES[stage]}`);
  const question = await readText(`${base}/question-comment.md`);
  const json = await readJson(`${base}/${JSON_FILENAMES[stage]}`);
  return { comment, question, json };
}

// Deletes a stage's own output files before it runs again, so a re-run (a
// needs-info resume, a revise, a reject-then-rebuild) never reads a stale
// artifact left over from an earlier round (audit finding #9).
export async function clearStageArtifacts(cwd: string, issue: number, stage: ArtifactStage): Promise<void> {
  const base = `${cwd}/${runDir(issue)}`;
  const names = [COMMENT_FILENAMES[stage], JSON_FILENAMES[stage], "question-comment.md"];
  await Promise.all(names.map((n) => unlink(`${base}/${n}`).catch(() => {})));
}
