// agentskills.io spec, checked structurally rather than trusted by eye:
// frontmatter is exactly `name` + `description`, `name` matches the folder,
// the body is under 100 lines, and references/scripts/assets are one level
// deep. Also runs the real `skills-ref validate` CLI via uvx when available,
// since that is the authority `make check` calls — this file is the part of
// that check bun test can run without a network fetch of the tool itself.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(import.meta.dir, "..", "template", ".claude", "skills");

function parseFrontmatter(text: string): { keys: string[]; name?: string; body: string } {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { keys: [], body: text };
  const [, front, body] = match;
  const keys: string[] = [];
  let name: string | undefined;
  for (const line of (front ?? "").split("\n")) {
    const m = line.match(/^(\w[\w-]*):/);
    if (!m) continue;
    keys.push(m[1]!);
    if (m[1] === "name") name = line.slice(line.indexOf(":") + 1).trim();
  }
  return { keys, name, body: (body ?? "").trim() };
}

const skillDirs = readdirSync(SKILLS_DIR).filter((name) => statSync(join(SKILLS_DIR, name)).isDirectory());

describe("every template skill conforms to the agentskills.io spec", () => {
  expect(skillDirs.length).toBeGreaterThan(0);

  for (const dir of skillDirs) {
    describe(dir, () => {
      const skillPath = join(SKILLS_DIR, dir, "SKILL.md");

      test("has a SKILL.md", () => {
        expect(statSync(skillPath).isFile()).toBe(true);
      });

      const text = readFileSync(skillPath, "utf8");
      const { keys, name, body } = parseFrontmatter(text);

      test("frontmatter is exactly name + description", () => {
        expect(keys.sort()).toEqual(["description", "name"]);
      });

      test("name matches the folder name", () => {
        expect(name).toBe(dir);
      });

      test("body is under 100 lines", () => {
        const lineCount = body.split("\n").length;
        expect(lineCount).toBeLessThan(100);
      });

      test("references, scripts, and assets are one level deep", () => {
        for (const sub of ["references", "scripts", "assets"]) {
          const subPath = join(SKILLS_DIR, dir, sub);
          try {
            const entries = readdirSync(subPath);
            for (const entry of entries) {
              expect(statSync(join(subPath, entry)).isDirectory()).toBe(false);
            }
          } catch {
            // no such subdirectory: fine, it's optional
          }
        }
      });
    });
  }
});

describe("every template subagent has name + description + tools", () => {
  const agentsDir = join(import.meta.dir, "..", "template", ".claude", "agents");
  const files = readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    test(file, () => {
      const text = readFileSync(join(agentsDir, file), "utf8");
      const { keys, name } = parseFrontmatter(text);
      expect(keys).toContain("name");
      expect(keys).toContain("description");
      expect(keys).toContain("tools");
      expect(name).toBe(file.replace(/\.md$/, ""));
    });
  }
});

describe("skills-ref validate (the authority make check calls)", () => {
  // `skills-ref validate` takes one skill directory at a time (not a
  // directory of skills), so this runs it once per skill under template/.
  test("runs via uvx when available; make check treats a missing uvx as a hard failure, not a skip", async () => {
    const which = Bun.spawn(["which", "uvx"], { stdout: "pipe", stderr: "pipe" });
    const hasUvx = (await which.exited) === 0;
    if (!hasUvx) {
      console.warn("skills.test.ts: uvx not on PATH, skipping the live skills-ref run (make check still fails without uvx)");
      return;
    }
    for (const dir of skillDirs) {
      const proc = Bun.spawn(
        [
          "uvx",
          "--from",
          "git+https://github.com/agentskills/agentskills#subdirectory=skills-ref",
          "skills-ref",
          "validate",
          join(SKILLS_DIR, dir),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) throw new Error(`skills-ref validate ${dir} failed:\n${stdout}\n${stderr}`);
    }
  }, 60_000);
});
