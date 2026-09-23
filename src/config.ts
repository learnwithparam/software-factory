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
};

export function mergeConfig(partial: Partial<FactoryConfig>): FactoryConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    riskPolicy: { ...DEFAULT_CONFIG.riskPolicy, ...partial.riskPolicy },
    maxBudgetUsd: { ...DEFAULT_CONFIG.maxBudgetUsd, ...partial.maxBudgetUsd },
  };
}

export async function loadConfig(targetRepoDir: string): Promise<FactoryConfig> {
  const path = `${targetRepoDir}/.factory/config.json`;
  const file = Bun.file(path);
  if (!(await file.exists())) return DEFAULT_CONFIG;
  const raw = (await file.json()) as Partial<FactoryConfig>;
  return mergeConfig(raw);
}
