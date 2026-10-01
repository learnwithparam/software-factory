// The stage contract: types, result aggregation and the replay executor that
// `bun test` uses (no model, no network). Real agents run through
// src/agents/executor.ts; the Claude and Codex line parsers live in
// src/agents/presets/.

import type { AgentCommands } from "./config";
import { truncateFinalMessage } from "./agents/final-message";
import { parseStreamJsonLine } from "./agents/presets/claude";

export type StageName = "triage" | "plan" | "build" | "verify" | "pr" | "retro";

export interface StageEvent {
  readonly kind: "tool_use" | "text" | "usage" | "result" | "truncated" | "session";
  readonly toolName?: string;
  readonly text?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly tokensCached?: number;
  // On "usage" events: `total` means these are the run's final totals (replace
  // what was summed); `invalid` means the terminal event was unreadable, so
  // tokens are "not reported".
  readonly total?: boolean;
  readonly invalid?: boolean;
  readonly costUsd?: number;
  // On "result" events: tool calls the permission system refused, as "Tool path".
  readonly denials?: string[];
  // The agent's own closing message (Claude `result.result`, Codex `agent_message`).
  readonly finalText?: string;
  // On "session" events: the id `claude --resume` takes (factory takeover).
  readonly sessionId?: string;
}

export interface StageRunOptions {
  readonly stage: StageName;
  readonly issue: number;
  readonly cwd: string;
  readonly maxBudgetUsd: number;
  readonly timeoutMinutes?: number;
  readonly maxToolCalls?: number;
  readonly agentCommands?: AgentCommands;
  // The agent name from config; recorded in stage_runs. Unset means "claude".
  readonly agent?: string;
  // The issue's type label (e.g. "docs", or a repo-added type like "content"),
  // read from its GitHub labels. Unset on triage, which runs before the type
  // is known and so never routes on it (plan v2.7.0 item 1).
  readonly type?: string;
  // Rendered events are appended here as they arrive (the live view and the
  // local recording), and the live file names the running process for takeover.
  readonly transcriptFile?: string;
  readonly liveFile?: string;
}

// The killedReason a `factory takeover` stop gets. watch.ts parks on it
// instead of counting it as a failure.
export const OPERATOR_TAKEOVER = "operator takeover";

export interface StageRunResult {
  readonly events: StageEvent[];
  readonly toolCalls: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensCached?: number;
  readonly costUsd: number;
  // True when the agent itself reported a cost; false means costFor decides.
  readonly costReported?: boolean;
  readonly exitCode: number;
  // Set when the runner killed the process itself (timeout or tool-call cap)
  // rather than letting it exit on its own — audit finding #15.
  readonly killedReason?: string;
  // The child's stderr, only set on a non-zero exit. `claude -p` prints its
  // launch-time errors (bad flag, auth, permission refusal) to stderr, not
  // stdout — before this, that stream was piped and never read, so a launch
  // failure surfaced as an empty result with no clue why.
  readonly stderrTail?: string;
  // Tool calls `claude` refused (from the result event's permission_denials).
  readonly permissionDenials: string[];
  // The agent's last message, capped at 16 KiB (machinist final_message.go).
  readonly finalMessage?: string;
  // False when an over-long event line or a missing parser meant tokens are
  // not a full count; the dashboard shows "Not reported" rather than zero.
  readonly usageComplete?: boolean;
  readonly agent?: string;
  readonly model?: string | null;
  // The agent's session, when its CLI reports one and keeps it resumable.
  readonly sessionId?: string;
}

export interface Executor {
  runStage(opts: StageRunOptions): Promise<StageRunResult>;
}

export function aggregateStageEvents(events: StageEvent[], exitCode: number, stderrTail?: string): StageRunResult {
  let toolCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  let costReported = false;
  let tokensCached = 0;
  const permissionDenials: string[] = [];
  let finalText: string | undefined;
  let sessionId: string | undefined;
  let final: { in: number; out: number; cached: number } | "invalid" | undefined;
  for (const e of events) {
    if (e.finalText !== undefined) finalText = e.finalText;
    if (e.sessionId !== undefined) sessionId = e.sessionId;
    if (e.kind === "tool_use") toolCalls += 1;
    if (e.kind === "usage") {
      if (e.invalid) final = "invalid";
      else if (e.total) final = { in: e.tokensIn ?? 0, out: e.tokensOut ?? 0, cached: e.tokensCached ?? 0 };
      else {
        tokensIn += e.tokensIn ?? 0;
        tokensOut += e.tokensOut ?? 0;
        tokensCached += e.tokensCached ?? 0;
      }
    }
    if (e.kind === "result") {
      if (e.costUsd !== undefined) {
        costUsd = e.costUsd;
        costReported = true;
      }
      permissionDenials.push(...(e.denials ?? []));
    }
  }
  if (final === "invalid") {
    tokensIn = 0;
    tokensOut = 0;
    tokensCached = 0;
  } else if (final) {
    tokensIn = final.in;
    tokensOut = final.out;
    tokensCached = final.cached;
  }
  const finalMessage = finalText === undefined ? undefined : truncateFinalMessage(finalText);
  const result = { events, toolCalls, tokensIn, tokensOut, tokensCached, costUsd, costReported, exitCode, permissionDenials, usageComplete: final !== "invalid", ...(finalMessage ? { finalMessage } : {}), ...(sessionId ? { sessionId } : {}) };
  return exitCode !== 0 && stderrTail ? { ...result, stderrTail } : result;
}

// Fixture-driven, deterministic, no network. Keyed by "<stage>:<issue>" -> an
// array of raw stream-json lines, exactly what a recorded `claude` run wrote.
export class ReplayExecutor implements Executor {
  constructor(private readonly fixtures: Record<string, string[]>) {}

  static fromLines(stage: StageName, issue: number, lines: string[]): ReplayExecutor {
    return new ReplayExecutor({ [`${stage}:${issue}`]: lines });
  }

  async runStage(opts: StageRunOptions): Promise<StageRunResult> {
    const key = `${opts.stage}:${opts.issue}`;
    const lines = this.fixtures[key];
    if (!lines) throw new Error(`replay: no fixture recorded for ${key}`);
    const events = lines.flatMap((l) => parseStreamJsonLine(l));
    return aggregateStageEvents(events, 0);
  }
}
