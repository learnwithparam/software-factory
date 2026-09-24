import type { AgentCommands } from "./config";
import type { StageName } from "./executor";

// Passed to `claude --settings`, which is not gated by workspace trust (the
// repo's own .claude/settings.json allow list is ignored under `-p`). Deny
// rules and the guard hook stay in the repo's settings and still apply.
const READ_ONLY_BASH = [
  "Bash(git status *)",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git show *)",
  "Bash(git rev-parse *)",
  "Bash(git worktree list)",
  "Bash(cat *)",
  "Bash(ls *)",
  "Bash(grep *)",
  "Bash(find *)",
  "Bash(mkdir -p *)",
  "Bash(echo *)",
  "Bash(head *)",
  "Bash(tail *)",
  "Bash(wc *)",
  "Bash(diff *)",
  "Bash(pwd)",
];

const BUILD_EXTRA = [
  "Edit(**)",
  "Bash(git add *)",
  "Bash(git commit *)",
  "Bash(.factory/gates.sh*)",
  "Bash(bash .factory/gates.sh*)",
];

// The verifier reverts the non-test hunks to prove the new test fails without
// them, then restores; the repo's deny list still blocks reset --hard and push.
const VERIFY_EXTRA = ["Bash(git stash *)", "Bash(git checkout *)", "Bash(git restore *)"];

// Allow rules match one simple command each; a compound or brace-expanded
// one (`cat a/{b,c} && ls`) is refused whole, so steer the agent off them.
export const STAGE_GUIDANCE =
  "Read files with the Read tool, one call per file. Run shell commands one at a time: no &&, ;, pipes or brace expansion.";

const bash = (patterns: readonly string[]): string[] => patterns.map((p) => `Bash(${p})`);

// The repo's own commands (its test runner, its make targets) come from
// config.agentCommands, so nothing here assumes bun or make.
export function stageAllowRules(stage: StageName, issue: number, extra?: AgentCommands): string[] {
  const rules = [`Edit(.factory/runs/issue-${issue}/**)`, ...READ_ONLY_BASH, ...bash(extra?.read ?? [])];
  if (stage === "build") return [...rules, ...BUILD_EXTRA, ...bash(extra?.build ?? [])];
  if (stage === "verify") return [...rules, ...VERIFY_EXTRA, ...bash(extra?.verify ?? [])];
  return rules;
}

export function stageSettings(stage: StageName, issue: number, extra?: AgentCommands): string {
  return JSON.stringify({ permissions: { allow: stageAllowRules(stage, issue, extra) } });
}
