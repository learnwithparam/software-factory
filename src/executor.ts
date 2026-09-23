// Runs one stage of the loop. "claude" spawns the real CLI; "replay" reads a
// recorded stream-json fixture with no model and no network — this is what
// `bun test` uses, per the plan's rule that `make check` needs neither.
//
// Invocation (verified against `claude --help` on this machine, 2026-09-23):
//   claude -p "/factory-<stage> <N>" --output-format stream-json --verbose
//     --permission-mode dontAsk --setting-sources project,local
//     --no-session-persistence --max-budget-usd <limit>
// All six flags exist as written in the plan; no corrections were needed.

export type StageName = "triage" | "plan" | "build" | "verify" | "pr";

export interface StageEvent {
  readonly kind: "tool_use" | "text" | "usage" | "result";
  readonly toolName?: string;
  readonly text?: string;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly costUsd?: number;
}

export interface StageRunOptions {
  readonly stage: StageName;
  readonly issue: number;
  readonly cwd: string;
  readonly maxBudgetUsd: number;
}

export interface StageRunResult {
  readonly events: StageEvent[];
  readonly toolCalls: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly exitCode: number;
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
    events.push({
      kind: "result",
      costUsd: parsed.total_cost_usd ?? parsed.cost_usd ?? 0,
      text: parsed.subtype,
    });
  }
  return events;
}

export function aggregateStageEvents(events: StageEvent[], exitCode: number): StageRunResult {
  let toolCalls = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;
  for (const e of events) {
    if (e.kind === "tool_use") toolCalls += 1;
    if (e.kind === "usage") {
      tokensIn += e.tokensIn ?? 0;
      tokensOut += e.tokensOut ?? 0;
    }
    if (e.kind === "result") costUsd = e.costUsd ?? costUsd;
  }
  return { events, toolCalls, tokensIn, tokensOut, costUsd, exitCode };
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
    "--setting-sources",
    "project,local",
    "--no-session-persistence",
    "--max-budget-usd",
    String(opts.maxBudgetUsd),
  ];
}

export class ClaudeExecutor implements Executor {
  async runStage(opts: StageRunOptions): Promise<StageRunResult> {
    const proc = Bun.spawn(["claude", ...claudeArgs(opts)], {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const events: StageEvent[] = [];
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) events.push(...parseStreamJsonLine(line));
    }
    if (buffer.trim()) events.push(...parseStreamJsonLine(buffer));
    const exitCode = await proc.exited;
    return aggregateStageEvents(events, exitCode);
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
