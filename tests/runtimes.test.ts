// Runtimes: where a gate or check command runs. The adapters' behaviour is the
// contract suite in tests/adapters.test.ts; this pins their argv, the frame
// that carries streams through a merged log, and how names are resolved.

import { describe, expect, test } from "bun:test";
import { containerArgs } from "../src/adapters/docker/execution";
import { lwprArgs } from "../src/adapters/lwpr/execution";
import { sshArgs } from "../src/adapters/ssh/execution";
import { configProblems } from "../src/config";
import { framed, shq, unframe } from "../src/core/frame";
import { parseWorkflowText } from "../src/engine/workflows";
import { loadMachineConfig } from "../src/machine";
import { BUILTIN_RUNTIMES, runtimeProblems, runtimeRefs, runtimesFrom, unknownRuntimes } from "../src/runtimes";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("frame", () => {
  test("carries stdout, stderr and the code through one merged, noisy log", () => {
    const p = Bun.spawnSync(["bash", "-c", `echo "[runtime] start"; bash -c ${shq(framed("echo out; echo err >&2; printf 'x'; exit 4"))} 2>&1; echo "[runtime] end"`]);
    expect(p.exitCode).toBe(0);
    expect(unframe(p.stdout.toString(), p.exitCode)).toEqual({ stdout: "out\nx", stderr: "err\n", code: 4 });
  });
  test("no frame means the runtime failed before the command: its output is the error", () => {
    expect(unframe("box unreachable\n", 255)).toEqual({ stdout: "", stderr: "box unreachable\n", code: 255 });
    expect(unframe("", 0).code).toBe(1);
  });
});

describe("argv", () => {
  test("docker: read-only, no capabilities, no new privileges, no network, capped, as this user", () => {
    expect(containerArgs({ kind: "docker", image: "oven/bun:1.3" }, "make test", "/w", "501:20")).toEqual([
      "docker", "run", "--rm", "--read-only", "--tmpfs", "/tmp:rw,exec,size=1g", "--cap-drop=ALL", "--security-opt", "no-new-privileges",
      "--network", "none", "--memory", "4g", "--cpus", "2", "--pids-limit", "512", "--user", "501:20", "-e", "HOME=/tmp",
      "-v", "/w:/w", "-w", "/w", "oven/bun:1.3", "bash", "-c", "make test",
    ]);
    const gvisor = containerArgs({ kind: "docker", image: "i", network: "bridge", runtime: "runsc" }, "c", "/w", "1:1");
    expect(gvisor.slice(gvisor.indexOf("--network"), gvisor.indexOf("--network") + 2)).toEqual(["--network", "bridge"]);
    expect(gvisor).toContain("runsc");
  });
  test("lwpr: the command is framed after --", () => {
    const argv = lwprArgs({ kind: "lwpr", app: "web", timeoutMin: 20, setup: false }, "make test");
    expect(argv.slice(0, 9)).toEqual(["lwpr", "run", "--app", "web", "--timeout-min", "20", "--no-setup", "--", "bash"]);
    expect(argv.at(-1)).toBe(framed("make test"));
  });
  test("ssh: rsync skips .git and node_modules, then one quoted remote line", () => {
    const { sync, run } = sshArgs({ kind: "ssh", host: "ci1", dir: "/srv/f/" }, "make test", "/w/issue-7");
    expect(sync).toContain("--exclude=.git");
    expect(sync).toContain("--exclude=node_modules");
    expect(sync.slice(-2)).toEqual(["/w/issue-7/", "ci1:/srv/f/issue-7/"]);
    expect(run).toEqual(["ssh", "-o", "BatchMode=yes", "ci1", `bash -c 'cd '\\''/srv/f/issue-7'\\'' && make test'`]);
  });
});

describe("names", () => {
  test("machine.json runtimes: each problem named", () => {
    expect(runtimeProblems({ ok: { kind: "docker", image: "i" }, sb: { kind: "ssh", host: "h", dir: "/d", exclude: ["dist"] } })).toEqual([]);
    expect(runtimeProblems({ local: { kind: "local" }, "a b": { kind: "lwpr" }, d: { kind: "docker" }, s: { kind: "ssh", host: "h", dir: "/d", port: 22 }, x: { kind: "vm" } })).toEqual([
      'runtimes.local: "local" is built in',
      "runtimes.a b: a name is letters, digits, _ and -",
      "runtimes.d.image: required for docker",
      "runtimes.s.port: unknown key for ssh (allowed: kind, host, dir, exclude)",
      "runtimes.x.kind: one of local, docker, ssh, lwpr",
    ]);
  });
  test("a bad machine.json runtime stops boot", () => {
    const home = mkdtempSync(join(tmpdir(), "factory-home-"));
    writeFileSync(join(home, "machine.json"), JSON.stringify({ slots: 1, runtimes: { box: { kind: "ssh", host: "h" } } }));
    expect(() => loadMachineConfig({ FACTORY_HOME: home })).toThrow("runtimes.box.dir: required for ssh");
    writeFileSync(join(home, "machine.json"), JSON.stringify({ slots: 1, runtimes: { box: { kind: "ssh", host: "h", dir: "/d" } } }));
    expect(Object.keys(runtimesFrom(loadMachineConfig({ FACTORY_HOME: home }).runtimes))).toEqual(["local", "lwpr", "box"]);
  });
  test("config runtime and a check step's runtime are looked up, and an unknown one is named", () => {
    expect(configProblems({ repo: "a/b", runtime: { gates: "docker1", check: "lwpr" } })).toEqual([]);
    expect(configProblems({ repo: "a/b", runtime: { verify: "x" } })[0]).toContain("runtime.verify: unknown key");
    const refs = runtimeRefs({ runtime: { gates: "box" } }, { lint: { runtime: "gpu" }, build: {} });
    expect(unknownRuntimes(refs, { ...BUILTIN_RUNTIMES, box: {} })).toEqual([
      'steps.lint.runtime: no runtime "gpu" (have: local, lwpr, box; add it to FACTORY_HOME/machine.json runtimes)',
    ]);
  });
  test("runtime: is for check steps only", () => {
    const flow = (uses: string) => parseWorkflowText(`name: m\nsteps:\n  a:\n    uses: ${uses}\n    label: factory:a\n${uses === "check" ? "    run: make lint\n" : ""}    runtime: lwpr\n    next: p\n  p:\n    uses: pr\n    label: factory:in-review\n`);
    const ok = flow("check");
    expect(ok.ok && ok.workflow.steps.a!.runtime).toBe("lwpr");
    const bad = flow("build");
    expect(!bad.ok && bad.problems.join()).toContain("steps.a.runtime: a build step runs no command");
  });
});
