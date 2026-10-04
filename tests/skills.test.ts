// agentskills.io spec, checked structurally rather than trusted by eye:
// frontmatter is exactly `name` + `description`, `name` matches the folder,
// the body is under 100 lines, and references/scripts/assets are one level
// deep. Also runs the real `skills-ref validate` CLI via uvx when available,
// since that is the authority `make check` calls — this file is the part of
// that check bun test can run without a network fetch of the tool itself.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { STAGE_GUIDANCE, stageAllowRules } from "../src/stage-permissions";

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

// A revise writes revise.md and reruns a stage (src/watch.ts). A stage whose skill never reads it reruns blind:
// on v2.12.0 a PR's `/factory revise add a curl example` rebuilt with no change.
describe("every stage a revise reruns reads revise.md", () => {
  const watch = readFileSync(join(import.meta.dir, "..", "src", "watch.ts"), "utf8");
  const stages = [...watch.matchAll(/writeRevision\([\s\S]*?runFromStage\([^)]*?"(\w+)"/g)].map((m) => m[1]!);
  test("watch.ts reruns plan and build on a revise", () => expect([...new Set(stages)].sort()).toEqual(["build", "plan"]));
  for (const stage of new Set(stages))
    test(`factory-${stage}`, () => expect(readFileSync(join(SKILLS_DIR, `factory-${stage}`, "SKILL.md"), "utf8")).toContain("revise.md"));
});

// Subagents never see --append-system-prompt, so each template agent carries the
// stage's shell rules itself. In all 7 splitbill-demo issues that reached verify, a verify
// command broke a shell rule and the verifier read the refusal as "Bash denied".
describe("every template agent carries STAGE_GUIDANCE verbatim", () => {
  const agentsDir = join(import.meta.dir, "..", "template", ".claude", "agents");
  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith(".md")))
    test(file, () => expect(readFileSync(join(agentsDir, file), "utf8")).toContain(STAGE_GUIDANCE));
});

// A command the template tells a stage to run must survive the stage's own
// guard (the hook is the one definition of a refused shape). `<base>` style
// placeholders become a plain word first.
describe("every inline shell command in the template passes the stage shell rules", () => {
  const root = join(import.meta.dir, "..", "template", ".claude");
  const HOOK = join(root, "hooks", "guard-paths.sh");
  const COMMAND = /^(git|bun|make|npm|npx|pnpm|bash|cat|ls|grep|find|echo|head|tail|cd|\.factory\/gates\.sh)\b/;
  const files = Bun.spawnSync(["find", join(root, "skills"), join(root, "agents"), "-name", "*.md"]).stdout.toString().trim().split("\n");
  const commands = new Map<string, string>();
  for (const file of files)
    for (const [, span] of readFileSync(file, "utf8").matchAll(/`([^`\n]+)`/g))
      if (COMMAND.test(span!)) commands.set(span!.replace(/<[^<>]+>/g, "X"), file.slice(root.length + 1));
  test("found the commands to check", () => expect(commands.size).toBeGreaterThan(5));
  for (const [command, file] of commands)
    test(`${file}: ${command}`, () => {
      const run = Bun.spawnSync([HOOK], {
        stdin: new TextEncoder().encode(JSON.stringify({ tool_name: "Bash", tool_input: { command } })),
        env: { ...process.env, FACTORY_STAGE: "verify" },
      });
      expect(run.stderr.toString()).toBe("");
      expect(run.exitCode).toBe(0);
    });
});

// Shape is not enough: dontAsk also refuses a command off the stage allow-list.
// The verifier was told to run .factory/gates.sh, which only build may run.
describe("every inline command in factory-verifier is on the verify allow-list", () => {
  const body = readFileSync(join(import.meta.dir, "..", "template", ".claude", "agents", "factory-verifier.md"), "utf8");
  const allowed = stageAllowRules("verify", 1)
    .map((rule) => /^Bash\((.*)\)$/.exec(rule)?.[1])
    .filter((p): p is string => p !== undefined)
    .map((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`));
  const commands = [...body.matchAll(/`([^`\n]+)`/g)]
    .map(([, span]) => span!.replace(/<[^<>]+>/g, "X"))
    .filter((span) => /^(git|bun|make|npm|bash) |^\.factory\/\S+\.sh/.test(span));
  test("found the commands to check", () => expect(commands.length).toBeGreaterThan(3));
  // The executor creates .factory/runs/issue-N/ untracked, so a bare "prints nothing" never holds.
  test("the clean-restore check allows the untracked run dir", () => expect(body).toContain("must list nothing outside `.factory/`"));
  for (const command of commands) test(command, () => expect(allowed.some((r) => r.test(command))).toBe(true));
});
