// `factory doctor [--fix]`: everything the loop needs before `factory watch`
// starts, checked once instead of failing three stages in.

import type { CommandRunner, GitHub } from "./github";
import { LABELS } from "./labels";

export interface DoctorCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly fixable: boolean;
}

export interface DoctorDeps {
  readonly github: GitHub;
  readonly git: CommandRunner;
  readonly which: (bin: string) => Promise<boolean>;
  readonly fileExists: (path: string) => Promise<boolean>;
}

export interface DoctorContext {
  readonly repo: string;
  readonly cloneDir: string;
  readonly baselineTag: string;
}

export async function runDoctor(deps: DoctorDeps, ctx: DoctorContext): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "gh on PATH",
    ok: await deps.which("gh"),
    detail: "gh CLI must be installed and authenticated (`gh auth status`)",
    fixable: false,
  });
  checks.push({
    name: "claude on PATH",
    ok: await deps.which("claude"),
    detail: "the Claude Code CLI runs each stage",
    fixable: false,
  });
  checks.push({
    name: "python3 on PATH",
    ok: await deps.which("python3"),
    detail: "guard-paths.sh parses hook JSON with python3 and fails closed (blocks everything) without it",
    fixable: false,
  });
  checks.push({
    name: "jq on PATH",
    ok: await deps.which("jq"),
    detail: "gates.sh and the CI workflow expect jq",
    fixable: false,
  });

  const auth = await deps.github.authStatus();
  checks.push({
    name: "gh authenticated",
    ok: auth.ok,
    detail: auth.detail,
    fixable: false,
  });

  checks.push({
    name: "target has .factory/config.json",
    ok: await deps.fileExists(`${ctx.cloneDir}/.factory/config.json`),
    detail: `${ctx.cloneDir}/.factory/config.json`,
    fixable: false,
  });
  checks.push({
    name: "target has .factory/gates.sh",
    ok: await deps.fileExists(`${ctx.cloneDir}/.factory/gates.sh`),
    detail: `${ctx.cloneDir}/.factory/gates.sh`,
    fixable: false,
  });

  const tag = await deps.git.run(["rev-parse", ctx.baselineTag], { cwd: ctx.cloneDir });
  checks.push({
    name: `baseline tag "${ctx.baselineTag}" exists`,
    ok: tag.code === 0,
    detail: tag.stdout.trim() || tag.stderr.trim(),
    fixable: false,
  });

  let existingLabels: Set<string>;
  try {
    existingLabels = new Set(await deps.github.listLabels(ctx.repo));
  } catch {
    existingLabels = new Set();
  }
  const missing = LABELS.filter((l) => !existingLabels.has(l.name));
  checks.push({
    name: "all factory labels exist",
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.map((l) => l.name).join(", ")}` : "all present",
    fixable: true,
  });

  return checks;
}

export async function fixDoctor(github: GitHub, repo: string): Promise<void> {
  for (const label of LABELS) {
    await github.ensureLabel(repo, label.name, label.color, label.description);
  }
}
