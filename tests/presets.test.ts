// Argv and event-shape pins for the presets added in v2.6, plus the per-provider env allow-list.
import { describe, expect, test } from "bun:test";
import { PROVIDER_KEYS, sanitizeEnv } from "../src/agents/env";
import { PRESETS } from "../src/agents/presets";
import type { StageName } from "../src/executor";

const opts = (stage: StageName) => ({ stage, issue: 7, cwd: "/work", maxBudgetUsd: 5 });
const argv = (name: string, stage: StageName, model?: string) => PRESETS[name]!.command(opts(stage), { preset: name, model }, "PROMPT").argv;

describe("preset argv", () => {
  test("gemini: plan mode for read-only stages, yolo for write stages, prompt on stdin", () => {
    expect(argv("gemini", "plan")).toEqual(["gemini", "-o", "stream-json", "--approval-mode", "plan", "-p", ""]);
    expect(argv("gemini", "build", "gemini-3-pro")).toEqual(["gemini", "-o", "stream-json", "--approval-mode", "yolo", "-m", "gemini-3-pro", "-p", ""]);
    expect(PRESETS.gemini!.command(opts("plan"), { preset: "gemini" }, "PROMPT").stdin).toBe("PROMPT");
  });
  test("pi: read-only tool allow-list except on write stages", () => {
    expect(argv("pi", "verify")).toEqual(["pi", "-p", "--mode", "json", "--no-session", "--tools", "read,grep,find,ls"]);
    expect(argv("pi", "build")).toEqual(["pi", "-p", "--mode", "json", "--no-session"]);
  });
  test("opencode: json events, auto-approve, run in the worktree", () => {
    expect(argv("opencode", "build", "anthropic/claude-sonnet-5")).toEqual(["opencode", "run", "--format", "json", "--auto", "--dir", "/work", "-m", "anthropic/claude-sonnet-5"]);
  });
  test("cursor: plan mode when read-only, the prompt is the last argument", () => {
    expect(argv("cursor", "triage")).toEqual(["cursor-agent", "-p", "--output-format", "stream-json", "--force", "--workspace", "/work", "--mode", "plan", "PROMPT"]);
    expect(argv("cursor", "build").includes("--mode")).toBe(false);
  });
  test("mastracode: jsonl, plan mode when read-only, timeout in seconds", () => {
    const p = PRESETS.mastracode!.command({ ...opts("plan"), timeoutMinutes: 3 }, { preset: "mastracode" }, "PROMPT");
    expect(p.argv).toEqual(["mastracode", "--permission-mode", "auto", "-o", "jsonl", "--mode", "plan", "--timeout", "180"]);
    expect(argv("mastracode", "build")).toContain("build");
  });
});

describe("preset events", () => {
  const run = (name: string, lines: object[]) => {
    const parse = PRESETS[name]!.newParser?.() ?? PRESETS[name]!.parseLine;
    return lines.flatMap((l) => parse(JSON.stringify(l)));
  };
  test("gemini keeps only the text after the last tool call as the closing message", () => {
    const events = run("gemini", [
      { type: "message", role: "assistant", content: "thinking" },
      { type: "tool_use", tool_name: "read_file" },
      { type: "message", role: "assistant", content: "done" },
      { type: "result", status: "success", stats: { input_tokens: 10, output_tokens: 2, cached: 3 } },
    ]);
    expect(events.find((e) => e.finalText)?.finalText).toBe("done");
    expect(events.at(-1)).toMatchObject({ kind: "usage", tokensIn: 10, tokensOut: 2, tokensCached: 3, total: true });
  });
  test("a result with unreadable stats is 'not reported', never zero", () => {
    expect(run("gemini", [{ type: "result", stats: {} }])).toEqual([{ kind: "usage", invalid: true }]);
    expect(run("opencode", [{ type: "step_finish", part: { tokens: { input: -1, output: 2 } } }])).toEqual([{ kind: "usage", invalid: true }]);
  });
  test("pi sums cache reads and writes into tokensIn and reports reads as cached", () => {
    const events = run("pi", [{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }], usage: { input: 10, output: 2, cacheRead: 5, cacheWrite: 1 } } }]);
    expect(events.at(-1)).toMatchObject({ kind: "usage", tokensIn: 16, tokensOut: 2, tokensCached: 5 });
  });
  test("mastracode joins text deltas of the assistant message only", () => {
    const events = run("mastracode", [
      { type: "message_start", message: { id: "a", role: "assistant" } },
      { type: "message_update", id: "a", event: { type: "text-delta", delta: "he" } },
      { type: "message_update", id: "b", event: { type: "text-delta", delta: "NO" } },
      { type: "message_update", id: "a", event: { type: "text-delta", delta: "llo" } },
      { type: "message_end", id: "a" },
    ]);
    expect(events).toEqual([{ kind: "text", text: "hello", finalText: "hello" }]);
  });
  test("cursor names the tool from its tool_call key and reports no usage", () => {
    const events = run("cursor", [{ type: "tool_call", subtype: "started", tool_call: { readToolCall: {} } }, { type: "result", result: "done" }]);
    expect(events).toEqual([{ kind: "tool_use", toolName: "read" }, { kind: "text", text: "done", finalText: "done" }]);
  });
});

describe("per-provider env allow-list", () => {
  const all = Object.fromEntries(PROVIDER_KEYS.map((k) => [k, "secret"]));
  test("a stage keeps only its own provider keys", () => {
    const out = sanitizeEnv({ ...all, PATH: "/bin" }, PRESETS.codex!.envKeys);
    expect(Object.keys(out).sort()).toEqual(["OPENAI_API_KEY", "PATH"]);
  });
  test("an agent with no preset keeps every provider key", () => {
    expect(Object.keys(sanitizeEnv(all)).length).toBe(PROVIDER_KEYS.length);
  });
  test("every preset's envKeys are known provider keys", () => {
    for (const p of Object.values(PRESETS)) for (const k of p.envKeys) expect(PROVIDER_KEYS as readonly string[]).toContain(k);
  });
});
