// Shape of the target repo's `.factory/config.json`. Built by the repo-specific
// side (splitbill) or by whoever installs this template elsewhere; the runner
// only reads it, and `factory doctor` checks it exists. Missing fields fall
// back to DEFAULT_CONFIG so a minimal config.json still works.

import { PRESETS } from "./agents/presets";
import type { AgentConfig, StageAgents } from "./agents/types";

export interface RiskPolicy {
  // Low risk (docs, test-only, a single non-protected module) is eligible for
  // auto-approve; the toggle in state.ts still has to be on.
  readonly autoApproveLowRisk: boolean;
}

export interface StageBudgets {
  readonly triage: number;
  readonly plan: number;
  readonly build: number;
  readonly verify: number;
  readonly pr: number;
}

// Extra Bash patterns the repo grants its agents, on top of the read-only
// git and shell basics in stage-permissions.ts. `read` applies to every
// stage; `build` and `verify` add to that stage only. Each entry is a bare
// pattern such as "make *" or "npm test *", never a compound command.
export interface AgentCommands {
  readonly read: readonly string[];
  readonly build: readonly string[];
  readonly verify: readonly string[];
}

// One gate `.factory/gates.sh` runs. `required: false` reports but never fails the build.
export interface GateSpec {
  readonly name: string;
  readonly cmd: string;
  readonly required: boolean;
}

export interface FactoryConfig {
  readonly repo: string; // "owner/name"
  readonly protectedPaths: readonly string[]; // globs the guard hook and triage refuse
  readonly riskPolicy: RiskPolicy;
  readonly maxOpenFactoryPrs: number; // STOP_IF threshold (plan section 9: 3)
  readonly concurrency: number; // worktrees in flight at once
  readonly pollIntervalSeconds: number;
  readonly maxBudgetUsd: StageBudgets;
  readonly baselineTag: string; // reset.ts forces main to this tag's SHA
  readonly base: string; // base branch for PRs, usually "main"
  readonly stageTimeoutMinutes: number; // kills a stuck `claude` process (audit finding #15)
  readonly maxToolCalls: number; // kills a runaway stage before it burns budget
  readonly gates: readonly GateSpec[]; // read by .factory/gates.sh
  readonly agentCommands: AgentCommands;
  // Named agents, each a preset or a command; `stages` says which one runs a stage.
  readonly agents: Readonly<Record<string, AgentConfig>>;
  readonly stages: StageAgents;
}

export const DEFAULT_CONFIG: FactoryConfig = {
  repo: "",
  protectedPaths: [],
  riskPolicy: { autoApproveLowRisk: true },
  maxOpenFactoryPrs: 3,
  concurrency: 3,
  pollIntervalSeconds: 15,
  maxBudgetUsd: { triage: 1, plan: 2, build: 5, verify: 3, pr: 1 },
  baselineTag: "baseline",
  base: "main",
  stageTimeoutMinutes: 15,
  maxToolCalls: 60,
  gates: [],
  agentCommands: { read: [], build: [], verify: [] },
  agents: { claude: { preset: "claude" } },
  stages: { default: "claude" },
};

export function mergeConfig(partial: Partial<FactoryConfig>): FactoryConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    riskPolicy: { ...DEFAULT_CONFIG.riskPolicy, ...partial.riskPolicy },
    maxBudgetUsd: { ...DEFAULT_CONFIG.maxBudgetUsd, ...partial.maxBudgetUsd },
    agentCommands: { ...DEFAULT_CONFIG.agentCommands, ...partial.agentCommands },
    agents: { ...DEFAULT_CONFIG.agents, ...partial.agents },
    stages: { ...DEFAULT_CONFIG.stages, ...partial.stages },
  };
}

// Every key is listed here; the Record type makes tsc fail if FactoryConfig
// gains a key that is not. `riskCriteria` is never read by the runner (the
// factory-plan skill reads it). A `_`-prefixed key is a comment. Any other
// unknown key is a typo that would silently do nothing, so boot refuses it.
type Kind = "string" | "posInt" | "positive" | "boolean" | "strings" | "object";
const TOP_LEVEL: Record<keyof FactoryConfig | "riskCriteria", Kind> = {
  repo: "string",
  protectedPaths: "strings",
  riskPolicy: "object",
  maxOpenFactoryPrs: "posInt",
  concurrency: "posInt",
  pollIntervalSeconds: "posInt",
  maxBudgetUsd: "object",
  baselineTag: "string",
  base: "string",
  stageTimeoutMinutes: "posInt",
  maxToolCalls: "posInt",
  gates: "object",
  agentCommands: "object",
  agents: "object",
  stages: "object",
  riskCriteria: "object",
};

function kindOk(value: unknown, kind: Kind): boolean {
  switch (kind) {
    case "string": return typeof value === "string" && value.length > 0;
    case "posInt": return Number.isInteger(value) && (value as number) >= 1;
    case "positive": return typeof value === "number" && Number.isFinite(value) && value > 0;
    case "boolean": return typeof value === "boolean";
    case "strings": return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "object": return typeof value === "object" && value !== null;
  }
}

