import { expect, test } from "bun:test";
import type { Finding } from "../src/artifacts";
import type { CommandResult, CommandRunner } from "../src/github";
import { ClaudeRechecker, hasBlocking, keepSupported, recheckPrompt } from "../src/recheck";

const f = (severity: Finding["severity"], what: string, confidence = 4): Finding => ({ severity, confidence, what });

test("keepSupported drops only unsupported must/should findings and ignores bad indexes", () => {
  const all: (string | Finding)[] = ["plain note", f("must", "a"), f("could", "nit"), f("should", "b")];
  const { kept, dropped } = keepSupported(all, [1, 99, -1, 1.5]);
  expect(dropped.map((d) => d.what)).toEqual(["a"]);
  expect(kept).toEqual(["plain note", all[2]!, all[3]!]);
});

test("hasBlocking needs a must/should finding at blocking confidence", () => {
  expect(hasBlocking([f("must", "x", 2), f("could", "y", 5), "s"])).toBe(false);
  expect(hasBlocking([f("should", "x", 3)])).toBe(true);
});

test("the prompt carries indexed findings and the diff, and truncates a huge diff", () => {
  const p = recheckPrompt([f("must", "a")], "D".repeat(300_000));
  expect(p).toContain('"index":0');
  expect(p.length).toBeLessThan(210_000);
});

class Runner implements CommandRunner {
  args: string[] = [];
  constructor(private readonly result: CommandResult | Error) {}
  async run(args: string[]): Promise<CommandResult> {
    this.args = args;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}
const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", code: 0 });

test("ClaudeRechecker runs with every tool off and returns the supported indexes", async () => {
  const runner = new Runner(ok(JSON.stringify({ structured_output: { supported: [0] } })));
  expect(await new ClaudeRechecker(runner, "/x").supported([f("must", "a")], "diff")).toEqual([0]);
  expect(runner.args[runner.args.indexOf("--tools") + 1]).toBe("");
  expect(runner.args).toContain("--json-schema");
});

test("any failure means the check could not run, so no finding is dropped", async () => {
  for (const r of [new Error("boom"), { stdout: "", stderr: "x", code: 1 }, ok("not json"), ok(JSON.stringify({ structured_output: { supported: ["a"] } })), ok("{}")]) {
    expect(await new ClaudeRechecker(new Runner(r), "/x").supported([f("must", "a")], "d")).toBeUndefined();
  }
});
