// scan.ts parses `bun audit --json`'s real shape — a real 1.3.14 capture
// from splitbill lives in fixtures/, not a hand-written guess. Before this
// file, parseAuditFindings assumed `{ advisories: [...] }` with a
// `module_name`/`ghsa_id` per advisory; the real output is
// `Record<package, Advisory[]>` with neither field, which would have parsed
// to zero findings against the live repo (audit finding #6).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAuditFindings, scan, type ScanDeps } from "../src/scan";
import { GitHub, type CommandResult, type CommandRunner, type GhIssue } from "../src/github";
import { LABEL } from "../src/labels";

const FIXTURE = readFileSync(join(import.meta.dir, "fixtures", "bun-audit-splitbill.json"), "utf8");

describe("parseAuditFindings", () => {
  test("groups the real splitbill capture into one finding per package, not per advisory", () => {
    const findings = parseAuditFindings(FIXTURE);
    expect(findings).toHaveLength(2);
    const ids = findings.map((f) => f.id).sort();
    expect(ids).toEqual(["audit:hono", "audit:nanoid"]);
  });

  test("the hono finding rolls up all 41 advisories and cites the worst severity", () => {
    const findings = parseAuditFindings(FIXTURE);
    const hono = findings.find((f) => f.id === "audit:hono")!;
    expect(hono.title).toContain("41 advisories in hono");
    expect(hono.title).toContain("worst: high");
    expect(hono.labelType).toBe("security");
    expect(hono.body).toContain("<!-- factory:scan id=audit:hono -->");
    expect(hono.body).toContain("**Package:** hono");
    // Every advisory's GHSA id (pulled from its url, not a module_name field
    // that doesn't exist in the real payload) shows up in the body.
    expect(hono.body).toContain("GHSA-q7jf-gf43-6x6p");
  });

  test("the nanoid finding is separate from hono's", () => {
    const findings = parseAuditFindings(FIXTURE);
    const nanoid = findings.find((f) => f.id === "audit:nanoid")!;
    expect(nanoid.title).toContain("4 advisories in nanoid");
    expect(nanoid.body).toContain("GHSA-xwg4-73v4-xw9w");
  });

  test("an empty audit ({} - no advisories) parses to no findings", () => {
    expect(parseAuditFindings("{}")).toEqual([]);
  });

  test("unparseable JSON parses to no findings rather than throwing", () => {
    expect(parseAuditFindings("not json")).toEqual([]);
  });

  test("an array payload (not the real object-keyed shape) parses to no findings", () => {
    expect(parseAuditFindings("[]")).toEqual([]);
  });
});

class FakeGitHub extends GitHub {
  created: { title: string; body: string; labels: string[] }[] = [];
  constructor(private readonly openIssues: GhIssue[]) {
    super();
  }
  override async listOpenIssues(): Promise<GhIssue[]> {
    return this.openIssues;
  }
  override async createIssue(_repo: string, title: string, body: string, labels: string[]): Promise<number> {
    this.created.push({ title, body, labels });
    return 42;
  }
}

class FakeBunRunner implements CommandRunner {
  constructor(private readonly stdout: string) {}
  async run(): Promise<CommandResult> {
    return { stdout: this.stdout, stderr: "", code: 1 }; // bun audit exits non-zero when it finds advisories
  }
}

function issue(number: number, body: string): GhIssue {
  return { number, title: "seed", body, labels: [], comments: [] };
}

describe("scan()", () => {
  test("files only the finding not already open, per plan's audit:hono seed marker", async () => {
    // Mirrors the splitbill seed: issue #6 already carries the audit:hono
    // marker (filed by hand as the workshop's seeded dependency issue), so a
    // live scan should only file nanoid.
    const github = new FakeGitHub([issue(6, "some body\n<!-- factory:scan id=audit:hono -->\nmore text")]);
    const deps: ScanDeps = { github, runner: new FakeBunRunner(FIXTURE) };
    const result = await scan(deps, "acme/widgets", "/tmp/does-not-matter");

    expect(result.skipped).toHaveLength(1);
    expect(result.filed).toHaveLength(1);
    expect(github.created).toHaveLength(1);
    expect(github.created[0]!.title).toContain("nanoid");
    expect(github.created[0]!.labels).toEqual(["security", LABEL.monitor]);
  });

  test("files both findings when nothing is open yet", async () => {
    const github = new FakeGitHub([]);
    const deps: ScanDeps = { github, runner: new FakeBunRunner(FIXTURE) };
    const result = await scan(deps, "acme/widgets", "/tmp/does-not-matter");
    expect(result.filed).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  test("only calls bun audit, never bun outdated (there is no outdated --json)", async () => {
    const calls: string[][] = [];
    class RecordingRunner implements CommandRunner {
      async run(args: string[]): Promise<CommandResult> {
        calls.push(args);
        return { stdout: "{}", stderr: "", code: 0 };
      }
    }
    const github = new FakeGitHub([]);
    await scan({ github, runner: new RecordingRunner() }, "acme/widgets", "/tmp/x");
    expect(calls).toEqual([["audit", "--json"]]);
  });
});
