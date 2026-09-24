// The CLI's help text. tests/help.test.ts diffs COMMANDS against the
// dispatcher in bin/factory so a new command can't ship undocumented.

export const COMMANDS: { name: string; usage: string; does: string }[] = [
  { name: "up", usage: "up (--repo-dir <path> | --repo <owner/name>)", does: "watch + dashboard in one process (Docker/VM)" },
  { name: "watch", usage: "watch (--repo-dir <path> | --repo <owner/name>) [--once]", does: "poll and drive the loop; --once = one pass" },
  { name: "run", usage: "run (--repo-dir <path> | --repo <owner/name>) --issue <N>", does: "advance one issue once, then exit (CI)" },
  { name: "tick", usage: "tick (--repo-dir <path> | --repo <owner/name>)", does: "one poll pass over every open issue, then exit (cron)" },
  { name: "park", usage: "park --repo-dir <path> --issue <N> [--reason <text>]", does: "park an issue as needs-human from outside the loop" },
  { name: "dashboard", usage: "dashboard [--repo <owner/name>] [--port <n>]", does: "serve the board (default :4100, loopback)" },
  { name: "logs", usage: "logs <N> [--repo <owner/name>] [--stage <name>] [--follow] [--json]", does: "print (or follow) a run's events; --json is one object per line" },
  { name: "inbox", usage: "inbox [<N> <action> [--text <words>]] --repo <owner/name> [--json]", does: "list what waits for a human; with <N> <action>, post the same /factory comment a human would" },
  { name: "scan", usage: "scan --repo-dir <path>", does: "file issues from `bun audit` (Bun/npm projects only)" },
  { name: "reset", usage: "reset --repo-dir <path> [--dry-run]", does: "DESTRUCTIVE: force base back to the baseline tag (lists dropped commits), close PRs and issues" },
  { name: "rebaseline", usage: "rebaseline --repo-dir <path> [--dry-run]", does: "move the baseline tag to origin/<base>, keeping merged setup changes across reset" },
  { name: "doctor", usage: "doctor --repo-dir <path> [--fix]", does: "check the loop can run; --fix creates missing labels" },
  { name: "install", usage: "install <target-dir> [--dry-run] [--update] [--ci]", does: "install or update the template in a repo" },
];

export const OPTIONS: [string, string][] = [
  ["--db <path>", "SQLite telemetry cache (default ~/.factory/state.db)"],
  ["--workspaces <dir>", "worktree root (default ~/.factory/workspaces)"],
  ["--json", "run, tick, watch --once and doctor: print {ok,data} on stdout, and errors as {ok:false,error} on stderr"],
  ["--port <n>", "dashboard port (default FACTORY_DASHBOARD_PORT or 4100)"],
];

export const ENV: [string, string][] = [
  ["FACTORY_HOME", "state root (clones, worktrees, db)"],
  ["FACTORY_MODE", "set to `actions` when GitHub Actions drives the repo; doctor checks the workflow exists"],
  ["FACTORY_DASHBOARD_HOST / _PORT / _TOKEN", "dashboard bind; a non-loopback host requires the token"],
  ["FACTORY_DB_PATH / FACTORY_REPO", "dashboard-only defaults for --db / --repo"],
  ["GH_TOKEN, ANTHROPIC_API_KEY", "credentials for VM/CI modes; the runner strips them from the agent env"],
];

export function helpText(): string {
  const w = Math.max(...COMMANDS.map((c) => c.usage.length));
  return [
    "factory <command> [options]",
    "",
    ...COMMANDS.map((c) => `  ${c.usage.padEnd(w)}  ${c.does}`),
    "",
    "options:",
    ...OPTIONS.map(([k, v]) => `  ${k.padEnd(w)}  ${v}`),
    "",
    "environment:",
    ...ENV.map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Humans answer through GitHub: /factory approve|revise <text>|retry|cancel in a trusted issue or PR comment.",
  ].join("\n");
}
