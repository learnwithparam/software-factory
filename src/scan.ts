// `factory scan --repo r`: production signal becomes a task (plan section 1,
// Monitor row). Runs `bun audit --json` in the target's local clone and
// files one issue per PACKAGE with open advisories (audit finding #6).
//
// Two things about the real CLI output that the first version of this file
// got wrong, found by actually running it against splitbill (bun 1.3.14):
//   - `bun audit --json` is `Record<packageName, Advisory[]>`, not an array
//     and not `{ advisories: [...] }`. There is no `module_name`/`ghsa_id`
//     field on each advisory — the package name is the object key, and the
//     GHSA id has to be pulled out of the advisory's `url`.
//   - `bun outdated --json` does not exist: `--json` is silently ignored and
//     the command prints the same ASCII table as plain `bun outdated`. A
//     naive JSON.parse of that table always fails, so this file no longer
//     calls `bun outdated` at all — filing per-package upgrades is a
//     `upgrading-a-dependency` skill concern once a human opens the issue,
//     not something scan can source structured data for today.
//
// Filing per-package (not per-advisory) keeps a repo with one outdated,
// many-advisory package (hono: 48 advisories in splitbill) from producing
// 48 issues — see tests/fixtures/bun-audit-splitbill.json, captured from a
// real run, for the shape this parses.

import type { GitHub } from "./github";
import type { CommandRunner } from "./github";
import { LABEL } from "./labels";

export interface ScanFinding {
  readonly id: string; // "audit:<package>"
  readonly title: string;
  readonly body: string;
  readonly labelType: "security" | "dependency";
}

function marker(id: string): string {
  return `<!-- factory:scan id=${id} -->`;
}

interface AuditAdvisory {
  readonly id?: number;
  readonly url?: string;
  readonly title?: string;
  readonly severity?: string;
}

type AuditReport = Record<string, AuditAdvisory[]>;

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, moderate: 2, low: 1 };

function severityRank(severity: string | undefined): number {
  return SEVERITY_RANK[severity ?? ""] ?? 0;
}

// The advisory has no GHSA id field of its own — pull it from the advisory
// URL (…/advisories/GHSA-xxxx-xxxx-xxxx), falling back to the numeric id.
function ghsaId(advisory: AuditAdvisory): string {
  const match = advisory.url?.match(/GHSA-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+/i);
  return match ? match[0] : String(advisory.id ?? "unknown");
}

export function parseAuditFindings(json: string): ScanFinding[] {
  if (!json.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  // `bun audit --json` with nothing to report, and any shape this file
  // doesn't recognize, both fall through to "no findings" rather than a
  // crash — scan is best-effort, not a gate.
  if (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null) return [];

  const report = parsed as AuditReport;
  const findings: ScanFinding[] = [];
  for (const [pkg, advisoriesRaw] of Object.entries(report)) {
    const advisories = Array.isArray(advisoriesRaw) ? advisoriesRaw : [];
    if (advisories.length === 0) continue;
    const id = `audit:${pkg}`;
    const sorted = [...advisories].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    const worst = sorted[0]!;
    const count = advisories.length;
    const lines = sorted.map((a) => `- **${ghsaId(a)}** (${a.severity ?? "unknown"}): ${a.title ?? "untitled advisory"}`);
    findings.push({
      id,
      title: `${count} advisor${count === 1 ? "y" : "ies"} in ${pkg} (worst: ${worst.severity ?? "unknown"})`,
      body: [
        marker(id),
        `**Package:** ${pkg}`,
        `**Advisories:** ${count}`,
        "",
        ...lines,
        "",
        "Filed by `factory scan` from `bun audit --json`.",
      ].join("\n"),
      labelType: "security" as const,
    });
  }
  return findings;
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
  const audit = await deps.runner.run(["audit", "--json"], { cwd: cloneDir });
  const findings = parseAuditFindings(audit.stdout);

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
