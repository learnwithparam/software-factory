// Ported from owainlewis/machinist@3943516 internal/runner/runner.go:190-240 (MIT, Copyright (c) 2026 Owain Lewis). Deviations: the process-group kill is process_unix.go, and TypeScript on Bun (`detached` is setsid); the event cap and 1 MiB line cap follow events.go and codex_usage.go; the tool-call cap and stderr tail are the factory's own (audit finding #15).
// The one executor: spawn any agent CLI, feed the prompt, watch its output
// through the preset's line parser, and kill the whole process group on a
// timeout or a runaway tool-call count.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDir } from "../artifacts";
import { aggregateStageEvents, type Executor, type StageEvent, type StageRunOptions, type StageRunResult } from "../executor";
import { sanitizeEnv } from "./env";
import { renderPrompt } from "./prompt";
import { PRESETS } from "./presets";
import { writeReply } from "./reply";
import { type AgentConfig, type AgentPreset, type StageAgents, stagePolicy } from "./types";

const DEFAULT_TIMEOUT_MINUTES = 15;
const STDERR_KEEP_BYTES = 64 * 1024;
export const MAX_EVENT_LINE_BYTES = 1 << 20;
export const MAX_RECORDED_OUTPUT_BYTES = 64 << 20;

export interface ResolvedAgent {
  readonly name: string;
  readonly config: AgentConfig;
  readonly preset?: AgentPreset;
}

export function resolveAgent(agents: Record<string, AgentConfig>, stages: StageAgents, stage: keyof StageAgents & string): ResolvedAgent {
  const name = stages[stage] ?? stages.default ?? "claude";
  const config = agents[name];
  if (!config) throw new Error(`stage ${stage} uses agent "${name}", which is not in config.agents`);
  const preset = config.preset ? PRESETS[config.preset] : undefined;
  if (config.preset && !preset) throw new Error(`agent "${name}": unknown preset "${config.preset}"`);
  return { name, config, preset };
}

// Placeholders in a config command. Anything else is passed through verbatim.
export function renderCommand(command: readonly string[], values: { prompt: string; promptFile: string; model: string }): { argv: string[]; usesStdin: boolean } {
  let usesStdin = true;
  const argv = command.map((part) =>
    part.replace(/\{\{(prompt|promptFile|model)\}\}/g, (_m, key: "prompt" | "promptFile" | "model") => {
      if (key !== "model") usesStdin = false;
      return values[key];
    }),
  );
  return { argv, usesStdin };
}

export class CommandExecutor implements Executor {
  constructor(
    private readonly agents: Record<string, AgentConfig>,
    private readonly stages: StageAgents,
  ) {}

