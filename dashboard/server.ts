// The cockpit (plan section 2). Bun.serve, one static page, JSON API + SSE
// read from state.ts. No second source of truth: this server never invents
// state, it reads what watch.ts wrote and posts replies through github.ts as
// the signed-in `gh` user. /api/board is the exception on purpose — it
// reads GitHub labels directly (dashboard/board.ts), so the board still
// works with no local SQLite at all (a CI/VM run with no watcher on this
// machine).

import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GitHub } from "../src/github";
import { FactoryState, DEFAULT_DB_PATH } from "../src/state";
import { parseChatOps } from "../src/chatops";
import { buildBoard } from "./board";
import { LABEL } from "../src/labels";
import { InboxError, act, buildInbox, type InboxAction } from "../src/inbox";
import { plain } from "../src/display";
import { workspacesDir } from "../src/paths";
import { runDir } from "../src/artifacts";
import { analytics } from "./analytics";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FACTORY_DASHBOARD_PORT ?? 4100);
const DB_PATH = process.env.FACTORY_DB_PATH ?? DEFAULT_DB_PATH;
const REPO = process.env.FACTORY_REPO ?? "";
// Audit finding #16: the dashboard binds 127.0.0.1 by default (see the bottom
// of this file) and refuses a non-loopback caller unless this token is set.
// Read at module scope so createDashboard and bin/factory's cmdDashboard
// both pick it up from the process env.
const DASHBOARD_TOKEN = process.env.FACTORY_DASHBOARD_TOKEN ?? "";
const BOARD_CACHE_MS = 10_000;

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

