// Run telemetry only. GitHub is the record of truth for the conversation; this
// database is what the dashboard reads to draw the board, and what watch.ts
// reads to know what it already did. Safe to delete: `factory reset` wipes it.

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { defaultStatePath } from "./paths";

export type Stage = "triage" | "plan" | "build" | "verify" | "pr";
export type RunStatus =
  | "running"
  | "needs-info"
  | "awaiting-approval"
  | "verifying"
  | "rejected"
  | "shipped"
  | "failed"
  | "needs-human"
  | "cancelled";

export interface Run {
  id: number;
  issue: number;
  repo: string;
  title: string;
  stage: Stage;
  status: RunStatus;
  started_at: string;
  updated_at: string;
  tool_calls: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  gate_line: string | null;
  pr_url: string | null;
  reason: string | null;
  status_comment_id: number | null;
}

export interface RunEvent {
  id: number;
  run_id: number;
  ts: string;
  stage: Stage;
  kind: string;
  text: string;
}

// Absolute, rooted at FACTORY_HOME (~/.factory by default, /data in Docker) —
// see paths.ts. A relative path here broke on any machine where the process
// cwd wasn't the target repo (audit finding #1).
export const DEFAULT_DB_PATH = defaultStatePath();

export class FactoryState {
  private readonly db: Database;

  constructor(path: string = DEFAULT_DB_PATH) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue INTEGER NOT NULL,
        repo TEXT NOT NULL,
        title TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        gate_line TEXT,
        pr_url TEXT,
        reason TEXT,
        status_comment_id INTEGER,
        UNIQUE(repo, issue)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES runs(id),
        ts TEXT NOT NULL,
        stage TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_run_id_id ON events(run_id, id);
      CREATE TABLE IF NOT EXISTS toggles (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  upsertRun(input: {
    issue: number;
    repo: string;
    title: string;
    stage: Stage;
    status: RunStatus;
  }): Run {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO runs (issue, repo, title, stage, status, started_at, updated_at)
         VALUES ($issue, $repo, $title, $stage, $status, $now, $now)
         ON CONFLICT(repo, issue) DO UPDATE SET
           title = excluded.title,
           stage = excluded.stage,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .run({
        $issue: input.issue,
        $repo: input.repo,
        $title: input.title,
        $stage: input.stage,
        $status: input.status,
        $now: now,
      });
    return this.getRun(input.repo, input.issue)!;
  }

  updateRun(
    repo: string,
    issue: number,
    patch: Partial<
      Pick<
        Run,
        | "stage"
        | "status"
        | "tool_calls"
        | "tokens_in"
        | "tokens_out"
        | "cost_usd"
        | "gate_line"
        | "pr_url"
        | "reason"
        | "status_comment_id"
      >
    >,
  ): void {
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    const set = keys.map((k) => `${k} = $${k}`).join(", ");
    const params: Record<string, unknown> = { $repo: repo, $issue: issue, $updated_at: new Date().toISOString() };
    for (const k of keys) params[`$${k}`] = (patch as Record<string, unknown>)[k];
    // The bound keys are dynamic (built from `patch`), so bun:sqlite's
    // per-call ParamsType inference can't type this statically; the values
    // are already constrained to Run's own field types above.
    this.db
      .query(`UPDATE runs SET ${set}, updated_at = $updated_at WHERE repo = $repo AND issue = $issue`)
      .run(params as unknown as SQLQueryBindings);
  }

  getRun(repo: string, issue: number): Run | undefined {
    return (
      (this.db.query("SELECT * FROM runs WHERE repo = $repo AND issue = $issue").get({ $repo: repo, $issue: issue }) as
        | Run
        | undefined) ?? undefined
    );
  }

  listRuns(repo?: string): Run[] {
    if (repo) return this.db.query("SELECT * FROM runs WHERE repo = $repo ORDER BY updated_at DESC").all({ $repo: repo }) as Run[];
    return this.db.query("SELECT * FROM runs ORDER BY updated_at DESC").all() as Run[];
  }

  appendEvent(runId: number, stage: Stage, kind: string, text: string): void {
    this.db
      .query("INSERT INTO events (run_id, ts, stage, kind, text) VALUES ($run_id, $ts, $stage, $kind, $text)")
      .run({ $run_id: runId, $ts: new Date().toISOString(), $stage: stage, $kind: kind, $text: text });
  }

  // Keyset pagination: pass the last id seen, get events after it.
  listEvents(runId: number, opts?: { after?: number; limit?: number }): RunEvent[] {
    const after = opts?.after ?? 0;
    const limit = opts?.limit ?? 200;
    return this.db
      .query("SELECT * FROM events WHERE run_id = $run_id AND id > $after ORDER BY id ASC LIMIT $limit")
      .all({ $run_id: runId, $after: after, $limit: limit }) as RunEvent[];
  }

  getToggle(key: string, fallback: boolean): boolean {
    const row = this.db.query("SELECT value FROM toggles WHERE key = $key").get({ $key: key }) as
      | { value: string }
      | undefined;
    if (!row) return fallback;
    return row.value === "1";
  }

  setToggle(key: string, value: boolean): void {
    this.db
      .query("INSERT INTO toggles (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run({ $key: key, $value: value ? "1" : "0" });
  }

  close(): void {
    this.db.close();
  }
}
