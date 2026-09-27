// Plan v2.7.0 item 3: what an agent would otherwise spend tool calls
// discovering, assembled once, up front. Held pack: AGENTS.md, the skills its
// route adds for the issue's type, ARCHITECTURE.md if the repo has one, and
// the files the plan named. Capped at 64 KiB; whatever does not fit is named
// in the pack, never silently truncated mid-file.

import type { PlanArtifact } from "./artifacts";
import { readStageArtifacts } from "./artifacts";
import type { StageName } from "./executor";
import { stripFrontmatter } from "./agents/prompt";

export const MAX_CONTEXT_PACK_BYTES = 64 * 1024;

interface Section {
  readonly label: string;
  readonly body: string;
}

async function readOptional(path: string): Promise<string | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  const text = await file.text();
  return text.trim() ? text : undefined;
}

async function planFiles(cwd: string, issue: number): Promise<readonly string[]> {
  const { json } = await readStageArtifacts(cwd, issue, "plan");
  const files = (json as Partial<PlanArtifact> | undefined)?.files;
  return Array.isArray(files) ? files.filter((f): f is string => typeof f === "string") : [];
}

async function sections(issue: number, cwd: string, skills: readonly string[]): Promise<Section[]> {
  const out: Section[] = [];
  const agentsMd = await readOptional(`${cwd}/AGENTS.md`);
  if (agentsMd) out.push({ label: "AGENTS.md", body: agentsMd.trim() });

  for (const name of skills) {
    const body = await readOptional(`${cwd}/.claude/skills/${name}/SKILL.md`);
    if (body) out.push({ label: `skill: ${name}`, body: stripFrontmatter(body).trim() });
  }

  const architectureMd = await readOptional(`${cwd}/ARCHITECTURE.md`);
  if (architectureMd) out.push({ label: "ARCHITECTURE.md", body: architectureMd.trim() });

  // Triage runs before a plan exists, so this is empty until plan and later.
  for (const path of await planFiles(cwd, issue)) {
    const body = await readOptional(`${cwd}/${path}`);
    if (body) out.push({ label: `file: ${path}`, body: body.trim() });
  }

  return out;
}

// Sections are added highest-priority first (repo conventions and skills
// ahead of the plan's own files), and the budget is enforced in that same
// order: the first sections over budget get dropped, not the file content
// inside a kept section truncated.
function assemble(built: readonly Section[]): string {
  const header = "## Context pack\n\n";
  let used = Buffer.byteLength(header);
  const kept: Section[] = [];
  const dropped: string[] = [];
  for (const s of built) {
    const block = `### ${s.label}\n\n${s.body}\n\n`;
    const bytes = Buffer.byteLength(block);
    if (used + bytes > MAX_CONTEXT_PACK_BYTES) {
      dropped.push(s.label);
      continue;
    }
    used += bytes;
    kept.push(s);
  }
  if (!kept.length && !dropped.length) return "";
  const droppedNote = dropped.length ? `Dropped for the 64 KiB context-pack budget: ${dropped.join(", ")}.\n\n` : "";
  return `${header}${droppedNote}${kept.map((s) => `### ${s.label}\n\n${s.body}\n\n`).join("")}`.trim();
}

// "" means there is nothing to add: callers skip injecting it rather than
// appending an empty "## Context pack" header. `stage` is part of the
// signature (plan v2.7.0 item 3) for a future stage-specific pack; every
// stage gets the same sections today.
export async function buildContextPack(stage: StageName, issue: number, cwd: string, skills: readonly string[] = []): Promise<string> {
  void stage;
  return assemble(await sections(issue, cwd, skills));
}
