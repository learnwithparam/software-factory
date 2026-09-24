// The factory knows no agent by name. An agent is config (a command, or a
// preset that fills one in) plus an optional line parser for the numbers.

import type { StageEvent, StageName, StageRunOptions } from "../executor";

export interface AgentConfig {
  // A built-in preset ("claude", "codex"); it supplies the command and parser.
  readonly preset?: string;
  // Any other CLI: argv with {{prompt}}, {{promptFile}} and {{model}} placeholders.
  // With no placeholder the prompt goes to stdin.
  readonly command?: readonly string[];
  readonly model?: string;
}

// stages.default is the agent for every stage; a stage name overrides it.
export type StageAgents = Partial<Record<StageName | "default", string>>;

export interface StageInvocation {
  readonly argv: readonly string[];
  readonly stdin?: string;
}

export interface AgentPreset {
  readonly name: string;
  // The binary `factory doctor` looks for.
  readonly binary: string;
  // Builds argv and stdin. `prompt` is the rendered stage prompt.
  command(opts: StageRunOptions, agent: AgentConfig, prompt: string): StageInvocation;
  parseLine(line: string): StageEvent[];
  // True for a line (or its first bytes) that would have been the terminal usage event.
  isUsageCandidate(line: string): boolean;
  // Claude runs the repo's `/factory-<stage>` skill itself; others get the skill body inlined.
  readonly ownsPrompt?: boolean;
}

// Where the runner tells the agent to put its files.
export const ARTIFACT_ENV = ["FACTORY_ARTIFACT_DIR", "FACTORY_ISSUE", "FACTORY_STAGE", "FACTORY_SCRATCH_DIR"] as const;
