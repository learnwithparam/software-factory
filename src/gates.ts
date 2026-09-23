// The runner is the only thing that decides a build is green — the agent's
// own build.json claim is informative, never authoritative (audit finding
// #11: "the writer doesn't grade its own work"). This runs the target's own
// `.factory/gates.sh` directly and parses the one line it's contracted to
// print: `FACTORY_GATES: status=... passed=N failed=N skipped=N failed_gates=a,b`.

export interface GateResult {
  readonly status: "GREEN" | "RED" | "MISCONFIGURED";
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failedGates: string[];
  readonly raw: string;
}

const LINE_RE = /FACTORY_GATES:\s*status=(\w+)\s+passed=(\d+)\s+failed=(\d+)\s+skipped=(\d+)\s+failed_gates=(\S*)/;

export function parseGateLine(output: string): GateResult | undefined {
  const match = output.match(LINE_RE);
  if (!match) return undefined;
  const [, status, passed, failed, skipped, failedGates] = match as unknown as [string, string, string, string, string, string];
  return {
    status: status.toUpperCase() as GateResult["status"],
    passed: Number(passed),
    failed: Number(failed),
    skipped: Number(skipped),
    failedGates: failedGates && failedGates !== "-" ? failedGates.split(",").filter(Boolean) : [],
    raw: match[0],
  };
}

export interface GateRunner {
  run(worktreeDir: string): Promise<{ stdout: string; stderr: string; code: number }>;
}

export class ShellGateRunner implements GateRunner {
  async run(worktreeDir: string): Promise<{ stdout: string; stderr: string; code: number }> {
    const proc = Bun.spawn(["bash", ".factory/gates.sh"], { cwd: worktreeDir, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  }
}

export async function runGates(gateRunner: GateRunner, worktreeDir: string): Promise<GateResult> {
  const result = await gateRunner.run(worktreeDir);
  const combined = `${result.stdout}\n${result.stderr}`;
  const parsed = parseGateLine(combined);
  if (parsed) return parsed;
  return {
    status: "MISCONFIGURED",
    passed: 0,
    failed: 0,
    skipped: 0,
    failedGates: ["gates.sh produced no FACTORY_GATES line"],
    raw: combined.slice(-2000),
  };
}
