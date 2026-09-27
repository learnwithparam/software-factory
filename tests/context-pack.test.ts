// Plan v2.7.0 item 3: buildContextPack assembles AGENTS.md, the routed
// skills, ARCHITECTURE.md and the plan's own files, capped at 64 KiB with
// drops listed, then reaches both the Claude and the non-Claude agent path.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeArgs } from "../src/agents/presets/claude";
import { renderPrompt } from "../src/agents/prompt";
import { runDir } from "../src/artifacts";
import { buildContextPack, MAX_CONTEXT_PACK_BYTES } from "../src/context";
import { STAGE_GUIDANCE } from "../src/stage-permissions";

function worktree(): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-ctx-"));
  mkdirSync(`${dir}/.claude/skills/factory-build`, { recursive: true });
  writeFileSync(`${dir}/.claude/skills/factory-build/SKILL.md`, "# factory-build\n\nDo the build stage.\n");
  return dir;
}

describe("buildContextPack", () => {
  test("is empty when the repo has nothing for it to hold", async () => {
    const cwd = worktree();
    expect(await buildContextPack("build", 1, cwd, [])).toBe("");
    rmSync(cwd, { recursive: true, force: true });
  });

  test("holds AGENTS.md, a routed skill, ARCHITECTURE.md, and the plan's own files", async () => {
    const cwd = worktree();
    writeFileSync(`${cwd}/AGENTS.md`, "Use tabs, not spaces.");
    writeFileSync(`${cwd}/ARCHITECTURE.md`, "Three layers: api, core, db.");
    mkdirSync(`${cwd}/.claude/skills/writing`, { recursive: true });
    writeFileSync(`${cwd}/.claude/skills/writing/SKILL.md`, "---\nname: writing\n---\nWrite in plain language.");
    mkdirSync(`${cwd}/${runDir(1)}`, { recursive: true });
    writeFileSync(`${cwd}/${runDir(1)}/plan.json`, JSON.stringify({ risk: "low", revision: 1, files: ["src/foo.ts"], autoApproveEligible: true }));
    mkdirSync(`${cwd}/src`, { recursive: true });
    writeFileSync(`${cwd}/src/foo.ts`, "export const foo = 1;");

    const pack = await buildContextPack("build", 1, cwd, ["writing"]);

    expect(pack).toContain("Use tabs, not spaces.");
    expect(pack).toContain("Write in plain language.");
    expect(pack).not.toContain("---\nname: writing"); // frontmatter stripped, same as a stage skill
    expect(pack).toContain("Three layers: api, core, db.");
    expect(pack).toContain("export const foo = 1;");
    expect(pack).toContain("file: src/foo.ts");

    rmSync(cwd, { recursive: true, force: true });
  });

  test("caps at 64 KiB and lists what it dropped, instead of truncating a kept file", async () => {
    const cwd = worktree();
    writeFileSync(`${cwd}/AGENTS.md`, "Small and essential.");
    mkdirSync(`${cwd}/${runDir(1)}`, { recursive: true });
    writeFileSync(`${cwd}/${runDir(1)}/plan.json`, JSON.stringify({ risk: "low", revision: 1, files: ["src/big.ts"], autoApproveEligible: true }));
    mkdirSync(`${cwd}/src`, { recursive: true });
    writeFileSync(`${cwd}/src/big.ts`, "x".repeat(MAX_CONTEXT_PACK_BYTES));

    const pack = await buildContextPack("build", 1, cwd, []);

    expect(pack).toContain("Small and essential.");
    expect(pack).not.toContain("x".repeat(1000)); // the big file's content never made it in
    expect(pack).toContain("Dropped");
    expect(pack).toContain("file: src/big.ts");
    expect(Buffer.byteLength(pack)).toBeLessThan(MAX_CONTEXT_PACK_BYTES + 200); // small slack for the drop note itself

    rmSync(cwd, { recursive: true, force: true });
  });

  test("a plan file that does not exist on disk is skipped, not reported as dropped", async () => {
    const cwd = worktree();
    mkdirSync(`${cwd}/${runDir(1)}`, { recursive: true });
    writeFileSync(`${cwd}/${runDir(1)}/plan.json`, JSON.stringify({ risk: "low", revision: 1, files: ["src/missing.ts"], autoApproveEligible: true }));

    const pack = await buildContextPack("build", 1, cwd, []);

    expect(pack).toBe(""); // nothing else to hold, and a missing file is not a "drop"
    rmSync(cwd, { recursive: true, force: true });
  });
});

describe("the context pack reaches both agent paths", () => {
  test("a non-Claude agent gets it inlined into the rendered prompt", async () => {
    const cwd = worktree();
    const prompt = await renderPrompt({ stage: "build", issue: 3, cwd, maxBudgetUsd: 1 }, false, undefined, "## Context pack\n\n### AGENTS.md\n\nUse tabs.");
    expect(prompt).toContain("## Context pack");
    expect(prompt).toContain("Use tabs.");
  });

  test("an empty context pack adds nothing to the rendered prompt", async () => {
    const cwd = worktree();
    const prompt = await renderPrompt({ stage: "build", issue: 3, cwd, maxBudgetUsd: 1 });
    expect(prompt).not.toContain("Context pack");
  });

  test("Claude gets it appended after STAGE_GUIDANCE in the same --append-system-prompt", () => {
    const opts = { stage: "build" as const, issue: 12, cwd: "/w", maxBudgetUsd: 5 };
    const args = claudeArgs(opts, "## Context pack\n\n### AGENTS.md\n\nUse tabs.");
    const i = args.indexOf("--append-system-prompt");
    expect(args[i + 1]).toBe(`${STAGE_GUIDANCE}\n\n## Context pack\n\n### AGENTS.md\n\nUse tabs.`);
  });

  test("an empty context pack leaves Claude's argv exactly as v2.4.0 sent it", () => {
    const opts = { stage: "build" as const, issue: 12, cwd: "/w", maxBudgetUsd: 5 };
    expect(claudeArgs(opts, "")).toEqual(claudeArgs(opts));
  });
});
