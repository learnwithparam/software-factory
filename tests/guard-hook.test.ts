// Exercises template/.claude/hooks/guard-paths.sh directly, as Claude Code
// would call it: JSON on stdin, exit 2 + stderr to block. No claude, no
// network — just the hook script and a scratch project directory.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "..", "template", ".claude", "hooks", "guard-paths.sh");

// A minimal PATH with everything the hook's bash needs (env's shebang
// lookup, mktemp/cat/rm/command) but no python3, to prove the "python3
// missing" branch actually fires rather than just existing in the script.
function pathWithoutPython3(): string {
  const binDir = mkdtempSync(join(tmpdir(), "factory-nopython-bin-"));
  for (const tool of ["bash", "mktemp", "cat", "rm", "sh"]) {
    const real = Bun.spawnSync(["which", tool]).stdout.toString().trim();
    if (real) symlinkSync(real, join(binDir, tool));
  }
  return binDir;
}

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "factory-guard-"));
  mkdirSync(join(projectDir, ".factory"), { recursive: true });
  writeFileSync(
    join(projectDir, ".factory", "config.json"),
    JSON.stringify({ protectedPaths: ["src/payments/**"] }),
  );
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

async function runHook(input: unknown): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn([HOOK], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
  });
  proc.stdin.write(JSON.stringify(input));
  await proc.stdin.end();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stderr };
}

describe("guard-paths.sh", () => {
  test("blocks an edit to a repo-declared protected path", async () => {
    const { code, stderr } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${projectDir}/src/payments/charge.ts` },
    });
    expect(code).toBe(2);
    expect(stderr).toContain("protected path");
  });

  test("blocks a write under .claude/", async () => {
    const { code } = await runHook({
      tool_name: "Write",
      tool_input: { file_path: `${projectDir}/.claude/settings.json` },
    });
    expect(code).toBe(2);
  });

  test("blocks git push --force", async () => {
    const { code, stderr } = await runHook({
      tool_name: "Bash",
      tool_input: { command: "git push --force origin main" },
    });
    expect(code).toBe(2);
    expect(stderr).toContain("force");
  });

  test("blocks git merge", async () => {
    const { code } = await runHook({
      tool_name: "Bash",
      tool_input: { command: "git merge feature-branch" },
    });
    expect(code).toBe(2);
  });

  test("allows an edit to an unprotected path", async () => {
    const { code } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${projectDir}/src/widgets/list.ts` },
    });
    expect(code).toBe(0);
  });

  test("always allows a write under .factory/runs/, even though .factory/** is otherwise protected", async () => {
    const { code } = await runHook({
      tool_name: "Write",
      tool_input: { file_path: `${projectDir}/.factory/runs/issue-42/triage.json` },
    });
    expect(code).toBe(0);
  });

  test("allows a plain read-only Bash command", async () => {
    const { code } = await runHook({
      tool_name: "Bash",
      tool_input: { command: "git status --short" },
    });
    expect(code).toBe(0);
  });

  test("fails CLOSED (blocks) when its input is not valid JSON", async () => {
    const proc = Bun.spawn([HOOK], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir } });
    proc.stdin.write("not json");
    await proc.stdin.end();
    expect(await proc.exited).toBe(2);
  });

  test("fails open when .factory/config.json is missing", async () => {
    rmSync(join(projectDir, ".factory", "config.json"));
    const { code } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${projectDir}/src/payments/charge.ts` },
    });
    // no config.json means no repo-declared protected paths; .claude/** and
    // .factory/** are still always protected, but src/payments isn't.
    expect(code).toBe(0);
  });

  test("fails CLOSED (blocks) when python3 is not on PATH, instead of failing open", async () => {
    const binDir = pathWithoutPython3();
    const proc = Bun.spawn([HOOK], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { CLAUDE_PROJECT_DIR: projectDir, PATH: binDir },
    });
    proc.stdin.write(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: `${projectDir}/src/widgets/list.ts` } }));
    await proc.stdin.end();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    rmSync(binDir, { recursive: true, force: true });
    expect(code).toBe(2);
    expect(stderr).toContain("python3");
  });
});
