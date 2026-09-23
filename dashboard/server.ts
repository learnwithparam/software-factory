// The cockpit (plan section 2). Bun.serve, one static page, JSON API + SSE
// read from state.ts. No second source of truth: this server never invents
// state, it reads what watch.ts wrote and posts replies through github.ts as
// the signed-in `gh` user. /api/board is the exception on purpose — it
// reads GitHub labels directly (dashboard/board.ts), so the board still
// works with no local SQLite at all (a CI/VM run with no watcher on this
// machine).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GitHub } from "../src/github";
import { FactoryState, DEFAULT_DB_PATH } from "../src/state";
import { parseChatOps } from "../src/chatops";
import { buildBoard } from "./board";
import { LABEL } from "../src/labels";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FACTORY_DASHBOARD_PORT ?? 4100);
const DB_PATH = process.env.FACTORY_DB_PATH ?? DEFAULT_DB_PATH;
const REPO = process.env.FACTORY_REPO ?? "";
// Audit finding #16: the dashboard binds 0.0.0.0 with no auth today and is
// CSRF-able via a plain `text/plain` POST. Read once at module scope (not a
// createDashboard param) so both real entry points — this file's own
// `import.meta.main` block and bin/factory's cmdDashboard — pick it up from
// the same process env without either having to be changed to pass it
// through. Binding to a non-loopback host without setting this is refused
// below; wiring `Bun.serve`'s own `hostname` default to 127.0.0.1 is a
// separate, still-open change in bin/factory's cmdDashboard (see README).
const DASHBOARD_TOKEN = process.env.FACTORY_DASHBOARD_TOKEN ?? "";
const BOARD_CACHE_MS = 10_000;

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function createDashboard(state: FactoryState, github: GitHub, repo: string) {
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

  // `remoteAddress` comes from `server.requestIP(req)` at the real Bun.serve
  // call site; undefined (unknown) is treated as NOT loopback — fail closed,
  // not open, the same rule as guard-paths.sh (audit finding #13's sibling).
  async function handle(req: Request, remoteAddress?: string): Promise<Response> {
    const url = new URL(req.url);
    const loopback = isLoopback(remoteAddress);

    if (!loopback && !DASHBOARD_TOKEN) {
      return json(
        { error: "refused: reachable from a non-loopback address with no FACTORY_DASHBOARD_TOKEN set" },
        { status: 503 },
      );
    }
    if (DASHBOARD_TOKEN) {
      const authHeader = req.headers.get("authorization") ?? "";
      const presented = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : (url.searchParams.get("token") ?? "");
      if (presented !== DASHBOARD_TOKEN) {
        return json({ error: "unauthorized" }, { status: 401 });
      }
    }

    // CSRF: a mutating request must be same-origin JSON, never the
    // `text/plain` a plain HTML form can send cross-site without a preflight.
    if (req.method === "POST") {
      const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.startsWith("application/json")) {
        return json({ error: "expected application/json" }, { status: 415 });
      }
      const origin = req.headers.get("origin");
      if (origin) {
        let originHost: string;
        try {
          originHost = new URL(origin).host;
        } catch {
          return json({ error: "invalid Origin header" }, { status: 403 });
        }
        if (originHost !== url.host) {
          return json({ error: "cross-origin request rejected" }, { status: 403 });
        }
      }
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/api/runs" && req.method === "GET") {
      return json({ repo, runs: state.listRuns(repo || undefined) });
    }

    if (url.pathname === "/api/board" && req.method === "GET") {
      if (!repo) return json({ error: "FACTORY_REPO not set" }, { status: 500 });
      const issues = await cachedIssues();
      return json({ repo, cards: buildBoard(issues) });
    }

    if (url.pathname === "/api/mark-ready" && req.method === "POST") {
      const body = (await req.json()) as { issue?: number };
      if (!repo) return json({ error: "FACTORY_REPO not set" }, { status: 500 });
      if (!Number.isInteger(body.issue)) return json({ error: "issue must be an integer" }, { status: 400 });
      await github.addLabels(repo, body.issue!, [LABEL.ready]);
      boardCache = null; // next /api/board reflects the label immediately
      return json({ ok: true });
    }

    if (url.pathname.match(/^\/api\/issues\/\d+\/thread$/) && req.method === "GET") {
      if (!repo) return json({ error: "FACTORY_REPO not set" }, { status: 500 });
      const number = Number(url.pathname.split("/")[3]);
      const issue = await github.getIssue(repo, number);
      return json({ issue });
    }

    if (url.pathname.match(/^\/api\/runs\/\d+\/events$/) && req.method === "GET") {
      const runId = Number(url.pathname.split("/")[3]);
      const after = Number(url.searchParams.get("after") ?? "0");
      return json({ events: state.listEvents(runId, { after }) });
    }

    if (url.pathname === "/api/toggles" && req.method === "GET") {
      return json({
        auto_start: state.getToggle("auto_start", true),
        auto_approve_low_risk: state.getToggle("auto_approve_low_risk", false),
      });
    }

    if (url.pathname === "/api/toggles" && req.method === "POST") {
      const body = (await req.json()) as { key: string; value: boolean };
      if (body.key !== "auto_start" && body.key !== "auto_approve_low_risk") {
        return json({ error: "unknown toggle" }, { status: 400 });
      }
      state.setToggle(body.key, Boolean(body.value));
      return json({ ok: true });
    }

    // Reply box and Approve/Revise/Retry/Cancel buttons post the same text a
    // human would type in the issue thread — the dashboard has no separate
    // command path, so untrusted-input handling stays in one place (watch.ts).
    if (url.pathname === "/api/reply" && req.method === "POST") {
      const body = (await req.json()) as { issue: number; text: string };
      if (!repo) return json({ error: "FACTORY_REPO not set" }, { status: 500 });
      await github.commentIssue(repo, body.issue, body.text);
      return json({ ok: true });
    }

    if (url.pathname === "/api/command" && req.method === "POST") {
      const body = (await req.json()) as { issue: number; command: "approve" | "revise" | "retry" | "cancel"; text?: string };
      if (!repo) return json({ error: "FACTORY_REPO not set" }, { status: 500 });
      const text =
        body.command === "revise" ? `/factory revise ${body.text ?? ""}` : `/factory ${body.command}`;
      // Round-trip through parseChatOps so a malformed command from the UI
      // fails the same way an equivalent typed comment would.
      const parsed = parseChatOps(text);
      if (parsed.type === "answer") return json({ error: "not a recognized /factory command" }, { status: 400 });
      await github.commentIssue(repo, body.issue, text);
      return json({ ok: true });
    }

    if (url.pathname === "/api/stream" && req.method === "GET") {
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
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    return json({ error: "not found" }, { status: 404 });
  }

  return { handle };
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
