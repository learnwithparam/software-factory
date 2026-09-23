// install.sh's default (skip existing files) behavior has no test today;
// this file covers that plus the new --update (audit finding #17: template
// fixes couldn't reach an already-installed repo) and --ci flags. Runs the
// real script against a scratch target dir — no fakes, this is a shell
// script.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "install.sh");

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bash", SCRIPT, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function scratchTarget(): string {
  return mkdtempSync(join(tmpdir(), "factory-install-"));
}

describe("install.sh (default)", () => {
  test("writes the template into an empty target", () => {
    const target = scratchTarget();
    const { code } = run([target]);
    expect(code).toBe(0);
    expect(existsSync(join(target, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(target, ".claude", "hooks", "guard-paths.sh"))).toBe(true);
    rmSync(target, { recursive: true, force: true });
  });

  test("never overwrites a file that already exists", () => {
    const target = scratchTarget();
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(join(target, ".claude", "settings.json"), "custom content");
    const { stdout } = run([target]);
    expect(stdout).toContain("skip (exists): .claude/settings.json");
    expect(readFileSync(join(target, ".claude", "settings.json"), "utf8")).toBe("custom content");
    rmSync(target, { recursive: true, force: true });
  });

  test("--dry-run writes nothing", () => {
    const target = scratchTarget();
    run([target, "--dry-run"]);
    expect(existsSync(join(target, ".claude", "settings.json"))).toBe(false);
    rmSync(target, { recursive: true, force: true });
  });
});

describe("install.sh --update", () => {
  test("overwrites a factory-owned file that already exists", () => {
    const target = scratchTarget();
    run([target]); // first install
    writeFileSync(join(target, ".claude", "hooks", "guard-paths.sh"), "#!/usr/bin/env bash\n# stale\n");
    const { stdout } = run([target, "--update"]);
    expect(stdout).toContain("overwrote: .claude/hooks/guard-paths.sh");
    const updated = readFileSync(join(target, ".claude", "hooks", "guard-paths.sh"), "utf8");
    expect(updated).toContain("fails closed"); // the current template content, not the stale stub
    rmSync(target, { recursive: true, force: true });
  });

  test("never silently overwrites settings.json; writes a .factory-new for review when it differs", () => {
    const target = scratchTarget();
    run([target]);
    writeFileSync(join(target, ".claude", "settings.json"), '{"custom": true}');
    const { stdout } = run([target, "--update"]);
    expect(stdout).toContain("not overwritten");
    expect(readFileSync(join(target, ".claude", "settings.json"), "utf8")).toBe('{"custom": true}');
    expect(existsSync(join(target, ".claude", "settings.json.factory-new"))).toBe(true);
    rmSync(target, { recursive: true, force: true });
  });

  test("leaves settings.json alone (no .factory-new) when it already matches the template", () => {
    const target = scratchTarget();
    run([target]);
    const { stdout } = run([target, "--update"]);
    expect(stdout).toContain("unchanged: .claude/settings.json");
    expect(existsSync(join(target, ".claude", "settings.json.factory-new"))).toBe(false);
    rmSync(target, { recursive: true, force: true });
  });
});

describe("install.sh --ci", () => {
  test("writes an inert factory.yml.example placeholder", () => {
    const target = scratchTarget();
    const { code, stdout } = run([target, "--ci"]);
    expect(code).toBe(0);
    expect(stdout).toContain("inert");
    const written = join(target, ".github", "workflows", "factory.yml.example");
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written, "utf8")).toContain("FACTORY_MODE=actions");
    rmSync(target, { recursive: true, force: true });
  });
});

describe("install.sh scaffold", () => {
  test("writes an executable gates.sh, a config example and a charter", () => {
    const target = scratchTarget();
    run([target]);
    for (const f of ["gates.sh", "config.example.json", "charter.md"]) {
      expect(existsSync(join(target, ".factory", f))).toBe(true);
    }
    expect(Bun.spawnSync(["test", "-x", join(target, ".factory", "gates.sh")]).exitCode).toBe(0);
    expect(existsSync(join(target, ".factory", "config.json"))).toBe(false);
    rmSync(target, { recursive: true, force: true });
  });

  test("--update refreshes gates.sh but never touches the repo's charter", () => {
    const target = scratchTarget();
    run([target]);
    writeFileSync(join(target, ".factory", "charter.md"), "my charter");
    writeFileSync(join(target, ".factory", "gates.sh"), "old");
    run([target, "--update"]);
    expect(readFileSync(join(target, ".factory", "charter.md"), "utf8")).toBe("my charter");
    expect(readFileSync(join(target, ".factory", "gates.sh"), "utf8")).not.toBe("old");
    rmSync(target, { recursive: true, force: true });
  });
});
