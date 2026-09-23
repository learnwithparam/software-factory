// Shape of the target repo's `.factory/config.json`. Built by the repo-specific
// side (splitbill) or by whoever installs this template elsewhere; the runner
// only reads it, and `factory doctor` checks it exists. Missing fields fall
// back to DEFAULT_CONFIG so a minimal config.json still works.

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
};

export function mergeConfig(partial: Partial<FactoryConfig>): FactoryConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    riskPolicy: { ...DEFAULT_CONFIG.riskPolicy, ...partial.riskPolicy },
    maxBudgetUsd: { ...DEFAULT_CONFIG.maxBudgetUsd, ...partial.maxBudgetUsd },
    agentCommands: { ...DEFAULT_CONFIG.agentCommands, ...partial.agentCommands },
  };
}

export async function loadConfig(targetRepoDir: string): Promise<FactoryConfig> {
  const path = `${targetRepoDir}/.factory/config.json`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`${path} not found: run \`factory install ${targetRepoDir}\`, then copy config.example.json to config.json and fill it in`);
  }
  const config = mergeConfig((await file.json()) as Partial<FactoryConfig>);
  if (!/^[^/\s]+\/[^/\s]+$/.test(config.repo)) {
    throw new Error(`${path}: "repo" must be "owner/name", got ${JSON.stringify(config.repo)}`);
  }
  return config;
}
