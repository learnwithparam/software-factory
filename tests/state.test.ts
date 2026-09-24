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
