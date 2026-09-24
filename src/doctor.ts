// `factory doctor [--fix]`: everything the loop needs before `factory watch`
// starts, checked once instead of failing three stages in.

import type { CommandRunner, GitHub } from "./github";
import { LABELS } from "./labels";
import type { AgentConfig, StageAgents } from "./agents/types";
import { PRESETS } from "./agents/presets";

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
  readonly readFile: (path: string) => Promise<string | undefined>;
  readonly isExecutable: (path: string) => Promise<boolean>;
}

export interface DoctorContext {
  readonly repo: string;
  readonly cloneDir: string;
  readonly baselineTag: string;
  readonly factoryMode?: string; // FACTORY_MODE, "actions" when CI drives the loop
  readonly agents?: Record<string, AgentConfig>;
  readonly stages?: StageAgents;
}

export async function runDoctor(deps: DoctorDeps, ctx: DoctorContext): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  checks.push({
    name: "gh on PATH",
    ok: await deps.which("gh"),
    detail: "gh CLI must be installed and authenticated (`gh auth status`)",
    fixable: false,
  });
  // One check per agent a stage actually uses, not one for every agent in config.
  const agents = ctx.agents ?? { claude: { preset: "claude" } };
  const stages = ctx.stages ?? { default: "claude" };
  const used = new Set([stages.default ?? "claude", ...Object.values(stages)].filter((n): n is string => Boolean(n)));
  for (const name of [...used].sort()) {
    const agent = agents[name];
    const preset = agent?.preset ? PRESETS[agent.preset] : undefined;
    const binary = agent?.command?.[0] ?? preset?.binary;
    checks.push({
      name: `${binary ?? name} on PATH`,
      ok: binary !== undefined && (await deps.which(binary)),
      detail: `agent "${name}" runs each stage it is assigned`,
      fixable: false,
    });
    if (agent && !preset) {
      checks.push({
        name: `agent "${name}" reports usage`,
        ok: true,
        detail: "no preset, so tokens show as not reported and the tool-call cap is not enforced; the timeout is the backstop (consider a sandbox)",
        fixable: false,
      });
    }
  }
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
    name: "target has an executable .factory/gates.sh",
    ok: await deps.isExecutable(`${ctx.cloneDir}/.factory/gates.sh`),
    detail: `${ctx.cloneDir}/.factory/gates.sh (run \`factory install --update\` to restore it)`,
    fixable: false,
  });
  // A skeleton left as installed still has TODO markers: the runner would
  // grade against placeholder gates and an empty charter.
  for (const file of ["config.json", "charter.md"]) {
    const text = await deps.readFile(`${ctx.cloneDir}/.factory/${file}`);
    checks.push({
      name: `.factory/${file} has no TODO left`,
      ok: text !== undefined && !text.includes("TODO"),
      detail: text === undefined ? "file is missing" : text.includes("TODO") ? "fill in every TODO" : "filled in",
      fixable: false,
    });
  }
  if (ctx.factoryMode === "actions") {
    checks.push({
      name: "FACTORY_MODE=actions has a workflow",
      ok: await deps.fileExists(`${ctx.cloneDir}/.github/workflows/factory.yml`),
      detail: "rename .github/workflows/factory.yml.example to factory.yml (from `factory install --ci`)",
      fixable: false,
    });
  }

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
