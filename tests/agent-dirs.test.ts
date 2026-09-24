// install.sh keeps its own shell map of agent -> skills dir and context file. Pin it to the presets so the copies cannot drift.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agentRegistry } from "../src/agent-dirs";
import { PRESETS } from "../src/agents/presets";

const script = readFileSync(join(import.meta.dir, "../install.sh"), "utf8");
const shellMap = new Map([...script.matchAll(/^ {4}(\w+)\) echo "(\S+) (\S+)" ;;$/gm)].map((m) => [m[1]!, { skillsDir: m[2]!, contextFile: m[3]! }]));

test("install.sh's agent map has exactly the presets, with each preset's skills dir and context file", () => {
  expect([...shellMap.keys()].sort()).toEqual(Object.keys(PRESETS).sort());
  for (const [name, p] of Object.entries(PRESETS)) expect(shellMap.get(name)).toEqual({ skillsDir: p.skillsDir, contextFile: p.contextFile });
});

test("src/agent-dirs.ts resolves each preset to the same project dir install.sh links", () => {
  const registry = agentRegistry();
  for (const [name, entry] of shellMap) expect(registry.get(name)?.project).toBe(entry.skillsDir);
});
