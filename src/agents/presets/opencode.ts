// OpenCode: `opencode run --format json --auto --dir <cwd>` with the prompt on stdin.
// Events are `{type, part}`: `tool_use` parts name the tool, `step_finish` parts carry
// `tokens {input, output, cache {read, write}}`. `run` has no read-only mode, so every
// stage writes its own files and the safety layers are the stage prompt and the gate.

import type { StageEvent } from "../../executor";
import type { AgentPreset } from "../types";
import { isUsageResultCandidate } from "../usage";

interface OpenCodeLine {
  type?: string;
  part?: {
    text?: string;
    tool?: string;
    tokens?: { input?: unknown; output?: unknown; cache?: { read?: unknown; write?: unknown } };
  };
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function parseOpenCodeLine(line: string): StageEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let parsed: OpenCodeLine;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return isUsageResultCandidate(trimmed, "step_finish") ? [{ kind: "usage", invalid: true }] : [];
  }
  const part = parsed.part;
  if (parsed.type === "text" && part?.text) return [{ kind: "text", text: part.text, finalText: part.text }];
  if (parsed.type === "tool_use") return [{ kind: "tool_use", toolName: part?.tool ?? "tool" }];
  if (parsed.type === "step_finish") {
    const input = count(part?.tokens?.input);
    const output = count(part?.tokens?.output);
    const read = count(part?.tokens?.cache?.read ?? 0);
    const write = count(part?.tokens?.cache?.write ?? 0);
    if (input === null || output === null || read === null || write === null) return [{ kind: "usage", invalid: true }];
    return [{ kind: "usage", tokensIn: input + read + write, tokensOut: output, tokensCached: read }];
  }
  return [];
}

export const opencodePreset: AgentPreset = {
  name: "opencode",
  binary: "opencode",
  verified: false,
  version: "1.18.32",
  envKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "XAI_API_KEY", "DEEPSEEK_API_KEY"],
  readOnlyBy: "nothing: `run` has no read-only mode, so only the stage prompt and the gate hold",
  skillsDir: ".opencode/skills",
  contextFile: "AGENTS.md",
  command: (opts, agent, prompt) => ({
    argv: ["opencode", "run", "--format", "json", "--auto", "--dir", opts.cwd, ...(agent.model ? ["-m", agent.model] : [])],
    stdin: prompt,
  }),
  parseLine: parseOpenCodeLine,
  isUsageCandidate: () => false,
};
