// Structural: every dashboard route sits in one table, and with a token set
// each one is refused without credentials unless it is on the public
// allow-list. A new route cannot ship open by accident. Also covers the new
// read and write routes (inbox, analytics, stages, artifacts).

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHub, type GhIssue } from "../src/github";
import { LABEL } from "../src/labels";
import { FactoryState, type StageRunInput } from "../src/state";

class FakeGitHub extends GitHub {
  posted: { issue: number; body: string }[] = [];
  constructor(private readonly issues: GhIssue[] = []) {
    super();
  }
  override async listOpenIssues(): Promise<GhIssue[]> {
    return this.issues;
  }
  override async getIssue(_repo: string, number: number): Promise<GhIssue> {
    return this.issues.find((i) => i.number === number)!;
  }
  override async commentIssue(_repo: string, issue: number, body: string): Promise<number | undefined> {
    this.posted.push({ issue, body });
    return 1;
  }
}

const waiting = (n: number, label: string): GhIssue => ({
  number: n,
  title: `Issue ${n}`,
  body: "",
  labels: [{ name: label }],
  comments: [{ id: n, author: "bot", authorAssociation: "NONE", body: "<!-- factory:plan v1 -->\nThe plan\u001b[31m", createdAt: "2026-09-20T10:00:00Z" }],
});

