// `factory scan --repo r`: production signal becomes a task (plan section 1,
// Monitor row). Runs `bun audit --json` and `bun outdated` in the target's
// local clone, files one issue per finding not already open.

import type { GitHub } from "./github";
import type { CommandRunner } from "./github";
import { LABEL } from "./labels";

export interface ScanFinding {
  readonly id: string; // advisory GHSA id, or "outdated:<package>"
  readonly title: string;
  readonly body: string;
  readonly labelType: "security" | "dependency";
}

function marker(id: string): string {
  return `<!-- factory:scan id=${id} -->`;
}

interface AuditAdvisory {
  id?: string;
  ghsa_id?: string;
  module_name?: string;
  title?: string;
  severity?: string;
  url?: string;
}

export function parseAuditFindings(json: string): ScanFinding[] {
  if (!json.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const advisories: AuditAdvisory[] = Array.isArray(parsed)
    ? (parsed as AuditAdvisory[])
    : ((parsed as { advisories?: AuditAdvisory[] })?.advisories ?? []);
  return advisories.map((a) => {
    const id = a.ghsa_id ?? a.id ?? "unknown";
    return {
      id,
      title: `${a.severity ?? "unknown"}-severity advisory in ${a.module_name ?? "a dependency"}: ${id}`,
      body: [
        marker(id),
        `**Advisory:** ${id}`,
        `**Package:** ${a.module_name ?? "unknown"}`,
        `**Severity:** ${a.severity ?? "unknown"}`,
        a.url ? `**Details:** ${a.url}` : "",
        "",
        "Filed by `factory scan` from `bun audit --json`.",
      ]
        .filter(Boolean)
        .join("\n"),
      labelType: "security" as const,
    };
  });
}

interface OutdatedRow {
  name?: string;
  current?: string;
  latest?: string;
}

export function parseOutdatedFindings(json: string): ScanFinding[] {
  if (!json.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const rows: OutdatedRow[] = Array.isArray(parsed) ? (parsed as OutdatedRow[]) : [];
  return rows
    .filter((r) => r.name && r.current && r.latest && r.current !== r.latest)
    .map((r) => {
      const id = `outdated:${r.name}`;
      return {
        id,
        title: `Upgrade ${r.name} ${r.current} -> ${r.latest}`,
        body: [
          marker(id),
          `**Package:** ${r.name}`,
          `**Current:** ${r.current}`,
          `**Latest:** ${r.latest}`,
          "",
          "Filed by `factory scan` from `bun outdated`.",
        ].join("\n"),
        labelType: "dependency" as const,
      };
    });
}

export interface ScanDeps {
  readonly github: GitHub;
  readonly runner: CommandRunner;
}

export interface ScanResult {
  readonly filed: string[]; // issue titles filed this run
  readonly skipped: string[]; // findings already open, deduped by marker
}

export async function scan(deps: ScanDeps, repo: string, cloneDir: string): Promise<ScanResult> {
  const [audit, outdated] = await Promise.all([
    deps.runner.run(["audit", "--json"], { cwd: cloneDir }),
    deps.runner.run(["outdated", "--json"], { cwd: cloneDir }),
  ]);
  const findings = [...parseAuditFindings(audit.stdout), ...parseOutdatedFindings(outdated.stdout)];

  const open = await deps.github.listOpenIssues(repo);
  const openMarkers = new Set(
    open.flatMap((i) => [...i.body.matchAll(/<!-- factory:scan id=([^\s]+) -->/g)].map((m) => m[1])),
  );

  const filed: string[] = [];
  const skipped: string[] = [];
  for (const finding of findings) {
    if (openMarkers.has(finding.id)) {
      skipped.push(finding.title);
      continue;
    }
    await deps.github.createIssue(repo, finding.title, finding.body, [finding.labelType, LABEL.monitor]);
    filed.push(finding.title);
  }
  return { filed, skipped };
}
