// The contract between a stage skill (running inside `claude`, sandboxed by
// guard-paths.sh + settings.json) and the runner. Section 9 of the plan says
// "the agent cannot push, merge or call gh; only the runner talks to GitHub" —
// enforced here: skills write their comment bodies and structured verdicts to
// `.factory/runs/issue-<N>/*`, which the guard hook always allows, and the
// runner is the only thing that turns those files into GitHub API calls.

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

export interface VerdictArtifact {
  readonly result: VerdictResult;
  readonly rounds: number;
  readonly findings: string[];
}

export function runDir(issue: number): string {
  return `.factory/runs/issue-${issue}`;
}

function artifactPath(issue: number, name: string): string {
  return `${runDir(issue)}/${name}`;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  return (await file.json()) as T;
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
export async function readStageArtifacts(
  cwd: string,
  issue: number,
  stage: "triage" | "plan" | "build" | "verify" | "pr",
): Promise<StageArtifacts> {
  const base = `${cwd}/${runDir(issue)}`;
  const commentNames: Record<string, string> = {
    triage: "triage-comment.md",
    plan: "plan-comment.md",
    build: "status-comment.md",
    verify: "verdict-comment.md",
    pr: "pr-body.md",
  };
  const jsonNames: Record<string, string> = {
    triage: "triage.json",
    plan: "plan.json",
    build: "build.json",
    verify: "verdict.json",
    pr: "pr.json",
  };
  const comment = await readText(`${base}/${commentNames[stage]}`);
  const question = await readText(`${base}/question-comment.md`);
  const json = await readJson(`${base}/${jsonNames[stage]}`);
  return { comment, question, json };
}
