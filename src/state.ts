// Run telemetry only. GitHub is the record of truth for the conversation; this
// database is what the dashboard reads to draw the board, and what watch.ts
// reads to know what it already did. Safe to delete: `factory reset` wipes it.

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { EventBudget, MAX_EVENT_LOG_BYTES, TRUNCATION_KIND } from "./event-budget";
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

// One row per stage attempt. `runs` holds the latest state of an issue, so a
// retry overwrote what the last attempt cost; this table keeps every attempt.
export interface StageRun {
  id: number;
  repo: string;
  issue: number;
  stage: Stage;
  agent: string;
  model: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  tool_calls: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  cost_usd: number;
  // 0 when tokens or cost are not a full count; the dashboard shows "Not reported".
  usage_complete: number;
  exit_code: number;
  killed_reason: string | null;
}

// The two v2.5.1 columns default to 0 cached tokens and a complete count.
export type StageRunInput = Omit<StageRun, "id" | "tokens_cached" | "usage_complete"> & Partial<Pick<StageRun, "tokens_cached" | "usage_complete">>;

// Absolute, rooted at FACTORY_HOME (~/.factory by default, /data in Docker) —
// see paths.ts. A relative path here broke on any machine where the process
// cwd wasn't the target repo (audit finding #1).
export const DEFAULT_DB_PATH = defaultStatePath();

export class FactoryState {
  private readonly db: Database;

  constructor(path: string = DEFAULT_DB_PATH) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    // The runner and the dashboard open a fresh database at the same moment after a reset.
    // Retry a locked open, and migrate in one write transaction so neither sees half a schema.
    this.db.exec("PRAGMA busy_timeout = 5000;");
    for (let attempt = 0; ; attempt++) {
      try {
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.transaction(() => this.migrate()).immediate();
        return;
      } catch (e) {
        if (attempt >= 20 || !/locked|busy/i.test(String(e))) throw e;
        Bun.sleepSync(25 * (attempt + 1));
      }
    }
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
      CREATE TABLE IF NOT EXISTS stage_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo TEXT NOT NULL,
        issue INTEGER NOT NULL,
        stage TEXT NOT NULL,
        agent TEXT NOT NULL,
        model TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        tool_calls INTEGER NOT NULL DEFAULT 0,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        exit_code INTEGER NOT NULL,
        killed_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS stage_runs_repo_issue_id ON stage_runs(repo, issue, id);
      CREATE TABLE IF NOT EXISTS toggles (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // Forward-only and idempotent: safe to run on boot from several replicas.
    const have = new Set((this.db.query("PRAGMA table_info(stage_runs)").all() as { name: string }[]).map((c) => c.name));
    for (const [col, ddl] of [
      ["tokens_cached", "INTEGER NOT NULL DEFAULT 0"],
      ["usage_complete", "INTEGER NOT NULL DEFAULT 1"],
    ] as const) {
      if (have.has(col)) continue;
      try {
        this.db.exec(`ALTER TABLE stage_runs ADD COLUMN ${col} ${ddl}`);
      } catch (e) {
        if (!/duplicate column/i.test(String(e))) throw e;
      }
    }
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

  private readonly budgets = new Map<number, EventBudget>();
  // Per-run cap on stored event bytes (machinist events.go); tests lower it.
  eventByteLimit = MAX_EVENT_LOG_BYTES;

  appendEvent(runId: number, stage: Stage, kind: string, text: string): void {
    let budget = this.budgets.get(runId);
    if (!budget) {
      const row = this.db.query("SELECT COALESCE(SUM(LENGTH(CAST(text AS BLOB)) + LENGTH(kind)), 0) AS n FROM events WHERE run_id = $id").get({ $id: runId }) as { n: number };
      budget = new EventBudget(row.n, this.eventByteLimit);
      this.budgets.set(runId, budget);
    }
    const verdict = budget.admit(Buffer.byteLength(text) + kind.length);
    if (verdict === "drop") return;
    if (verdict === "truncate") {
      kind = TRUNCATION_KIND;
      text = budget.message();
    }
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

  recordStageRun(input: StageRunInput): void {
    this.db
      .query(
        `INSERT INTO stage_runs (repo, issue, stage, agent, model, started_at, finished_at, duration_ms, tool_calls, tokens_in, tokens_out, tokens_cached, cost_usd, usage_complete, exit_code, killed_reason)
         VALUES ($repo, $issue, $stage, $agent, $model, $started_at, $finished_at, $duration_ms, $tool_calls, $tokens_in, $tokens_out, $tokens_cached, $cost_usd, $usage_complete, $exit_code, $killed_reason)`,
      )
      .run({
        $repo: input.repo,
        $issue: input.issue,
        $stage: input.stage,
        $agent: input.agent,
        $model: input.model,
        $started_at: input.started_at,
        $finished_at: input.finished_at,
        $duration_ms: input.duration_ms,
        $tool_calls: input.tool_calls,
        $tokens_in: input.tokens_in,
        $tokens_out: input.tokens_out,
        $tokens_cached: input.tokens_cached ?? 0,
        $cost_usd: input.cost_usd,
        $usage_complete: input.usage_complete ?? 1,
        $exit_code: input.exit_code,
        $killed_reason: input.killed_reason,
      });
  }

  // Keyset pagination on id, like listEvents: pass the last id seen.
  listStageRuns(repo: string, opts?: { issue?: number; after?: number; limit?: number }): StageRun[] {
    const limit = opts?.limit ?? 200;
    const after = opts?.after ?? 0;
    if (opts?.issue !== undefined) {
      return this.db
        .query("SELECT * FROM stage_runs WHERE repo = $repo AND issue = $issue AND id > $after ORDER BY id ASC LIMIT $limit")
        .all({ $repo: repo, $issue: opts.issue, $after: after, $limit: limit }) as StageRun[];
    }
    return this.db
      .query("SELECT * FROM stage_runs WHERE repo = $repo AND id > $after ORDER BY id ASC LIMIT $limit")
      .all({ $repo: repo, $after: after, $limit: limit }) as StageRun[];
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
