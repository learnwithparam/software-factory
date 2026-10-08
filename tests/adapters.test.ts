// Every adapter directory registers here and runs its port's contract suite,
// so a new runtime or SCM can't land without proving it behaves like the rest.

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "bun:test";
import { DockerExecution } from "../src/adapters/docker/execution";
import { LocalExecution } from "../src/adapters/local/execution";
import { LwprExecution } from "../src/adapters/lwpr/execution";
import { SshExecution } from "../src/adapters/ssh/execution";
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

// Remote runtimes run their real argv against stand-ins on PATH (tests/fixtures/runtimes), which
// behave like the real tools where it matters: lwpr merges streams and runs on a copy.
function onFakePath(run: () => void): () => void {
  return () =>
    describe("with stand-in tools", () => {
      const saved = process.env.PATH;
      beforeAll(() => (process.env.PATH = `${join(import.meta.dir, "fixtures", "runtimes")}:${saved}`));
      afterAll(() => (process.env.PATH = saved));
      run();
    });
}

const REGISTRY: Record<string, () => void> = {
  local: () => executionContract("local", () => new LocalExecution()),
  docker: onFakePath(() => executionContract("docker", () => new DockerExecution({ kind: "docker", image: "img" }))),
  lwpr: onFakePath(() => executionContract("lwpr", () => new LwprExecution())),
  ssh: onFakePath(() => executionContract("ssh", () => new SshExecution({ kind: "ssh", host: "box", dir: join(tmpdir(), `factory-ssh-${process.pid}`) }))),
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
