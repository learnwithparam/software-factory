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

// v2.10.0 item 2: repo-local memory across runs. Capped well under the
// context pack's own budget so a growing lessons file can never crowd out
// AGENTS.md or the plan's own files; `factory learn` (v2.10.0 item 4) enforces
// the same cap when it appends, so reading here should rarely need to trim.
export const LESSONS_PATH = ".factory/memory/lessons.md";
export const MAX_LESSONS_BYTES = 8 * 1024;

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

// Keeps the most recent lessons (the tail of the file, whole lines only) when
// over the cap, since a newer lesson is more likely to still apply than an
// older one it may have superseded.
export function capLessons(raw: string): string {
  if (Buffer.byteLength(raw) <= MAX_LESSONS_BYTES) return raw;
  const lines = raw.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    const bytes = Buffer.byteLength(`${line}\n`);
    if (used + bytes > MAX_LESSONS_BYTES) break;
    kept.unshift(line);
    used += bytes;
  }
  return `Older lessons dropped for the ${MAX_LESSONS_BYTES / 1024} KiB lessons-file cap.\n\n${kept.join("\n")}`;
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

  const lessons = await readOptional(`${cwd}/${LESSONS_PATH}`);
  if (lessons) out.push({ label: "lessons learned", body: capLessons(lessons).trim() });

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
