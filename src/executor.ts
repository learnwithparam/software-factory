// Runs one stage of the loop. "claude" spawns the real CLI; "replay" reads a
// recorded stream-json fixture with no model and no network — this is what
// `bun test` uses, per the plan's rule that `make check` needs neither.
//
// Invocation (verified against `claude --help` on this machine, 2026-09-23):
//   claude -p "/factory-<stage> <N>" --output-format stream-json --verbose
//     --permission-mode dontAsk --setting-sources project,local
//     --no-session-persistence --max-budget-usd <limit>
// All six flags exist as written in the plan; no corrections were needed.

import type { AgentCommands } from "./config";
import { STAGE_GUIDANCE, stageSettings } from "./stage-permissions";

export type StageName = "triage" | "plan" | "build" | "verify" | "pr";

export interface StageEvent {
  readonly kind: "tool_use" | "text" | "usage" | "result";
  readonly toolName?: string;
  readonly text?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly costUsd?: number;
  // On "result" events: tool calls the permission system refused, as "Tool path".
  readonly denials?: string[];
}

export interface StageRunOptions {
  readonly stage: StageName;
  readonly issue: number;
  readonly cwd: string;
  readonly maxBudgetUsd: number;
  readonly timeoutMinutes?: number;
  readonly maxToolCalls?: number;
  readonly agentCommands?: AgentCommands;
}

export interface StageRunResult {
  readonly events: StageEvent[];
  readonly toolCalls: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
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
}

export interface Executor {
  runStage(opts: StageRunOptions): Promise<StageRunResult>;
}

// One line of Claude Code's --output-format stream-json. Only the fields this
// runner needs; the real stream carries more.
interface StreamJsonLine {
  type?: string;
  subtype?: string;
  cost_usd?: number;
  total_cost_usd?: number;
  message?: {
    content?: Array<{ type: string; text?: string; name?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  usage?: { input_tokens?: number; output_tokens?: number };
  permission_denials?: Array<{ tool_name?: string; tool_input?: { file_path?: string; command?: string } }>;
}

export function parseStreamJsonLine(line: string): StageEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let parsed: StreamJsonLine;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const events: StageEvent[] = [];

  if (parsed.type === "assistant" && parsed.message?.content) {
    for (const block of parsed.message.content) {
      if (block.type === "text" && block.text) {
        events.push({ kind: "text", text: block.text });
      } else if (block.type === "tool_use" && block.name) {
        events.push({ kind: "tool_use", toolName: block.name });
      }
    }
    if (parsed.message.usage) {
      events.push({
        kind: "usage",
        tokensIn: parsed.message.usage.input_tokens ?? 0,
        tokensOut: parsed.message.usage.output_tokens ?? 0,
      });
    }
  } else if (parsed.type === "result") {
    const denials = (parsed.permission_denials ?? []).map(
      (d) => `${d.tool_name ?? "tool"} ${d.tool_input?.file_path ?? d.tool_input?.command ?? ""}`.trim(),
    );
    events.push({
      kind: "result",
      costUsd: parsed.total_cost_usd ?? parsed.cost_usd ?? 0,
      text: parsed.subtype,
      ...(denials.length ? { denials } : {}),
    });
  }
  return events;
}

export function aggregateStageEvents(events: StageEvent[], exitCode: number, stderrTail?: string): StageRunResult {
  let toolCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  const permissionDenials: string[] = [];
  for (const e of events) {
    if (e.kind === "tool_use") toolCalls += 1;
    if (e.kind === "usage") {
      tokensIn += e.tokensIn ?? 0;
      tokensOut += e.tokensOut ?? 0;
    }
    if (e.kind === "result") {
      costUsd = e.costUsd ?? costUsd;
      permissionDenials.push(...(e.denials ?? []));
    }
  }
  const result = { events, toolCalls, tokensIn, tokensOut, costUsd, exitCode, permissionDenials };
  return exitCode !== 0 && stderrTail ? { ...result, stderrTail } : result;
}

export function claudeArgs(opts: StageRunOptions): string[] {
  return [
    "-p",
    `/factory-${opts.stage} ${opts.issue}`,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--setting-sources",
    "project,local",
    "--settings",
    stageSettings(opts.stage, opts.issue, opts.agentCommands),
    "--append-system-prompt",
    STAGE_GUIDANCE,
    "--no-session-persistence",
    "--max-budget-usd",
    String(opts.maxBudgetUsd),
  ];
}

// Strips the runner's own secrets from the environment the agent process
// inherits: the target repo's `GH_TOKEN` would otherwise let a rogue `Bash`
// call push or merge over the guard hook's head, and `FACTORY_*` leaks the
// dashboard token and DB path (audit finding #14). Everything else (PATH,
// HOME, ANTHROPIC_API_KEY, ...) passes through — the agent still needs a
// model key, so the residual risk (a spend-capped key, documented in the
// README) is deliberate, not an oversight.
const STRIPPED_ENV_PREFIXES = ["GH_TOKEN", "GITHUB_TOKEN", "FACTORY_"];

export function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (STRIPPED_ENV_PREFIXES.some((p) => key === p || key.startsWith(p))) continue;
    out[key] = value;
  }
  return out;
}

const DEFAULT_TIMEOUT_MINUTES = 15;

export class ClaudeExecutor implements Executor {
  async runStage(opts: StageRunOptions): Promise<StageRunResult> {
    const proc = Bun.spawn(["claude", ...claudeArgs(opts)], {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: sanitizeEnv(process.env),
    });
    const events: StageEvent[] = [];
    let toolCalls = 0;
    let killedReason: string | undefined;
    // Read alongside stdout, not after: an unread pipe can otherwise fill its
    // OS buffer and stall the child, and any launch-time error (bad flag,
    // auth, a permission refusal) `claude` prints only goes to stderr.
    const stderrPromise = new Response(proc.stderr).text();

    const timeoutMinutes = opts.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
    const timer = setTimeout(() => {
      killedReason = `stage exceeded stageTimeoutMinutes=${timeoutMinutes}`;
      proc.kill();
    }, timeoutMinutes * 60_000);

    try {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const parsed = parseStreamJsonLine(line);
          events.push(...parsed);
          for (const e of parsed) {
            if (e.kind !== "tool_use") continue;
            toolCalls += 1;
            if (opts.maxToolCalls && toolCalls > opts.maxToolCalls && !killedReason) {
              killedReason = `stage exceeded maxToolCalls=${opts.maxToolCalls}`;
              proc.kill();
            }
          }
        }
      }
      if (buffer.trim()) events.push(...parseStreamJsonLine(buffer));
    } finally {
      clearTimeout(timer);
    }

    const [exitCode, stderr] = await Promise.all([proc.exited, stderrPromise]);
    const stderrTail = stderr.trim().slice(-4000) || undefined;
    const result = aggregateStageEvents(events, exitCode, stderrTail);
    return killedReason ? { ...result, exitCode: exitCode || 1, killedReason } : result;
  }
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
    const events = lines.flatMap(parseStreamJsonLine);
    return aggregateStageEvents(events, 0);
  }
}
