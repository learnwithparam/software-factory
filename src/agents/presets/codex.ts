// Ported from owainlewis/machinist@3943516 internal/runner/codex_usage.go:508-560 (MIT, Copyright (c) 2026 Owain Lewis). Deviations: input and output tokens are kept apart (machinist sums them); tool calls are counted from item.completed command, file and MCP items, which machinist does not need.
// Codex CLI: `codex exec --json -s workspace-write -` with the prompt on stdin.
// Read-only is not usable here because every stage writes its artifacts; the
// runner's protected-path diff and gates are the backstop.

import type { StageEvent } from "../../executor";
import type { AgentPreset } from "../types";
import { isUsageResultCandidate, readUsage } from "../usage";

interface CodexLine {
  type?: string;
  usage?: unknown;
  item?: { type?: string; text?: string; command?: string };
}

const TOOL_ITEMS = new Set(["command_execution", "file_change", "mcp_tool_call", "web_search"]);

export function parseCodexLine(line: string): StageEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let parsed: CodexLine;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return isUsageResultCandidate(trimmed, "turn.completed") ? [{ kind: "usage", invalid: true }] : [];
  }
  const item = parsed.item;
  if (parsed.type === "item.completed" && item) {
    if (item.type === "agent_message" && item.text) return [{ kind: "text", text: item.text, finalText: item.text }];
    if (item.type && TOOL_ITEMS.has(item.type)) return [{ kind: "tool_use", toolName: item.type === "command_execution" ? "Bash" : item.type }];
    return [];
  }
  if (parsed.type === "turn.completed") {
    const usage = readUsage(parsed.usage, false);
    return [usage ? { kind: "usage", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, tokensCached: usage.tokensCached, total: true } : { kind: "usage", invalid: true }];
  }
  return [];
}

export const codexPreset: AgentPreset = {
  name: "codex",
  binary: "codex",
  command: (_opts, agent, prompt) => ({
    argv: ["codex", "exec", "--json", "-s", "workspace-write", ...(agent.model ? ["-m", agent.model] : []), "-"],
    stdin: prompt,
  }),
  parseLine: parseCodexLine,
  isUsageCandidate: (line) => isUsageResultCandidate(line, "turn.completed"),
};
