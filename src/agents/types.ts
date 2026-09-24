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
  // Pass the reply schema to the CLI (Codex --output-schema). Off until a live run confirms the CLI accepts it.
  readonly outputSchema?: boolean;
}

// stages.default is the agent for every stage; a stage name overrides it.
export type StageAgents = Partial<Record<StageName | "default", string>>;

// What a stage may do to the worktree. Triage, plan and verify only read;
// build writes code, and pr writes the PR body and pr.json.
export interface StagePolicy {
  readonly write: boolean;
}

export function stagePolicy(stage: StageName): StagePolicy {
  return { write: stage === "build" || stage === "pr" };
}

// Extra things the executor hands a preset for one stage.
export interface StageContext {
  // A JSON Schema file for the agent's final message (only when opted in).
  readonly schemaFile?: string;
}

export interface StageInvocation {
  readonly argv: readonly string[];
  readonly stdin?: string;
}

export interface AgentPreset {
  readonly name: string;
  // The binary `factory doctor` looks for.
  readonly binary: string;
  // Builds argv and stdin. `prompt` is the rendered stage prompt.
  command(opts: StageRunOptions, agent: AgentConfig, prompt: string, ctx?: StageContext): StageInvocation;
  // True when a read-only stage cannot write its files: the agent returns them
  // as its final message and the runner writes them (see reply.ts).
  readonly returnsArtifact?: boolean;
  parseLine(line: string): StageEvent[];
  // True for a line (or its first bytes) that would have been the terminal usage event.
  isUsageCandidate(line: string): boolean;
  // Claude runs the repo's `/factory-<stage>` skill itself; others get the skill body inlined.
  readonly ownsPrompt?: boolean;
}

// Where the runner tells the agent to put its files.
export const ARTIFACT_ENV = ["FACTORY_ARTIFACT_DIR", "FACTORY_ISSUE", "FACTORY_STAGE", "FACTORY_SCRATCH_DIR"] as const;