// Compare digests so the check takes the same time wherever the strings differ.
export function tokenMatches(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const SESSION_COOKIE = "factory_session";

function cookie(req: Request, name: string): string {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

// The only routes reachable without a token. Everything else is default-deny;
// tests/dashboard-routes.test.ts walks every route against this list.
export const PUBLIC_ROUTES: readonly string[] = ["GET /", "GET /assets", "POST /api/session"];

const ASSET_TYPES: Record<string, string> = { css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", woff2: "font/woff2" };

export const ARTIFACT_LIMIT = 1024 * 1024;

export function createDashboard(state: FactoryState, github: GitHub, repo: string, autoApproveDefault = false, workspaces = workspacesDir()) {
  const indexHtml = readFileSync(join(here, "public", "index.html"), "utf8");

  let boardCache: { at: number; issues: Awaited<ReturnType<GitHub["listOpenIssues"]>> } | null = null;
  let boardInflight: Promise<Awaited<ReturnType<GitHub["listOpenIssues"]>>> | null = null;

  // Single-flight + 10s cache in front of `gh issue list` (plan: "cached gh
  // listing, single-flight, 10s") so a browser polling every few seconds,
  // times any number of open tabs, doesn't turn into one `gh` call per poll.
  async function cachedIssues() {
    const now = Date.now();
    if (boardCache && now - boardCache.at < BOARD_CACHE_MS) return boardCache.issues;
    if (boardInflight) return boardInflight;
    boardInflight = github
      .listOpenIssues(repo)
      .then((issues) => {
        boardCache = { at: Date.now(), issues };
        boardInflight = null;
        return issues;
      })
      .catch((err) => {
        boardInflight = null;
        throw err;
      });
    return boardInflight;
  }

  function json(data: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(data), {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  }

  // Every stage attempt for a repo, paged by keyset so a long history is never one giant read.
  function allStageRuns(): ReturnType<FactoryState["listStageRuns"]> {
    const out: ReturnType<FactoryState["listStageRuns"]> = [];
    for (let after = 0; ; ) {
      const page = state.listStageRuns(repo, { after, limit: 500 });
      out.push(...page);
      if (page.length < 500) return out;
      after = page[page.length - 1]!.id;
    }
  }

  const needRepo = (): Response | null => (repo ? null : json({ error: "FACTORY_REPO not set" }, { status: 500 }));

  async function inboxItem(number: number) {
    return buildInbox(await cachedIssues()).find((i) => i.issue === number);
  }

  // Files a stage left in .factory/runs/issue-N/ of the issue's worktree. The
  // name must be a plain file name that resolves inside that directory, and it
  // is only ever sent as text, never as HTML.
  function artifactRoot(issue: number): string | null {
    try {
      return realpathSync(join(workspaces, `issue-${issue}`, runDir(issue)));
    } catch {
      return null;
    }
  }

  function artifacts(issue: number, url: URL): Response {
    const root = artifactRoot(issue);
    const name = url.searchParams.get("file");
    if (!root) return json({ files: [] });
    if (!name) {
      const files = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => ({ name: e.name, size: statSync(join(root, e.name)).size }));
      return json({ files });
    }
    let path: string;
    try {
      path = realpathSync(join(root, name));
    } catch {
      return json({ error: "no such artifact" }, { status: 404 });
    }
    if (name.includes("/") || name.includes("\\") || !path.startsWith(root + sep) || !statSync(path).isFile()) {
      return json({ error: "no such artifact" }, { status: 404 });
    }
    const bytes = readFileSync(path);
    const truncated = bytes.length > ARTIFACT_LIMIT;
    const body = bytes.subarray(0, ARTIFACT_LIMIT);
    const headers: Record<string, string> = {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-artifact-truncated": String(truncated),
    };
    if (url.searchParams.get("download")) headers["content-disposition"] = `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`;
    return new Response(body, { headers });
  }

  type Handler = (req: Request, url: URL, m: RegExpMatchArray) => Response | Promise<Response>;
  interface Route {
    readonly method: "GET" | "POST";
    readonly pattern: RegExp;
    readonly label: string;
    readonly handler: Handler;
  }

  // The routing table is the only place a route exists, so the route-walk test
  // (tests/dashboard-routes.test.ts) sees every one of them.
  const routes: readonly Route[] = [
    { method: "GET", pattern: /^\/(index\.html)?$/, label: "GET /", handler: () => new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } }) },
    {
      // Static files of the page itself: no data, so public like the shell.
      method: "GET",
      pattern: /^\/(styles\.css|app\.js|lib\/[\w-]+\.js|fonts\/[\w-]+\.woff2)$/,
      label: "GET /assets",
      handler: (_req, _url, m) => {
        try {
          const bytes = readFileSync(join(here, "public", m[1]!));
          return new Response(bytes, { headers: { "content-type": ASSET_TYPES[m[1]!.split(".").pop()!]!, "cache-control": "no-cache" } });
        } catch {
          return json({ error: "not found" }, { status: 404 });
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/session$/,
      label: "POST /api/session",
      // Trade the token for an HttpOnly cookie so a browser never puts it in a URL.
      handler: async (req) => {
        const body = (await req.json().catch(() => ({}))) as { token?: string };
        if (!DASHBOARD_TOKEN || typeof body.token !== "string" || !tokenMatches(body.token, DASHBOARD_TOKEN)) {
          return json({ error: "unauthorized" }, { status: 401 });
        }
        return json({ ok: true }, { headers: { "set-cookie": `${SESSION_COOKIE}=${DASHBOARD_TOKEN}; HttpOnly; SameSite=Strict; Path=/` } });
      },
    },
    { method: "GET", pattern: /^\/api\/runs$/, label: "GET /api/runs", handler: () => json({ repo, runs: state.listRuns(repo || undefined) }) },
    {
      method: "GET",
      pattern: /^\/api\/board$/,
      label: "GET /api/board",
      handler: async () => needRepo() ?? json({ repo, cards: buildBoard(await cachedIssues()) }),
    },
    {
      method: "POST",
      pattern: /^\/api\/mark-ready$/,
      label: "POST /api/mark-ready",
      handler: async (req) => {
        const body = (await req.json()) as { issue?: number };
        const missing = needRepo();
        if (missing) return missing;
        if (!Number.isInteger(body.issue)) return json({ error: "issue must be an integer" }, { status: 400 });
        await github.addLabels(repo, body.issue!, [LABEL.ready]);
        boardCache = null; // next /api/board reflects the label immediately
        return json({ ok: true });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/issues\/(\d+)\/thread$/,
      label: "GET /api/issues/:n/thread",
      handler: async (_req, _url, m) => needRepo() ?? json({ issue: await github.getIssue(repo, Number(m[1])) }),
    },
    {
      method: "GET",
      pattern: /^\/api\/issues\/(\d+)\/artifacts$/,
      label: "GET /api/issues/:n/artifacts",
      handler: (_req, url, m) => artifacts(Number(m[1]), url),
    },
    {
      method: "GET",
      pattern: /^\/api\/runs\/(\d+)\/events$/,
      label: "GET /api/runs/:id/events",
      handler: (_req, url, m) => {
        const events = state.listEvents(Number(m[1]), { after: Number(url.searchParams.get("after") ?? "0") });
        return json({ events: events.map((e) => ({ ...e, text: plain(e.text) })) });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/runs\/(\d+)\/stages$/,
      label: "GET /api/runs/:id/stages",
      handler: (_req, _url, m) => {
        const run = state.listRuns(repo || undefined).find((r) => r.id === Number(m[1]));
        if (!run) return json({ error: "no such run" }, { status: 404 });
        return json({ run, stages: state.listStageRuns(run.repo, { issue: run.issue }) });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/line$/,
      label: "GET /api/line",
      // Each recent run with the stages it went through, for the Line view.
      handler: () => {
        const attempts = repo ? allStageRuns() : [];
        const runs = state.listRuns(repo || undefined).slice(0, 100);
        return json({
          repo,
          rows: runs.map((run) => ({
            run,
            stages: attempts
              .filter((a) => a.issue === run.issue)
              .map((a) => ({ stage: a.stage, agent: a.agent, duration_ms: a.duration_ms, cost_usd: a.cost_usd, ok: a.exit_code === 0 && !a.killed_reason })),
          })),
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/analytics$/,
      label: "GET /api/analytics",
      handler: () => json(analytics(state.listRuns(repo || undefined), repo ? allStageRuns() : [])),
    },
    {
      method: "GET",
      pattern: /^\/api\/inbox$/,
      label: "GET /api/inbox",
      handler: async () => needRepo() ?? json({ repo, items: buildInbox(await cachedIssues()) }),
    },
    {
      method: "POST",
      pattern: /^\/api\/inbox\/(\d+)\/act$/,
      label: "POST /api/inbox/:n/act",
      handler: async (req, _url, m) => {
        const missing = needRepo();
        if (missing) return missing;
        const body = (await req.json()) as { action?: InboxAction; text?: string };
        const item = await inboxItem(Number(m[1]));
        if (!item) return json({ error: "nothing is waiting on that issue" }, { status: 404 });
        try {
          const posted = await act(github, repo, item, body.action as InboxAction, body.text ?? "");
          boardCache = null;
          return json({ ok: true, posted });
        } catch (err) {
          if (err instanceof InboxError) return json({ error: err.message }, { status: 400 });
          throw err;
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/toggles$/,
      label: "GET /api/toggles",
      handler: () =>
        json({
          auto_start: state.getToggle("auto_start", true),
          auto_approve_low_risk: state.getToggle("auto_approve_low_risk", autoApproveDefault),
        }),
    },
    {
      method: "POST",
      pattern: /^\/api\/toggles$/,
      label: "POST /api/toggles",
      handler: async (req) => {
        const body = (await req.json()) as { key: string; value: boolean };
        if (body.key !== "auto_start" && body.key !== "auto_approve_low_risk") return json({ error: "unknown toggle" }, { status: 400 });
        state.setToggle(body.key, Boolean(body.value));
        return json({ ok: true });
      },
    },
    // Reply box and the action buttons post the same text a human would type in
    // the issue thread, so untrusted-input handling stays in one place (watch.ts).
    {
      method: "POST",
      pattern: /^\/api\/reply$/,
      label: "POST /api/reply",
      handler: async (req) => {
        const body = (await req.json()) as { issue: number; text: string };
        const missing = needRepo();
        if (missing) return missing;
        await github.commentIssue(repo, body.issue, body.text);
        return json({ ok: true });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/command$/,
      label: "POST /api/command",
      handler: async (req) => {
        const body = (await req.json()) as { issue: number; command: "approve" | "revise" | "retry" | "cancel"; text?: string };
        const missing = needRepo();
        if (missing) return missing;
        const text = body.command === "revise" ? `/factory revise ${body.text ?? ""}` : `/factory ${body.command}`;
        // Round-trip through parseChatOps so a malformed command from the UI
        // fails the same way an equivalent typed comment would.
        if (parseChatOps(text).type === "answer") return json({ error: "not a recognized /factory command" }, { status: 400 });
        await github.commentIssue(repo, body.issue, text);
        return json({ ok: true });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/stream$/,
      label: "GET /api/stream",
      handler: (req) => {
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            const send = () => {
              const payload = JSON.stringify({ repo, runs: state.listRuns(repo || undefined) });
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            };
            send();
            const timer = setInterval(send, 2000);
            req.signal.addEventListener("abort", () => {
              clearInterval(timer);
              controller.close();
            });
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
      },
    },
  ];

  function authorized(req: Request): boolean {
    const header = req.headers.get("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : cookie(req, SESSION_COOKIE);
    return tokenMatches(presented, DASHBOARD_TOKEN);
  }

  // `remoteAddress` comes from `server.requestIP(req)` at the real Bun.serve
  // call site; undefined (unknown) is treated as NOT loopback: fail closed,
  // the same rule as guard-paths.sh.
  async function handle(req: Request, remoteAddress?: string): Promise<Response> {
    const url = new URL(req.url);
    const loopback = isLoopback(remoteAddress);
    const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    const isPublic = route !== undefined && PUBLIC_ROUTES.includes(route.label);

    if (!loopback && !DASHBOARD_TOKEN) {
      return json({ error: "refused: reachable from a non-loopback address with no FACTORY_DASHBOARD_TOKEN set" }, { status: 503 });
    }
    // Token, when set, guards every non-public route for every caller, so an
    // unknown path is refused before it can 404 (no route probing).
    if (DASHBOARD_TOKEN && !isPublic && !authorized(req)) return json({ error: "unauthorized" }, { status: 401 });

    // CSRF: a mutating request must be same-origin JSON, never the
    // `text/plain` a plain HTML form can send cross-site without a preflight.
    if (req.method === "POST") {
      const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.startsWith("application/json")) return json({ error: "expected application/json" }, { status: 415 });
      const origin = req.headers.get("origin");
      if (origin) {
        let originHost: string;
        try {
          originHost = new URL(origin).host;
        } catch {
          return json({ error: "invalid Origin header" }, { status: 403 });
        }
        if (originHost !== url.host) return json({ error: "cross-origin request rejected" }, { status: 403 });
      }
    }

    if (!route) return json({ error: "not found" }, { status: 404 });
    return route.handler(req, url, url.pathname.match(route.pattern)!);
  }

  const routeLabels = routes.map((r) => r.label);

  return { handle, routeLabels };
}

if (import.meta.main) {
  const state = new FactoryState(DB_PATH);
  const github = new GitHub();
  const dashboard = createDashboard(state, github, REPO);
  // 127.0.0.1 by default (audit finding #16): reach it over the network only
  // by explicitly setting FACTORY_DASHBOARD_HOST=0.0.0.0 (the Docker image
  // does this and relies on FACTORY_DASHBOARD_TOKEN instead) or an SSH
  // tunnel, never by accident.
  const hostname = process.env.FACTORY_DASHBOARD_HOST ?? "127.0.0.1";
  const server = Bun.serve({
    port: PORT,
    hostname,
    fetch: (req: Request): Promise<Response> => dashboard.handle(req, server.requestIP(req)?.address),
  });
  console.log(`factory dashboard: http://${hostname}:${PORT} (repo=${REPO || "unset"})`);
}
