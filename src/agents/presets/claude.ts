// Claude Code: `claude -p /factory-<stage> N` with stream-json output. The argv
// is pinned byte for byte by tests/agents.test.ts; the repo's own skill is the
// prompt, so this preset ignores the rendered one.
// Flags checked against `claude --help` on 2026-09-23.

import type { StageEvent, StageRunOptions } from "../../executor";
import { STAGE_GUIDANCE, stageSettings } from "../../stage-permissions";
import type { AgentPreset } from "../types";
import { isUsageResultCandidate, readUsage } from "../usage";

// One line of Claude Code's --output-format stream-json. Only the fields this
// runner needs; the real stream carries more.
interface StreamJsonLine {
  type?: string;
  subtype?: string;
  result?: string;
  cost_usd?: number;
  total_cost_usd?: number;
  message?: {
    content?: Array<{ type: string; text?: string; name?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  usage?: unknown;
  permission_denials?: Array<{ tool_name?: string; tool_input?: { file_path?: string; command?: string } }>;
}

export function parseStreamJsonLine(line: string): StageEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let parsed: StreamJsonLine;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // A cut-off final result means the totals cannot be trusted.
    return isUsageResultCandidate(trimmed, "result") ? [{ kind: "usage", invalid: true }] : [];
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
    // Cumulative usage incl. cache tokens (machinist codex_usage.go); a result with no usage keeps the per-message sums.
    if (parsed.usage !== undefined) {
      const usage = readUsage(parsed.usage, true);
      events.push(usage ? { kind: "usage", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, total: true } : { kind: "usage", invalid: true });
    }
    events.push({
      kind: "result",
      costUsd: parsed.total_cost_usd ?? parsed.cost_usd ?? 0,
      text: parsed.subtype,
      ...(denials.length ? { denials } : {}),
      ...(parsed.result ? { finalText: parsed.result } : {}),
    });
  }
  return events;
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

export const claudePreset: AgentPreset = {
  name: "claude",
  binary: "claude",
  ownsPrompt: true,
  command: (opts, agent) => ({ argv: ["claude", ...claudeArgs(opts), ...(agent.model ? ["--model", agent.model] : [])] }),
  parseLine: parseStreamJsonLine,
  isUsageCandidate: (line) => isUsageResultCandidate(line, "result"),
};
