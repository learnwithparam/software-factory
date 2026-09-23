// The cockpit (plan section 2). Bun.serve, one static page, JSON API + SSE
// read from state.ts. No second source of truth: this server never invents
// state, it reads what watch.ts wrote and posts replies through github.ts as
// the signed-in `gh` user.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GitHub } from "../src/github";
import { FactoryState, DEFAULT_DB_PATH } from "../src/state";
import { parseChatOps } from "../src/chatops";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FACTORY_DASHBOARD_PORT ?? 4100);
const DB_PATH = process.env.FACTORY_DB_PATH ?? DEFAULT_DB_PATH;
const REPO = process.env.FACTORY_REPO ?? "";

export function createDashboard(state: FactoryState, github: GitHub, repo: string) {
  const indexHtml = readFileSync(join(here, "public", "index.html"), "utf8");

  function json(data: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(data), {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(indexHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (url.pathname === "/api/runs" && req.method === "GET") {
      return json({ repo, runs: state.listRuns(repo || undefined) });
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
  Bun.serve({ port: PORT, fetch: (req) => dashboard.handle(req) });
  console.log(`factory dashboard: http://localhost:${PORT} (repo=${REPO || "unset"})`);
}
