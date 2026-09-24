// `factory doctor` is meant to catch a broken setup before the loop wastes a
// stage finding out. Before this file, "gh on PATH" only checked the binary
// existed, not that it was logged in, and nothing checked python3 (which
// guard-paths.sh silently fails open without — see guard-hook.test.ts) or
// jq (which gates.sh and the CI workflow assume). Audit findings #13.

import { describe, expect, test } from "bun:test";
import { runDoctor, type DoctorDeps } from "../src/doctor";
import { GitHub, type CommandResult, type CommandRunner } from "../src/github";
import { LABELS } from "../src/labels";

class FakeGitHub extends GitHub {
  constructor(private readonly auth: { ok: boolean; detail: string }) {
    super();
  }
  override async authStatus(): Promise<{ ok: boolean; detail: string }> {
    return this.auth;
  }
  override async listLabels(): Promise<string[]> {
    return LABELS.map((l) => l.name); // doctor's label check isn't what this file is testing
  }
}

class FakeGit implements CommandRunner {
  async run(): Promise<CommandResult> {
    return { stdout: "abc123\n", stderr: "", code: 0 };
  }
}

const files = new Map<string, string>();

function deps(overrides: Partial<{ which: Set<string>; auth: { ok: boolean; detail: string } }> = {}): DoctorDeps {
  const which = overrides.which ?? new Set(["gh", "claude", "python3", "jq"]);
  return {
    github: new FakeGitHub(overrides.auth ?? { ok: true, detail: "Logged in to github.com as octocat" }),
    git: new FakeGit(),
    which: async (bin: string) => which.has(bin),
    fileExists: async () => true,
    readFile: async () => files.get("text") ?? "{}",
    isExecutable: async () => files.get("exec") !== "no",
  };
}

const ctx = { repo: "acme/widgets", cloneDir: "/tmp/x", baselineTag: "baseline" };

describe("runDoctor", () => {
  test("all green when every binary is on PATH and gh is authenticated", async () => {
    const checks = await runDoctor(deps(), ctx);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.map((c) => c.name)).toContain("python3 on PATH");
    expect(checks.map((c) => c.name)).toContain("jq on PATH");
    expect(checks.map((c) => c.name)).toContain("gh authenticated");
  });

  test("flags a missing python3 even though `which gh` succeeds", async () => {
    const checks = await runDoctor(deps({ which: new Set(["gh", "claude", "jq"]) }), ctx);
    const py = checks.find((c) => c.name === "python3 on PATH")!;
    expect(py.ok).toBe(false);
  });

  test("flags a missing jq", async () => {
    const checks = await runDoctor(deps({ which: new Set(["gh", "claude", "python3"]) }), ctx);
    const jqCheck = checks.find((c) => c.name === "jq on PATH")!;
    expect(jqCheck.ok).toBe(false);
  });

  test("gh on PATH but not logged in fails the real auth check, not just the binary check", async () => {
    const checks = await runDoctor(
      deps({ auth: { ok: false, detail: "You are not logged into any GitHub hosts" } }),
      ctx,
    );
    const binCheck = checks.find((c) => c.name === "gh on PATH")!;
    const authCheck = checks.find((c) => c.name === "gh authenticated")!;
    expect(binCheck.ok).toBe(true); // `which gh` still finds the binary
    expect(authCheck.ok).toBe(false);
    expect(authCheck.detail).toContain("not logged into");
  });

  test("flags TODO markers left in the scaffolded config and charter", async () => {
    files.set("text", "# TODO: fill me in");
    const checks = await runDoctor(deps(), ctx);
    files.clear();
    expect(checks.filter((c) => c.name.includes("no TODO left")).map((c) => c.ok)).toEqual([false, false]);
  });

  test("flags a gates.sh that is not executable", async () => {
    files.set("exec", "no");
    const checks = await runDoctor(deps(), ctx);
    files.clear();
    expect(checks.find((c) => c.name.includes("gates.sh"))!.ok).toBe(false);
  });

  test("FACTORY_MODE=actions needs the workflow file; other modes do not", async () => {
    const noWorkflow = { ...deps(), fileExists: async (p: string) => !p.includes("workflows") };
    const inActions = await runDoctor(noWorkflow, { ...ctx, factoryMode: "actions" });
    expect(inActions.find((c) => c.name.includes("FACTORY_MODE"))!.ok).toBe(false);
    const local = await runDoctor(noWorkflow, ctx);
    expect(local.some((c) => c.name.includes("FACTORY_MODE"))).toBe(false);
  });
});

describe("agents in doctor", () => {
  const agents = { claude: { preset: "claude" }, codex: { preset: "codex" }, aider: { command: ["aider", "--yes"] }, unused: { preset: "codex" } };

  test("checks the binary of every agent a stage uses, and only those", async () => {
    const checks = await runDoctor(deps({ which: new Set(["gh", "claude", "python3", "jq"]) }), { ...ctx, agents, stages: { default: "claude", verify: "codex", build: "aider" } });
    const on = (n: string) => checks.find((c) => c.name === `${n} on PATH`);
    expect(on("claude")!.ok).toBe(true);
    expect(on("codex")!.ok).toBe(false);
    expect(on("aider")!.ok).toBe(false);
    expect(checks.filter((c) => c.name.endsWith(" on PATH")).map((c) => c.name)).not.toContain("unused on PATH");
  });

  test("a preset-less agent gets a usage warning, a preset agent does not", async () => {
    const checks = await runDoctor(deps({ which: new Set(["gh", "claude", "aider", "python3", "jq"]) }), { ...ctx, agents, stages: { default: "aider" } });
    expect(checks.map((c) => c.name)).toContain('agent "aider" reports usage');
    expect((await runDoctor(deps(), ctx)).map((c) => c.name)).not.toContain('agent "claude" reports usage');
  });
});
