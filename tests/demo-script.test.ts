// teach/demo/lightning-2.sh builds the lesson's tmux layout and screenshots it. --dry-run prints
// every tmux command, so the layout is checked without a tmux server; snap.ts is checked on a known ANSI sample.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ansiToHtml, renderPage } from "../teach/demo/snap";

const root = join(import.meta.dir, "..");
const script = join(root, "teach/demo/lightning-2.sh");
const dry = (...args: string[]) => {
  const p = Bun.spawnSync([script, "--dry-run", ...args], { env: { ...process.env, FACTORY_HOME: "/tmp/fh" } });
  return { code: p.exitCode, out: p.stdout.toString() };
};

describe("lightning-2 demo script", () => {
  test("up builds the five windows the walkthrough names, in its order", () => {
    const { code, out } = dry("up");
    expect(code).toBe(0);
    const windows = [...out.matchAll(/new-(?:session|window) .*?-n (\w+)/g)].map((m) => m[1]);
    expect(windows).toEqual(["you", "factory", "logs", "boundary", "flow"]);
    const walkthrough = readFileSync(join(root, "teach/lightning-2.md"), "utf8");
    for (const w of windows) expect(walkthrough).toContain(`| \`${w}\` |`);
    expect(out).toContain("scene\\ 0:\\ setup");
    for (const line of out.split("\n").filter((l) => /^tmux (new-session|new-window|split-window)/.test(l))) expect(line).toContain("GH_PAGER=cat");
  });

  test("up refuses, naming the holder, when the dashboard port is already taken", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
    try {
      const p = Bun.spawnSync([script, "up"], { env: { ...process.env, FACTORY_HOME: "/tmp/fh", DEMO_SESSION: `port-guard-${process.pid}`, FACTORY_DASHBOARD_PORT: String(server.port) } });
      expect(p.exitCode).toBe(1);
      expect(p.stderr.toString()).toContain(`port ${server.port} is held by pid ${process.pid}`);
    } finally {
      server.stop(true);
    }
  });

  test("snap writes html and png under the runner version's recording dir", () => {
    const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }).version;
    const { code, out } = dry("snap", "01-two-worktrees", "factory");
    expect(code).toBe(0);
    expect(out).toContain(`/tmp/fh/recordings/lightning-2/v${version}/01-two-worktrees.png`);
    expect(out).toContain("lightning-2:factory");
  });

  test("--record wraps the attach in asciinema; an unknown scene fails", () => {
    expect(dry("--record", "attach").out).toContain("asciinema rec --idle-time-limit 2");
    expect(dry("scene", "9").code).toBe(2);
  });

  test("snap.ts renders colour, bold and reset, and escapes html", () => {
    expect(ansiToHtml("\x1b[1;32mok\x1b[0m <b>")).toBe('<span style="color:#23d18b;font-weight:bold">ok</span> &lt;b&gt;');
    expect(ansiToHtml("\x1b[38;5;196mred")).toBe('<span style="color:rgb(255,0,0)">red</span>');
    const page = renderPage("s:w", [{ left: 0, top: 0, width: 80, height: 10, text: "a" }, { left: 0, top: 11, width: 80, height: 10, text: "b" }]);
    expect(page.match(/<pre /g)?.length).toBe(2);
    expect(page).toContain("top:calc(11 * var(--lh))");
  });
});