const TOKEN = "s3cret-token";
const scratch = mkdtempSync(join(tmpdir(), "factory-routes-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function make(token: string, issues: GhIssue[] = []) {
  const before = process.env.FACTORY_DASHBOARD_TOKEN;
  process.env.FACTORY_DASHBOARD_TOKEN = token;
  try {
    const mod = await import(`../dashboard/server.ts?token=${token || "none"}`);
    const state = new FactoryState(":memory:");
    const github = new FakeGitHub(issues);
    return { mod, state, github, dashboard: mod.createDashboard(state, github, "acme/widgets", false, scratch) };
  } finally {
    if (before === undefined) delete process.env.FACTORY_DASHBOARD_TOKEN;
    else process.env.FACTORY_DASHBOARD_TOKEN = before;
  }
}

const samplePath = (label: string) => label.split(" ")[1]!.replace(":n", "1").replace(":id", "1");
const call = (label: string, headers: Record<string, string> = {}) => {
  const [method, ] = label.split(" ");
  return new Request(`http://localhost:4100${samplePath(label)}`, {
    method,
    headers: { ...(method === "POST" ? { "content-type": "application/json" } : {}), ...headers },
    body: method === "POST" ? "{}" : undefined,
  });
};

describe("route walk", () => {
  test("with a token set, every route except the public allow-list is 401 without credentials", async () => {
    const { mod, dashboard } = await make(TOKEN);
    expect(dashboard.routeLabels.length).toBeGreaterThan(10);
    for (const p of mod.PUBLIC_ROUTES) expect(dashboard.routeLabels, p).toContain(p);
    for (const label of dashboard.routeLabels as string[]) {
      if (mod.PUBLIC_ROUTES.includes(label)) continue;
      for (const ip of ["127.0.0.1", "203.0.113.7"]) {
        const res = await dashboard.handle(call(label), ip);
        expect(res.status, `${label} from ${ip}`).toBe(401);
      }
    }
    // An unknown path is refused before it can 404, so routes cannot be probed.
    expect((await dashboard.handle(new Request("http://localhost:4100/api/nope"), "203.0.113.7")).status).toBe(401);
  });

  test("the token in a query string no longer works; the header and the session cookie do", async () => {
    const { dashboard } = await make(TOKEN);
    const at = (path: string, headers: Record<string, string> = {}) => dashboard.handle(new Request(`http://localhost:4100${path}`, { headers }), "203.0.113.7");
    expect((await at(`/api/runs?token=${TOKEN}`)).status).toBe(401);
    expect((await at("/api/runs", { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
    expect((await at("/api/runs", { authorization: "Bearer wrong-token-value" })).status).toBe(401);

    const bad = await dashboard.handle(call("POST /api/session"), "203.0.113.7");
    expect(bad.status).toBe(401);
    const login = await dashboard.handle(
      new Request("http://localhost:4100/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) }),
      "203.0.113.7",
    );
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect((await at("/api/runs", { cookie: setCookie.split(";")[0]! })).status).toBe(200);
  });

  test("no token set: a non-loopback caller is refused outright, even on the public routes", async () => {
    const { dashboard } = await make("");
    expect((await dashboard.handle(call("GET /"), "203.0.113.7")).status).toBe(503);
  });
});

describe("inbox routes", () => {
  test("lists what waits and posts the same comment a human would", async () => {
    const { dashboard, github } = await make("", [waiting(3, LABEL.awaitingApproval), waiting(4, LABEL.building)]);
    const list = (await (await dashboard.handle(call("GET /api/inbox"), "127.0.0.1")).json()) as { items: { issue: number; ask: string; actions: string[] }[] };
    expect(list.items.map((i) => i.issue)).toEqual([3]);
    expect(list.items[0]!.ask).toBe("The plan");

    const act = (n: number, body: unknown) =>
      dashboard.handle(new Request(`http://localhost:4100/api/inbox/${n}/act`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), "127.0.0.1");
    expect((await act(3, { action: "approve" })).status).toBe(200);
    expect(github.posted).toEqual([{ issue: 3, body: "/factory approve" }]);
    expect((await act(3, { action: "retry" })).status).toBe(400);
    expect((await act(3, { action: "revise", text: " " })).status).toBe(400);
    expect((await act(4, { action: "cancel" })).status).toBe(404);
    expect(github.posted).toHaveLength(1);
  });
});

describe("analytics and stages", () => {
  const stage = (i: number, agent: string): StageRunInput => ({
    repo: "acme/widgets", issue: 1 + (i % 3), stage: "build", agent, model: null, started_at: "2026-09-24T00:00:00Z",
    finished_at: new Date().toISOString(), duration_ms: 1000, tool_calls: 1, tokens_in: 10, tokens_out: 5, cost_usd: 0.01,
    exit_code: i % 10 === 0 ? 1 : 0, killed_reason: null,
  });

  test("sums more than one page (1100 attempts) and reports per agent", async () => {
    const { dashboard, state } = await make("");
    for (let i = 0; i < 1100; i++) state.recordStageRun(stage(i, i % 2 ? "claude" : "codex"));
    const a = (await (await dashboard.handle(call("GET /api/analytics"), "127.0.0.1")).json()) as {
      spend7dUsd: number; byStage: { attempts: number }[]; byAgent: { key: string; attempts: number; failures: number }[];
    };
    expect(a.byStage[0]!.attempts).toBe(1100);
    expect(a.byAgent.map((b) => [b.key, b.attempts])).toEqual([["claude", 550], ["codex", 550]]);
    expect(a.spend7dUsd).toBeCloseTo(11, 5);
    expect(a.byAgent.reduce((n, b) => n + b.failures, 0)).toBe(110);
  });

  test("run stages come back for a known run and 404 for an unknown one", async () => {
    const { dashboard, state } = await make("");
    state.upsertRun({ issue: 1, repo: "acme/widgets", title: "t", stage: "build", status: "running" });
    state.recordStageRun(stage(3, "claude"));
    const run = state.listRuns("acme/widgets")[0]!;
    const ok = (await (await dashboard.handle(new Request(`http://localhost:4100/api/runs/${run.id}/stages`), "127.0.0.1")).json()) as { stages?: unknown[] };
    expect(ok.stages).toHaveLength(1);
    expect((await dashboard.handle(new Request("http://localhost:4100/api/runs/999/stages"), "127.0.0.1")).status).toBe(404);
  });
});

describe("artifacts", () => {
  const dir = join(scratch, "issue-9", ".factory", "runs", "issue-9");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plan.md"), "<script>alert(1)</script>");
  writeFileSync(join(dir, "big.log"), "x".repeat(1024 * 1024 + 10));
  writeFileSync(join(scratch, "secret.txt"), "outside");
  symlinkSync(join(scratch, "secret.txt"), join(dir, "link.txt"));
  const get = async (q: string) => {
    const { dashboard } = await make("");
    return dashboard.handle(new Request(`http://localhost:4100/api/issues/9/artifacts${q}`), "127.0.0.1");
  };

  test("lists regular files, sends text only with sandbox headers, caps at 1 MiB, downloads as attachment", async () => {
    const list = (await (await get("")).json()) as { files: { name: string }[] };
    expect(list.files.map((f) => f.name).sort()).toEqual(["big.log", "plan.md"]) // the symlink is not listed;
    const res = await get("?file=plan.md");
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(await res.text()).toBe("<script>alert(1)</script>");
    const big = await get("?file=big.log");
    expect(big.headers.get("x-artifact-truncated")).toBe("true");
    expect((await big.arrayBuffer()).byteLength).toBe(1024 * 1024);
    expect((await get("?file=plan.md&download=1")).headers.get("content-disposition")).toContain("attachment");
  });

  test("refuses traversal and a symlink that leaves the run directory", async () => {
    for (const f of ["../../../../secret.txt", "..%2Fsecret.txt", "link.txt", "missing.md"]) {
      expect((await get(`?file=${f}`)).status, f).toBe(404);
    }
  });

  test("an issue with no worktree lists nothing", async () => {
    const { dashboard } = await make("");
    const res = await dashboard.handle(new Request("http://localhost:4100/api/issues/77/artifacts"), "127.0.0.1");
    expect(await res.json()).toEqual({ files: [] });
  });
});

describe("line and assets", () => {
  test("/api/line lists one row per run with its stages", async () => {
    const { dashboard, state } = await make("");
    state.upsertRun({ issue: 1, repo: "acme/widgets", title: "t", stage: "build", status: "running" });
    state.recordStageRun({
      repo: "acme/widgets", issue: 1, stage: "triage", agent: "claude", model: null, started_at: "2026-09-24T00:00:00Z",
      finished_at: "2026-09-24T00:00:05Z", duration_ms: 5000, tool_calls: 1, tokens_in: 1, tokens_out: 1, cost_usd: 0.01, exit_code: 0, killed_reason: null,
    });
    const body = (await (await dashboard.handle(call("GET /api/line"), "127.0.0.1")).json()) as { rows: { stages: { stage: string; ok: boolean }[] }[] };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]!.stages).toMatchObject([{ stage: "triage", ok: true }]);
  });

  test("assets are public, typed, and never escape dashboard/public", async () => {
    const { dashboard } = await make(TOKEN);
    const css = await dashboard.handle(new Request("http://localhost:4100/styles.css"), "10.0.0.9");
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    const font = await dashboard.handle(new Request("http://localhost:4100/fonts/manrope-latin.woff2"), "10.0.0.9");
    expect(font.headers.get("content-type")).toContain("font/woff2");
    expect((await dashboard.handle(new Request("http://localhost:4100/lib/..%2Fserver.js"), "10.0.0.9")).status).toBe(401);
  });
});

describe("session cookie and terminal-safe text", () => {
  const ESC = "\u001b[31m";

  test("the cookie is a random id, not the token, and it is not accepted as a Bearer token", async () => {
    const { dashboard } = await make(TOKEN);
    const login = async () =>
      dashboard.handle(new Request("http://localhost:4100/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) }), "203.0.113.7");
    const one = (await login()).headers.get("set-cookie")!;
    const two = (await login()).headers.get("set-cookie")!;
    expect(one).not.toContain(TOKEN);
    expect(one.split(";")[0]).not.toBe(two.split(";")[0]);
    const id = one.split(";")[0]!.split("=")[1]!;
    const at = (headers: Record<string, string>) => dashboard.handle(new Request("http://localhost:4100/api/runs", { headers }), "203.0.113.7");
    expect((await at({ authorization: `Bearer ${id}` })).status).toBe(401);
    expect((await at({ cookie: `factory_session=${TOKEN}` })).status).toBe(401);
    expect((await at({ cookie: `factory_session=${id}` })).status).toBe(200);
  });

  test("thread, run titles and artifact previews carry no terminal escapes; a download stays raw", async () => {
    const issue: GhIssue = { number: 1, title: `T${ESC}`, body: `B${ESC}`, labels: [], comments: [{ id: 1, author: "a", authorAssociation: "NONE", body: `C${ESC}`, createdAt: "2026-09-20T10:00:00Z" }] };
    const { dashboard, state } = await make("", [issue]);
    state.upsertRun({ issue: 1, repo: "acme/widgets", title: `Run${ESC}`, stage: "build", status: "running" });
    const dir = join(scratch, "issue-1", ".factory", "runs", "issue-1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plan.md"), `plan${ESC}`);
    const get = async (path: string) => dashboard.handle(new Request(`http://localhost:4100${path}`), "127.0.0.1");
    for (const path of ["/api/runs", "/api/issues/1/thread", "/api/issues/1/artifacts?file=plan.md", "/api/line"]) expect(await (await get(path)).text(), path).not.toContain("\u001b");
    expect(await (await get("/api/issues/1/artifacts?file=plan.md&download=1")).text()).toContain("\u001b");
  });
});