function checkKeys(obj: Record<string, unknown>, allowed: Record<string, Kind>, where: string, problems: string[]): void {
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("_")) continue;
    const kind = allowed[key];
    if (!kind) problems.push(`${where}${key}: unknown key (allowed: ${Object.keys(allowed).join(", ")})`);
    else if (!kindOk(value, kind)) problems.push(`${where}${key}: expected ${kind}, got ${JSON.stringify(value)}`);
  }
}

// Returns every problem at once, so one boot shows the whole list.
export function configProblems(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["config must be a JSON object"];
  const cfg = raw as Record<string, unknown>;
  const problems: string[] = [];
  checkKeys(cfg, TOP_LEVEL, "", problems);
  const nested = (key: string, shape: Record<string, Kind>) => {
    const v = cfg[key];
    if (v !== undefined && kindOk(v, "object") && !Array.isArray(v)) checkKeys(v as Record<string, unknown>, shape, `${key}.`, problems);
  };
  nested("riskPolicy", { autoApproveLowRisk: "boolean" });
  nested("maxBudgetUsd", { triage: "positive", plan: "positive", build: "positive", verify: "positive", pr: "positive" });
  nested("agentCommands", { read: "strings", build: "strings", verify: "strings" });
  if (cfg.gates !== undefined) {
    if (!Array.isArray(cfg.gates)) problems.push("gates: expected a list");
    else cfg.gates.forEach((g, i) => {
      if (typeof g !== "object" || g === null) problems.push(`gates[${i}]: expected an object`);
      else checkKeys(g as Record<string, unknown>, { name: "string", cmd: "string", required: "boolean" }, `gates[${i}].`, problems);
    });
  }
  problems.push(...agentProblems(cfg.agents, cfg.stages));
  return problems;
}

const STAGE_KEYS = ["default", "triage", "plan", "build", "verify", "pr"];

// An agent is a preset or a command. `{{prompt}}` in the executable slot would
// run the prompt as a program (assembler validateConfig), so it is refused.
function agentProblems(agents: unknown, stages: unknown): string[] {
  const problems: string[] = [];
  const named = new Set(["claude"]);
  if (agents !== undefined && typeof agents === "object" && agents !== null && !Array.isArray(agents)) {
    for (const [name, raw] of Object.entries(agents as Record<string, unknown>)) {
      if (name.startsWith("_")) continue;
      named.add(name);
      const where = `agents.${name}.`;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        problems.push(`agents.${name}: expected an object`);
        continue;
      }
      const a = raw as Record<string, unknown>;
      checkKeys(a, { preset: "string", command: "strings", model: "string" }, where, problems);
      if (typeof a.preset === "string" && !PRESETS[a.preset]) problems.push(`${where}preset: unknown "${a.preset}" (built in: ${Object.keys(PRESETS).join(", ")})`);
      if (a.preset === undefined && a.command === undefined) problems.push(`${where}needs a "preset" or a "command"`);
      if (Array.isArray(a.command)) {
        if (a.command.length === 0) problems.push(`${where}command: must not be empty`);
        else if (/\{\{/.test(String(a.command[0]))) problems.push(`${where}command: the executable cannot be a placeholder`);
      }
    }
  } else if (agents !== undefined) problems.push("agents: expected an object");
  if (stages !== undefined && typeof stages === "object" && stages !== null && !Array.isArray(stages)) {
    for (const [stage, agent] of Object.entries(stages as Record<string, unknown>)) {
      if (stage.startsWith("_")) continue;
      if (!STAGE_KEYS.includes(stage)) problems.push(`stages.${stage}: unknown stage (allowed: ${STAGE_KEYS.join(", ")})`);
      else if (typeof agent !== "string" || !named.has(agent)) problems.push(`stages.${stage}: "${String(agent)}" is not an agent in config.agents`);
    }
  } else if (stages !== undefined) problems.push("stages: expected an object");
  return problems;
}

export class ConfigError extends Error {}

export async function loadConfig(targetRepoDir: string): Promise<FactoryConfig> {
  const path = `${targetRepoDir}/.factory/config.json`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigError(`${path} not found: run \`factory install ${targetRepoDir}\`, then copy config.example.json to config.json and fill it in`);
  }
  const raw = await file.json();
  const problems = configProblems(raw);
  if (problems.length > 0) throw new ConfigError(`${path} is invalid:\n  - ${problems.join("\n  - ")}`);
  const config = mergeConfig(raw as Partial<FactoryConfig>);
  if (!/^[^/\s]+\/[^/\s]+$/.test(config.repo)) {
    throw new ConfigError(`${path}: "repo" must be "owner/name", got ${JSON.stringify(config.repo)}`);
  }
  return config;
}