  async runStage(opts: StageRunOptions): Promise<StageRunResult> {
    const agent = resolveAgent(this.agents, this.stages, opts.stage);
    const scratch = mkdtempSync(join(tmpdir(), `factory-scratch-${opts.issue}-`));
    try {
      return await this.spawnStage(opts, agent, scratch);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  private async spawnStage(opts: StageRunOptions, agent: ResolvedAgent, scratch: string): Promise<StageRunResult> {
    const artifactDir = join(opts.cwd, runDir(opts.issue));
    mkdirSync(artifactDir, { recursive: true });

    // A read-only stage on a preset that cannot write files returns them instead.
    const readOnly = !stagePolicy(opts.stage).write && agent.preset?.returnsArtifact === true && !agent.config.command;
    let argv: readonly string[];
    let stdin: string | undefined;
    if (agent.preset?.ownsPrompt) {
      ({ argv, stdin } = agent.preset.command(opts, agent.config, ""));
    } else {
      const prompt = await renderPrompt(opts, readOnly);
      if (agent.config.command) {
        const promptFile = join(scratch, "prompt.md");
        writeFileSync(promptFile, prompt);
        const rendered = renderCommand(agent.config.command, { prompt, promptFile, model: agent.config.model ?? "" });
        argv = rendered.argv;
        stdin = rendered.usesStdin ? prompt : undefined;
      } else if (agent.preset) {
        ({ argv, stdin } = agent.preset.command(opts, agent.config, prompt));
      } else {
        throw new Error(`agent "${agent.name}" has neither a preset nor a command`);
      }
    }

    const proc = Bun.spawn([...argv], {
      cwd: opts.cwd,
      stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
      detached: true, // its own process group, so a kill reaches the agent's children too
      env: {
        ...sanitizeEnv(process.env),
        FACTORY_ARTIFACT_DIR: artifactDir,
        FACTORY_ISSUE: String(opts.issue),
        FACTORY_STAGE: opts.stage,
        FACTORY_SCRATCH_DIR: scratch,
      },
    });
    let cancelRead: (() => void) | undefined;
    const killGroup = () => {
      // ESRCH means it already exited; that is the goal.
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        proc.kill();
      }
      // A descendant that left the group (setsid) can still hold the pipe open:
      // give the reader a moment to drain, then stop waiting for it.
      setTimeout(() => cancelRead?.(), 2000).unref();
    };
    const events: StageEvent[] = [];
    let toolCalls = 0;
    let killedReason: string | undefined;
    let usageComplete = agent.preset !== undefined;
    let recorded = 0;
    // Read alongside stdout, not after: an unread pipe can fill its OS buffer
    // and stall the child, and launch-time errors go to stderr only.
    const errReader = proc.stderr.getReader();
    const stderrPromise = (async () => {
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await errReader.read().catch(() => ({ done: true, value: undefined }));
        if (done) return text + dec.decode();
        text = (text + dec.decode(value, { stream: true })).slice(-STDERR_KEEP_BYTES);
      }
    })();

    const timeoutMinutes = opts.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
    const timer = setTimeout(() => {
      killedReason = `stage exceeded stageTimeoutMinutes=${timeoutMinutes}`;
      killGroup();
    }, timeoutMinutes * 60_000);

    const handle = (line: string) => {
      if (!agent.preset) return;
      if (Buffer.byteLength(line) > MAX_EVENT_LINE_BYTES) {
        // Dropped, not parsed; if it was the terminal usage event the count is gone.
        if (agent.preset.isUsageCandidate(line.slice(0, 4096))) usageComplete = false;
        return;
      }
      for (const e of agent.preset.parseLine(line)) {
        recorded += Buffer.byteLength(e.text ?? "");
        if (recorded > MAX_RECORDED_OUTPUT_BYTES) {
          if (events.at(-1)?.kind !== "truncated") events.push({ kind: "truncated", text: `recording stopped after ${MAX_RECORDED_OUTPUT_BYTES} output bytes; the agent keeps running` });
        } else events.push(e);
        if (e.kind !== "tool_use") continue;
        toolCalls += 1;
        if (opts.maxToolCalls && toolCalls > opts.maxToolCalls && !killedReason) {
          killedReason = `stage exceeded maxToolCalls=${opts.maxToolCalls}`;
          killGroup();
        }
      }
    };

    try {
      const reader = proc.stdout.getReader();
      cancelRead = () => {
        void reader.cancel().catch(() => {});
        void errReader.cancel().catch(() => {});
      };
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handle(line);
        // An unterminated line past the cap is dropped now, not buffered without bound.
        if (buffer.length > MAX_EVENT_LINE_BYTES) {
          if (agent.preset?.isUsageCandidate(buffer.slice(0, 4096))) usageComplete = false;
          buffer = "";
        }
      }
      if (buffer.trim()) handle(buffer);
    } finally {
      clearTimeout(timer);
    }

    const [exitCode, stderr] = await Promise.all([proc.exited, stderrPromise]);
    const stderrTail = stderr.trim().slice(-4000) || undefined;
    const base0 = aggregateStageEvents(events, exitCode, stderrTail);
    const base = { ...base0, agent: agent.name, model: agent.config.model ?? null, usageComplete: usageComplete && base0.usageComplete !== false };
    if (readOnly && exitCode === 0 && !killedReason) {
      const problem = await writeReply(opts.cwd, opts.issue, opts.stage, base.finalMessage);
      // No file is left behind, so the runner reports "no valid <stage>.json".
      if (problem) base.events.push({ kind: "text", text: `read-only reply rejected: ${problem}` });
    }
    return killedReason ? { ...base, exitCode: exitCode || 1, killedReason } : base;
  }
}
