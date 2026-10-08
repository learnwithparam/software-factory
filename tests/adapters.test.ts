// Every adapter directory registers here and runs its port's contract suite,
// so a new runtime or SCM can't land without proving it behaves like the rest.

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { LocalExecution } from "../src/adapters/local/execution";
import type { ExecResult, ExecutionPort } from "../src/ports/execution";
import { executionContract } from "./ports/execution.contract";

// A fake that obeys the contract by running through bash too: what a test
// double of a remote runtime looks like when it is held to the same suite.
class RecordingExecution implements ExecutionPort {
  readonly ran: string[] = [];
  async run(cmd: string, cwd: string): Promise<ExecResult> {
    this.ran.push(cmd);
    return new LocalExecution().run(cmd, cwd);
  }
}

const REGISTRY: Record<string, () => void> = {
  local: () => executionContract("local", () => new LocalExecution()),
};

describe("adapters", () => {
  test("every directory under src/adapters is registered", () => {
    const dirs = readdirSync(join(import.meta.dir, "..", "src", "adapters"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(Object.keys(REGISTRY).sort());
  });

  for (const run of Object.values(REGISTRY)) run();
  executionContract("recording fake", () => new RecordingExecution());
});
