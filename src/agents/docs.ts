// docs/agents.md carries a table generated from PRESETS; tests/agents-registry.test.ts fails
// when the two disagree, and `bun scripts/gen-agents-doc.ts` rewrites it.

import { PRESETS } from "./presets";

export const TABLE_START = "<!-- agents-table:start -->";
export const TABLE_END = "<!-- agents-table:end -->";

export function agentsTable(): string {
  const rows = Object.values(PRESETS).map((p) =>
    [
      `\`${p.name}\``,
      `\`${p.binary}\``,
      `\`${p.version}\``,
      p.verified ? "yes" : "not yet",
      p.readOnlyBy,
      p.envKeys.map((k) => `\`${k}\``).join(", "),
      `\`${p.skillsDir}\``,
      p.docker === false ? "host only" : "pinned",
    ].join(" | "),
  );
  return [
    "Agent | Binary | Pinned version | Verified live | Read-only stages held by | API keys it may see | Skills dir | Docker",
    "--- | --- | --- | --- | --- | --- | --- | ---",
    ...rows,
  ]
    .map((l) => `| ${l} |`)
    .join("\n");
}

export function renderAgentsDoc(doc: string): string {
  const start = doc.indexOf(TABLE_START);
  const end = doc.indexOf(TABLE_END);
  if (start < 0 || end < start) throw new Error("docs/agents.md has no agents-table markers");
  return `${doc.slice(0, start + TABLE_START.length)}\n${agentsTable()}\n${doc.slice(end)}`;
}
