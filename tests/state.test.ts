import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FactoryState, type StageRunInput } from "../src/state";

const dir = mkdtempSync(join(tmpdir(), "factory-state-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const row = (issue: number, over: Partial<StageRunInput> = {}): StageRunInput => ({
  repo: "acme/widgets", issue, stage: "build", agent: "claude", model: null,
  started_at: "2026-01-01T00:00:00.000Z", finished_at: "2026-01-01T00:00:02.000Z", duration_ms: 2000,
  tool_calls: 3, tokens_in: 10, tokens_out: 20, cost_usd: 0.5, exit_code: 0, killed_reason: null, ...over,
});

test("stage_runs keeps every attempt of a stage, where runs keeps only the latest", () => {
  const state = new FactoryState(":memory:");
  state.upsertRun({ issue: 1, repo: "acme/widgets", title: "t", stage: "build", status: "running" });
  state.recordStageRun(row(1, { exit_code: 1, killed_reason: "timeout" }));
  state.recordStageRun(row(1));
  const rows = state.listStageRuns("acme/widgets", { issue: 1 });
  expect(rows.map((r) => [r.stage, r.exit_code, r.killed_reason])).toEqual([["build", 1, "timeout"], ["build", 0, null]]);
  expect(state.listRuns()).toHaveLength(1);
  state.close();
});

test("stage_runs pages by keyset across more than one page and filters by repo", () => {
  const state = new FactoryState(":memory:");
  for (let i = 0; i < 25; i += 1) state.recordStageRun(row(i + 1));
  state.recordStageRun(row(1, { repo: "other/repo" }));
  const first = state.listStageRuns("acme/widgets", { limit: 10 });
  const second = state.listStageRuns("acme/widgets", { limit: 10, after: first.at(-1)!.id });
  const third = state.listStageRuns("acme/widgets", { limit: 10, after: second.at(-1)!.id });
  expect([first.length, second.length, third.length]).toEqual([10, 10, 5]);
  expect(new Set([...first, ...second, ...third].map((r) => r.id)).size).toBe(25);
  state.close();
});

test("migrating twice, and on a database from v2.2 without stage_runs, keeps the data", () => {
  const path = join(dir, "old.db");
  const old = new Database(path);
  old.exec("CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, issue INTEGER NOT NULL, repo TEXT NOT NULL, title TEXT NOT NULL, stage TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, tool_calls INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, gate_line TEXT, pr_url TEXT, reason TEXT, status_comment_id INTEGER, UNIQUE(repo, issue))");
  old.exec("INSERT INTO runs (issue, repo, title, stage, status, started_at, updated_at) VALUES (7, 'acme/widgets', 'kept', 'plan', 'shipped', 'a', 'b')");
  old.close();
  new FactoryState(path).close();
  const state = new FactoryState(path);
  expect(state.getRun("acme/widgets", 7)!.title).toBe("kept");
  state.recordStageRun(row(7));
  expect(state.listStageRuns("acme/widgets")).toHaveLength(1);
  state.close();
});

test("a v2.5.0 stage_runs table gains tokens_cached and usage_complete once, keeping its rows", () => {
  const path = join(dir, "v250.db");
  const old = new Database(path);
  old.exec("CREATE TABLE stage_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, repo TEXT NOT NULL, issue INTEGER NOT NULL, stage TEXT NOT NULL, agent TEXT NOT NULL, model TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, tool_calls INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, exit_code INTEGER NOT NULL, killed_reason TEXT)");
  old.exec("INSERT INTO stage_runs (repo, issue, stage, agent, started_at, finished_at, duration_ms, exit_code) VALUES ('acme/widgets', 7, 'plan', 'claude', 'a', 'b', 1, 0)");
  old.close();
  for (let i = 0; i < 2; i++) new FactoryState(path).close();
  const state = new FactoryState(path);
  const [kept] = state.listStageRuns("acme/widgets");
  expect([kept!.tokens_cached, kept!.usage_complete]).toEqual([0, 1]);
  state.close();
});

test("an old NOT NULL cost_usd column is rebuilt nullable, twice over, and an unknown cost stays NULL", () => {
  const path = join(dir, "v251.db");
  const old = new Database(path);
  old.exec("CREATE TABLE stage_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, repo TEXT NOT NULL, issue INTEGER NOT NULL, stage TEXT NOT NULL, agent TEXT NOT NULL, model TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, duration_ms INTEGER NOT NULL, tool_calls INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, exit_code INTEGER NOT NULL, killed_reason TEXT, tokens_cached INTEGER NOT NULL DEFAULT 0, usage_complete INTEGER NOT NULL DEFAULT 1)");
  old.exec("INSERT INTO stage_runs (repo, issue, stage, agent, started_at, finished_at, duration_ms, cost_usd, exit_code, usage_complete) VALUES ('acme/widgets', 7, 'plan', 'claude', 'a', 'b', 1, 0.25, 0, 1), ('acme/widgets', 7, 'build', 'codex', 'a', 'b', 1, 0, 0, 0)");
  old.close();
  for (let i = 0; i < 2; i++) new FactoryState(path).close();
  const state = new FactoryState(path);
  state.recordStageRun(row(8, { cost_usd: null, usage_complete: 0 }));
  const costs = state.listStageRuns("acme/widgets").map((r) => r.cost_usd);
  expect(costs).toEqual([0.25, null, null]);
  state.close();
  const check = new Database(path);
  expect(check.query("PRAGMA index_list(stage_runs)").all().map((i) => (i as { name: string }).name)).toContain("stage_runs_repo_issue_id");
  check.close();
});

test("two processes opening a fresh database at once both get the full schema", async () => {
  const dir = mkdtempSync(join(tmpdir(), "factory-race-"));
  const path = join(dir, "factory.db");
  const script = `import { FactoryState } from ${JSON.stringify(join(import.meta.dir, "../src/state"))}; const s = new FactoryState(${JSON.stringify(path)}); s.listEvents(1); s.listStageRuns("r");`;
  for (let round = 0; round < 5; round++) {
    const target = `${path}${round}`;
    const src = script.replaceAll(JSON.stringify(path), JSON.stringify(target));
    const procs = Array.from({ length: 16 }, () => Bun.spawn(["bun", "-e", src], { stderr: "pipe" }));
    const codes = await Promise.all(procs.map((p) => p.exited));
    const errs = await Promise.all(procs.map((p) => new Response(p.stderr).text()));
    expect({ codes, errs: errs.filter(Boolean) }).toEqual({ codes: Array(16).fill(0), errs: [] });
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a run's event budget is released when the run stops running, and a resume keeps its bound", () => {
  const state = new FactoryState(":memory:");
  state.eventByteLimit = 2 << 10;
  const run = state.upsertRun({ issue: 1, repo: "a/b", title: "t", stage: "build", status: "running" });
  for (let i = 0; i < 500; i++) state.appendEvent(run.id, "build", "text", "x");
  expect(state.openBudgets).toBe(1);
  state.updateRun("a/b", 1, { status: "failed" });
  expect(state.openBudgets).toBe(0);
  for (let i = 0; i < 500; i++) state.appendEvent(run.id, "build", "text", "x");
  const stored = state.listEvents(run.id, { limit: 5000 }).reduce((n, e) => n + e.text.length + e.kind.length, 0);
  expect(stored).toBeLessThanOrEqual(2 << 10);
  state.close();
});
