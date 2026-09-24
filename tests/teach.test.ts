// teach/sessions.json is the teaching map. A shipped session names a tag that has a CHANGELOG entry; a planned one does not,
// so the flag flips when the release ships. Splitbill files are checked when a checkout is at ../../../splitbill.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Session { id: string; title: string; tag: string; planned: boolean; checkpoint: string | null; issue: string; demo: string[] }
const root = join(import.meta.dir, "..");
const { sessions } = JSON.parse(readFileSync(join(root, "teach/sessions.json"), "utf8")) as { sessions: Session[] };
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
const splitbill = [process.env.SPLITBILL_DIR, join(root, "../../../splitbill"), join(root, "../splitbill")].find((d) => d && existsSync(join(d, "DEMO.md")));

describe("teach/sessions.json", () => {
  test("ids and tags are unique, and checkpoints are used once", () => {
    for (const key of ["id", "tag"] as const) expect(new Set(sessions.map((s) => s[key])).size).toBe(sessions.length);
    const branches = sessions.flatMap((s) => (s.checkpoint ? [s.checkpoint] : []));
    expect(new Set(branches).size).toBe(branches.length);
  });

  test("a shipped session's tag has a CHANGELOG entry, and a planned one does not", () => {
    for (const s of sessions) expect({ id: s.id, shipped: new RegExp(`^## ${s.tag.replace(/\./g, "\\.")}\\b`, "m").test(changelog) }).toEqual({ id: s.id, shipped: !s.planned });
  });

  test("every demo step is a section or a numbered step in splitbill's DEMO.md", () => {
    if (!splitbill) return console.log("teach: no splitbill checkout, DEMO.md steps not checked");
    const demo = readFileSync(join(splitbill, "DEMO.md"), "utf8");
    for (const s of sessions) for (const step of s.demo) {
      const num = /^Live sequence (\d+)$/.exec(step);
      expect({ id: s.id, step, found: num ? new RegExp(`^\\| ${num[1]} \\|`, "m").test(demo) : new RegExp(`^## ${step}$`, "m").test(demo) }).toEqual({ id: s.id, step, found: true });
    }
  });

  test("every seeded issue exists in splitbill and every checkpoint tag exists there", () => {
    if (!splitbill) return console.log("teach: no splitbill checkout, issues and branches not checked");
    const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
    for (const s of sessions) {
      expect({ id: s.id, issue: existsSync(join(splitbill, ".factory/issues", s.issue)) }).toEqual({ id: s.id, issue: true });
      if (!s.checkpoint) continue;
      const ok = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/checkpoint/${s.checkpoint}`], { cwd: splitbill }).status === 0;
      expect({ id: s.id, tag: ok }).toEqual({ id: s.id, tag: true });
    }
  });
});
