// The runner grades the build, not the agent (audit finding #11): this is
// what makes `FACTORY_GATES:` authoritative — the one line runGates trusts,
// parsed the same way whether it shows up on stdout, buried in noisier
// stderr output, or missing entirely (a misconfigured target's gates.sh).

import { describe, expect, test } from "bun:test";
import { parseGateLine, runGates, type GateRunner } from "../src/gates";

describe("parseGateLine", () => {
  test("parses a well-formed GREEN line", () => {
    const result = parseGateLine("some noise\nFACTORY_GATES: status=GREEN passed=12 failed=0 skipped=1 failed_gates=-\nmore noise");
    expect(result).toEqual({
      status: "GREEN",
      passed: 12,
      failed: 0,
      skipped: 1,
      failedGates: [],
      raw: "FACTORY_GATES: status=GREEN passed=12 failed=0 skipped=1 failed_gates=-",
    });
  });

  test("parses a RED line with named failed gates", () => {
    const result = parseGateLine("FACTORY_GATES: status=RED passed=8 failed=2 skipped=0 failed_gates=lint,typecheck");
    expect(result?.status).toBe("RED");
    expect(result?.failedGates).toEqual(["lint", "typecheck"]);
  });

  test("returns undefined when the line is missing entirely", () => {
    expect(parseGateLine("make check\nall good, no summary line printed")).toBeUndefined();
  });

  test("is case-insensitive on status but normalizes to uppercase", () => {
    const result = parseGateLine("FACTORY_GATES: status=green passed=1 failed=0 skipped=0 failed_gates=-");
    expect(result?.status).toBe("GREEN");
  });
});

class FixedGateRunner implements GateRunner {
  constructor(private readonly result: { stdout: string; stderr: string; code: number }) {}
  async run(_worktreeDir: string) {
    return this.result;
  }
}

describe("runGates", () => {
  test("returns the parsed result when gates.sh prints the line", async () => {
    const runner = new FixedGateRunner({
      stdout: "FACTORY_GATES: status=GREEN passed=5 failed=0 skipped=0 failed_gates=-",
      stderr: "",
      code: 0,
    });
    const result = await runGates(runner, "/tmp/whatever");
    expect(result.status).toBe("GREEN");
  });

  test("falls back to MISCONFIGURED, not GREEN, when no line is printed", async () => {
    const runner = new FixedGateRunner({ stdout: "gates.sh: command not found", stderr: "", code: 127 });
    const result = await runGates(runner, "/tmp/whatever");
    expect(result.status).toBe("MISCONFIGURED");
    expect(result.failedGates).toContain("gates.sh produced no FACTORY_GATES line");
  });

  test("reads the line from stderr too, not only stdout", async () => {
    const runner = new FixedGateRunner({
      stdout: "",
      stderr: "FACTORY_GATES: status=RED passed=3 failed=1 skipped=0 failed_gates=make-check",
      code: 1,
    });
    const result = await runGates(runner, "/tmp/whatever");
    expect(result.status).toBe("RED");
    expect(result.failedGates).toEqual(["make-check"]);
  });
});
