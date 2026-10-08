// The `factory` CLI. Commands are listed in src/help.ts (a test keeps the two in sync).
// bin/factory imports this file. Thin dispatcher; the logic lives in the other src/ modules so it
// stays testable without a child process.

import { accessSync, constants, existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { GitHub, type ScmPort } from "./github";
import { GitCommandRunner, Git } from "./git";
import { FactoryState, DEFAULT_DB_PATH } from "./state";
import { CommandExecutor } from "./agents/executor";
import { loadConfig, type FactoryConfig } from "./config";
import { EXIT, UsageError, failureJson, successJson } from "./cli-output";
import { advanceIssue, pollOnce, recoverInFlight, startWatch, type WatchDeps } from "./watch";
import { ShellGateRunner } from "./gates";
import { ShellHoldoutRunner } from "./holdout";
import { ShellSetupRunner } from "./setup";
import { DiffAnchorRechecker } from "./recheck";
import { scan } from "./scan";
import { streamLogs } from "./logs";
import { plain } from "./display";
import { act, buildInbox, inboxPositionals, learningPrItems, parkReasons, type InboxAction } from "./inbox";
import { reset, rebaseline } from "./reset";
import { runDoctor, fixDoctor } from "./doctor";
import { loadMachineConfig, MachineLeases, MachineSpend } from "./machine";
import { createDashboard } from "../dashboard/server";
import { versionOf, which } from "./probes";
import { workspacesDir as defaultWorkspacesDir, defaultStatePath, livePath, transcriptPath } from "./paths";
import { issueWindow, shellQuote, ShellTmuxRunner, Tmux, tmuxIssueView } from "./tmux";
import { readLive, resumeArgv, stopRunningStage, takeoverBanner } from "./takeover";
import { LABEL } from "./labels";
import { ensureRepoClone } from "./repo";
import { helpText } from "./help";
import { FixtureRecorder } from "./agents/record";
import { configFor, defaultFixtureDir, formatReport, reportFor } from "./verify-agent";
import { ShellProofGit } from "./proof";
import { runLearn } from "./learn";

const args = process.argv.slice(2);
const command = args[0];

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}

function has(name: string): boolean {
  return args.includes(`--${name}`);
}

async function fileExists(path: string): Promise<boolean> {
  return await Bun.file(path).exists();
}

// `--repo-dir <path>` (local mode: the clone already exists) or `--repo
// owner/name` (VM/CI modes: nothing is on disk yet, clone it under
// FACTORY_HOME/repos and fetch+fast-forward on every later call). Exactly
// one of the two is required; `--repo-dir` wins if both are given.
async function resolveCloneDir(): Promise<string> {
  const repoDir = flag("repo-dir");
  if (repoDir) return resolve(repoDir);
  const repoSlug = flag("repo");
  if (repoSlug) {
    const dir = await ensureRepoClone(new GitCommandRunner(), repoSlug);
    console.error(`factory: --repo ${repoSlug} resolved to ${dir}`);
    return dir;
  }
  throw new UsageError("--repo-dir <path-to-clone> or --repo <owner/name> is required");
}

// tmux is on for this process when the config says so or `--tmux` was passed.
function tmuxFor(config: FactoryConfig): Tmux | undefined {
  return config.tmux.enabled || has("tmux") ? new Tmux(new ShellTmuxRunner(), config.tmux.session) : undefined;
}

// A view that would silently do nothing is a config error: refuse to start.
async function requireTmux(config: FactoryConfig): Promise<void> {
  const tmux = tmuxFor(config);
  if (!tmux) return;
  try {
    await tmux.version();
  } catch (err) {
    throw new Error(`tmux is enabled (config tmux.enabled or --tmux) but \`tmux -V\` failed: ${err instanceof Error ? err.message : err}`);
  }
}

// Shared by watch/run/tick so all three modes (long-lived poll, one-shot CI
// step, cron tick) resolve the exact same paths and construct the exact same
// gate runner — one place, not three copies to drift (audit finding #1).
function buildWatchDeps(cloneDir: string, config: FactoryConfig): WatchDeps {
  const tmux = tmuxFor(config);
  return {
    runFiles: { transcript: (n) => transcriptPath(config.repo, n), live: (n) => livePath(config.repo, n) },
    ...(tmux ? { view: tmuxIssueView(tmux, config.repo) } : {}),
    github: new GitHub(),
    git: new Git(new GitCommandRunner()),
    state: new FactoryState(flag("db") ?? process.env.FACTORY_DB_PATH ?? defaultStatePath(process.env, config.repo)),
    executor: new CommandExecutor(config.agents, config.stages, config.routes),
    gateRunner: new ShellGateRunner(),
    holdoutRunner: new ShellHoldoutRunner(),
    rechecker: new DiffAnchorRechecker(),
    proofGit: new ShellProofGit(),
    cloneDir,
    workspacesDir: flag("workspaces") ?? defaultWorkspacesDir(process.env, config.repo),
    setupRunner: new ShellSetupRunner(),
    // Real cross-process leases: every real CLI invocation (watch, run, tick)
    // shares this machine's FACTORY_HOME/machine.db, so a second repo's
    // watcher on the same machine is respected (plan v2.7.0 item 5).
    machine: { leases: new MachineLeases(), config: loadMachineConfig(), spend: new MachineSpend() },
  };
}

async function cmdWatch(): Promise<void> {
  const cloneDir = await resolveCloneDir();
  const config = await loadConfig(cloneDir);
  await requireTmux(config);
  const deps = buildWatchDeps(cloneDir, config);
  console.log(`factory watch: polling ${config.repo} every ${config.pollIntervalSeconds}s`);
  // Re-drive anything a crashed or previously-killed process left sitting in
  // a running label before the first poll — otherwise it just sits there,
  // since none of pollOnce's resume paths look for a running label (audit
  // finding #21).
  const recovered = await recoverInFlight(deps, config);
  if (recovered.length) console.log(`factory watch: recovered #${recovered.join(", #")}`);
  if (has("once")) {
    const result = await pollOnce(deps, config);
    console.log(has("json") ? successJson(result, !result.paused) : JSON.stringify(result, null, 2));
    if (result.paused) process.exit(EXIT.paused);
    return;
  }
  startWatch(deps, config, (r) => {
    if (r.paused) console.log(`factory watch: paused — ${r.reason}`);
    else if (r.processed.length) console.log(`factory watch: processed #${r.processed.join(", #")}`);
  });
  console.log("factory watch: running. Ctrl+C to stop.");
  await new Promise(() => {}); // keep the process alive
}

// One issue, one pass, then exit — what a CI step calls (`factory run --issue
// N --repo-dir .`), and the stateless counterpart to `watch`'s long-lived
// poll (plan's "Core refactor" advanceIssue entry point).
async function cmdRun(): Promise<void> {
  const cloneDir = await resolveCloneDir();
  const config = await loadConfig(cloneDir);
  const issueNumber = Number(flag("issue"));
  if (!issueNumber) throw new UsageError("run: --issue <N> is required");
  const deps = buildWatchDeps(cloneDir, config);
  const issue = await deps.github.getIssue(config.repo, issueNumber);
  const outcome = await advanceIssue(deps, config, issue);
  if (has("json")) console.log(successJson({ issue: issueNumber, outcome }, outcome !== "failed"));
  else console.log(`factory run #${issueNumber}: ${outcome}`);
  if (outcome === "failed") process.exit(EXIT.runFailed);
}

// A single poll pass across every open, factory-owned label, then exit —
// what a cron trigger calls instead of holding a process open (plan section
// "Run anywhere" — CI has no long-lived watcher).
async function cmdTick(): Promise<void> {
  const cloneDir = await resolveCloneDir();
  const config = await loadConfig(cloneDir);
  const deps = buildWatchDeps(cloneDir, config);
  const result = await pollOnce(deps, config);
  console.log(has("json") ? successJson(result, !result.paused) : JSON.stringify(result, null, 2));
  if (result.paused) process.exit(EXIT.paused);
}

// Called from a CI failure step: the workflow itself already knows the run
// blew up (a timeout, a runner crash, an out-of-budget stage) in a way
// nothing inside the loop caught, so this parks the issue from the outside
// rather than leaving it stuck on a running label with no explanation.
async function cmdPark(): Promise<void> {
  const cloneDir = await resolveCloneDir();
  const config = await loadConfig(cloneDir);
  const issueNumber = Number(flag("issue"));
  const reason = flag("reason") ?? "parked by CI (no reason given)";
  if (!issueNumber) throw new UsageError("park: --issue <N> is required");
  const github = new GitHub();
  const issue = await github.getIssue(config.repo, issueNumber);
  const runningLabels: string[] = [LABEL.triaging, LABEL.planning, LABEL.building, LABEL.verifying, LABEL.inReview];
  const current = issue.labels.map((l) => l.name).find((n) => runningLabels.includes(n));
  if (current) await github.setStateLabel(config.repo, issueNumber, [current], LABEL.needsHuman);
  await github.commentIssue(config.repo, issueNumber, `Parked by \`factory park\`: ${reason}`);
  console.log(`factory park #${issueNumber}: needs-human — ${reason}`);
}

async function cmdLogs(): Promise<void> {
  const issue = Number(args[1]);
  if (!Number.isInteger(issue) || issue < 1) throw new UsageError("logs: an issue number is required, e.g. `factory logs 12 --follow`");
  const repoDir = flag("repo-dir");
  // With no --repo/--repo-dir/FACTORY_REPO hint, this stays on the legacy
  // shared DB (pre-v2.6.2 installs); with one, it opens that repo's own DB
  // (per-repo since v2.6.2) instead of guessing at the shared one.
  const repo = flag("repo") ?? process.env.FACTORY_REPO ?? (repoDir ? (await loadConfig(resolve(repoDir))).repo : undefined);
  const state = new FactoryState(flag("db") ?? process.env.FACTORY_DB_PATH ?? (repo ? defaultStatePath(process.env, repo) : DEFAULT_DB_PATH));
  const resolvedRepo = repo ?? state.listRuns().find((r) => r.issue === issue)?.repo ?? "";
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  await streamLogs(state, resolvedRepo, issue, { follow: has("follow"), stage: flag("stage"), json: has("json"), signal: controller.signal });
}

async function cmdInbox(): Promise<void> {
  const repo = flag("repo") ?? process.env.FACTORY_REPO;
  if (!repo) throw new UsageError("inbox: --repo <owner/name> (or FACTORY_REPO) is required");
  const github = new GitHub();
  // Only read the watcher's DB if it exists; the inbox must not create one.
  const db = flag("db") ?? process.env.FACTORY_DB_PATH ?? defaultStatePath(process.env, repo);
  const reasons = existsSync(db) ? parkReasons(new FactoryState(db).listRuns(repo)) : undefined;
  const items = [...buildInbox(await github.listOpenIssues(repo), reasons), ...learningPrItems(await github.listPrs(repo, { state: "open" }))];
  const [issueArg, actionArg] = inboxPositionals(args);
  if (issueArg) {
    const item = items.find((i) => i.issue === Number(issueArg));
    if (!item) throw new UsageError(`inbox: #${issueArg} is not waiting for you`);
    if (!actionArg) throw new UsageError(`inbox: choose an action: ${item.actions.join(", ")}`);
    const posted = await act(github, repo, item, actionArg as InboxAction, flag("text") ?? "");
    console.log(has("json") ? successJson({ issue: item.issue, posted }, true) : `#${item.issue}: posted "${posted}"`);
    return;
  }
  if (has("json")) console.log(successJson({ items }, true));
  else if (!items.length) console.log("Nothing is waiting for you.");
  else for (const i of items) console.log(`#${i.issue} ${i.kind} (${i.actions.join("/")}): ${i.title}`);
}

async function cmdScan(): Promise<void> {
  const cloneDir = await resolveCloneDir();
  const config = await loadConfig(cloneDir);
  // scan shells out to `bun audit`/`bun outdated`, not `git`: Bun projects only.
  const bunRunner = {
    run: async (a: string[], opts?: { cwd?: string }) => {
      const proc = Bun.spawn(["bun", ...a], { cwd: opts?.cwd, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, code };
    },
  };
  const result = await scan({ github: new GitHub(), runner: bunRunner }, config.repo, cloneDir);
  if (result.skippedReason) {
    console.log(`factory scan: skipped — ${result.skippedReason}`);
    return;
  }
  console.log(`factory scan: filed ${result.filed.length}, skipped ${result.skipped.length} (already open)`);
  for (const t of result.filed) console.log(`  + ${t}`);
}

async function cmdReset(): Promise<void> {
  const cloneDir = await resolveCloneDir();
  const config = await loadConfig(cloneDir);
  const dryRun = has("dry-run");
  const ctx = {
    repo: config.repo,
    cloneDir,
    baselineTag: config.baselineTag,
    base: config.base,
    issuesDir: `${cloneDir}/.factory/issues`,
    workspacesDir: flag("workspaces") ?? defaultWorkspacesDir(process.env, config.repo),
    statePath: flag("db") ?? process.env.FACTORY_DB_PATH ?? defaultStatePath(process.env, config.repo),
    resettable: config.resettable,
    allIssues: has("all-issues"),
  };
  const deps = { github: new GitHub(), git: new GitCommandRunner() };
  const summary = await reset(deps, ctx, dryRun);
  console.log(`factory reset${dryRun ? " --dry-run" : ""}: ${summary.actions.length} action(s)`);
  for (const a of summary.actions) console.log(`  ${dryRun ? "would " : ""}${a.kind}: ${a.detail}`);
}

async function cmdRebaseline(): Promise<void> {
  const cloneDir = await resolveCloneDir();
  const config = await loadConfig(cloneDir);
  const dryRun = has("dry-run");
  const ctx = {
    repo: config.repo,
    cloneDir,
    baselineTag: config.baselineTag,
    base: config.base,
    issuesDir: "",
    workspacesDir: "",
    statePath: "",
    resettable: config.resettable,
  };
  const moved = await rebaseline({ github: new GitHub(), git: new GitCommandRunner() }, ctx, dryRun);
  console.log(`factory rebaseline${dryRun ? " --dry-run" : ""}: ${config.baselineTag} -> origin/${config.base} (${moved.length} commit(s))`);
  for (const c of moved) console.log(`  ${c}`);
}

// The skills this runner ships, keyed by their path in a target repo.
function templateSkills(): Record<string, string> {
  const root = resolve(import.meta.dir, "..", "template");
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out[relative(root, full)] = readFileSync(full, "utf8");
    }
  };
  walk(join(root, ".claude", "skills"));
  return out;
}

async function cmdDoctor(): Promise<void> {
  const cloneDir = await resolveCloneDir();
  let config;
  try {
    config = await loadConfig(cloneDir);
  } catch (err) {
    if (has("json")) console.log(successJson({ checks: [{ name: ".factory/config.json is usable", ok: false, detail: err instanceof Error ? err.message : String(err), fixable: false }] }, false));
    else console.log(`  [FAIL] .factory/config.json is usable — ${err instanceof Error ? err.message : err}`);
    process.exit(EXIT.checksFailed);
  }
  const github = new GitHub();
  const checks = await runDoctor(
    {
      github,
      git: new GitCommandRunner(),
      which,
      versionOf,
      fileExists,
      readFile: async (path) => ((await fileExists(path)) ? await Bun.file(path).text() : undefined),
      isExecutable: async (path) => {
        try {
          accessSync(path, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      },
    },
    {
      repo: config.repo,
      cloneDir,
      baselineTag: config.baselineTag,
      factoryMode: process.env.FACTORY_MODE,
      agents: config.agents,
      stages: config.stages,
      routes: config.routes,
      templateSkills: templateSkills(),
      templateOverrides: config.templateOverrides,
      tmux: config.tmux.enabled,
      legacyStatePath: defaultStatePath(process.env),
      legacyWorkspacesDir: defaultWorkspacesDir(process.env),
      configuredSlots: loadMachineConfig().slots,
      resettable: config.resettable,
    },
  );
  const allOk = checks.every((c) => c.ok || c.warn);
  if (has("json")) console.log(successJson({ checks }, allOk));
  else for (const c of checks) console.log(`  [${c.ok ? "ok" : c.warn ? "warn" : "FAIL"}] ${c.name} — ${c.detail}`);
  if (!allOk && has("fix")) {
    console.error("factory doctor --fix: creating missing labels");
    await fixDoctor(github, config.repo, config.routes);
  }
  if (!allOk && !has("fix")) process.exit(EXIT.checksFailed);
}

// `dashboard/server.ts`'s own `if (import.meta.main)` block never fires
// here: this file is the process entry point, so that module is always
// imported, not run directly. Call createDashboard + Bun.serve ourselves,
// mirroring that block exactly (audit finding #16): loopback by default,
// and remoteAddress passed through so handle() can enforce it. Shared by
// `dashboard` (cockpit only, any mode) and `up` (Docker's single-process
// entrypoint: watch + dashboard together).
function serveDashboard(state: FactoryState, github: ScmPort, repo: string, autoApproveDefault = false, fleet?: Pick<FactoryConfig, "agents" | "stages">): number {
  const port = Number(flag("port") ?? process.env.FACTORY_DASHBOARD_PORT ?? 4100);
  const hostname = process.env.FACTORY_DASHBOARD_HOST ?? "127.0.0.1";
  const dashboard = createDashboard(state, github, repo, autoApproveDefault, undefined, fleet);
  const server = Bun.serve({
    port,
    hostname,
    fetch: (req: Request): Promise<Response> => dashboard.handle(req, server.requestIP(req)?.address),
  });
  console.log(`factory dashboard: http://${hostname}:${port} (repo=${repo || "unset"})`);
  return port;
}

async function cmdDashboard(): Promise<void> {
  const repoDir = flag("repo-dir");
  const config = repoDir ? await loadConfig(resolve(repoDir)) : undefined;
  const repo = flag("repo") ?? process.env.FACTORY_REPO ?? config?.repo ?? "";
  const dbPath = flag("db") ?? process.env.FACTORY_DB_PATH ?? (repo ? defaultStatePath(process.env, repo) : DEFAULT_DB_PATH);
  const state = new FactoryState(dbPath);
  const github = new GitHub();
  serveDashboard(state, github, repo, false, config);
  await new Promise(() => {}); // keep the process alive
}

// The Docker image's entrypoint command (plan "Run anywhere", VM mode):
// `docker run ... software-factory up --repo owner/name`. One process, one
// PID 1, running both the poll loop and the cockpit — a container only gets
// to hold open one foreground process, unlike `make up`'s two background
// shells on a laptop.
async function cmdUp(): Promise<void> {
  const cloneDir = await resolveCloneDir();
  const config = await loadConfig(cloneDir);
  await requireTmux(config);
  if (has("tmux")) return upInTmux(cloneDir, config);
  const deps = buildWatchDeps(cloneDir, config);
  const recovered = await recoverInFlight(deps, config);
  if (recovered.length) console.log(`factory up: recovered #${recovered.join(", #")}`);
  startWatch(deps, config, (r) => {
    if (r.paused) console.log(`factory up: paused — ${r.reason}`);
    else if (r.processed.length) console.log(`factory up: processed #${r.processed.join(", #")}`);
  });
  serveDashboard(deps.state, deps.github, config.repo, config.riskPolicy.autoApproveLowRisk, config);
  console.log(`factory up: polling ${config.repo} every ${config.pollIntervalSeconds}s. Ctrl+C to stop.`);
  await new Promise(() => {}); // keep the process alive
}

// `up --tmux`: the watcher and the dashboard each get a window in the
// session, and every issue in flight gets its own beside them. Detached, so
// it works the same over SSH or `docker exec`; `factory attach` joins it.
async function upInTmux(cloneDir: string, config: FactoryConfig): Promise<void> {
  const tmux = new Tmux(new ShellTmuxRunner(), config.tmux.session);
  const self = [process.execPath, Bun.main].map(shellQuote).join(" ");
  const pass = ["db", "workspaces"].flatMap((f) => (flag(f) ? [`--${f}`, shellQuote(flag(f)!)] : [])).join(" ");
  const repoDir = `--repo-dir ${shellQuote(cloneDir)}`;
  await tmux.ensureWindow("watch", `${self} watch ${repoDir} --tmux ${pass}`.trim(), cloneDir);
  await tmux.ensureWindow("dashboard", `${self} dashboard ${repoDir} ${pass}`.trim(), cloneDir);
  console.log(`factory up: tmux session "${config.tmux.session}" has windows watch and dashboard.`);
  console.log(`attach: factory attach --repo ${config.repo}   (or: tmux attach -t ${config.tmux.session})`);
}

// The repo slug without cloning: --repo as given, else the config in --repo-dir.
async function repoSlugAndConfig(): Promise<{ repo: string; config?: FactoryConfig }> {
  const repoDir = flag("repo-dir");
  const config = repoDir ? await loadConfig(resolve(repoDir)) : undefined;
  const repo = flag("repo") ?? config?.repo;
  if (!repo) throw new UsageError("--repo <owner/name> or --repo-dir <path> is required");
  return { repo, config };
}

async function cmdAttach(): Promise<void> {
  const n = args[1] && !args[1].startsWith("--") ? Number(args[1]) : undefined;
  const { repo, config } = await repoSlugAndConfig();
  const session = flag("session") ?? config?.tmux.session ?? "factory";
  const tmux = new Tmux(new ShellTmuxRunner(), session);
  if (!(await tmux.hasSession())) throw new Error(`no tmux session "${session}": start one with factory up --tmux`);
  if (n) {
    const name = issueWindow(repo, n);
    if (!(await tmux.windows()).includes(name)) throw new Error(`#${n} has no window in "${session}" (no stage has run since the watcher started)`);
    await new ShellTmuxRunner().run(["select-window", "-t", `=${session}:=${name}`]);
  }
  // Inside tmux already: switch this client instead of nesting a second one.
  const argv = process.env.TMUX ? ["tmux", "switch-client", "-t", `=${session}`] : ["tmux", "attach", "-t", `=${session}`];
  process.exit(await Bun.spawn(argv, { stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited);
}

// Waits for the watcher to park the issue after a takeover, so the hand-back
// retry lands on a parked issue and never races the stage it stopped.
async function waitForLabel(github: ScmPort, repo: string, n: number, label: string, timeoutMs = 60_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const issue = await github.getIssue(repo, n);
    if (issue.labels.some((l) => l.name === label)) return true;
    if (Date.now() > end) return false;
    await Bun.sleep(2000);
  }
}

async function cmdTakeover(): Promise<void> {
  const n = Number(args[1]);
  if (!n) throw new UsageError("takeover: usage: factory takeover <N> (--repo-dir <path> | --repo <owner/name>) [--no-handback]");
  const cloneDir = await resolveCloneDir();
  const config = await loadConfig(cloneDir);
  const repo = config.repo;
  const worktree = `${flag("workspaces") ?? defaultWorkspacesDir(process.env, repo)}/issue-${n}`;
  if (!(await Bun.file(`${worktree}/.git`).exists())) throw new Error(`#${n} has no worktree at ${worktree}`);
  const github = new GitHub();
  const liveFile = livePath(repo, n);
  const live = readLive(liveFile);
  let agent: string;
  let sessionId: string | undefined;
  if (live) {
    console.log(`factory takeover: stopping ${live.stage} on #${n} (pid ${live.pid})`);
    if (!(await stopRunningStage(liveFile, live))) throw new Error(`#${n}: the ${live.stage} stage did not stop within 60s`);
    if (!(await waitForLabel(github, repo, n, LABEL.needsHuman))) throw new Error(`#${n} was stopped but not parked within 60s; is the watcher running?`);
    agent = live.agent;
    sessionId = live.sessionId;
  } else {
    const state = new FactoryState(flag("db") ?? process.env.FACTORY_DB_PATH ?? defaultStatePath(process.env, repo));
    const last = state.lastSession(repo, n);
    state.close();
    agent = last?.agent ?? config.stages.default ?? "claude";
    sessionId = last?.session_id;
  }
  if (!sessionId) throw new Error(`agent ${agent} cannot be resumed: no session recorded for #${n}`);
  const argv = resumeArgv(agent, config.agents, sessionId);
  for (const line of takeoverBanner(argv, worktree)) console.log(line);
  await Bun.spawn(argv, { cwd: worktree, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited;
  if (has("no-handback")) {
    console.log(`factory takeover: #${n} left as it is; hand back with: factory inbox ${n} retry --repo ${repo}`);
    return;
  }
  const item = buildInbox([await github.getIssue(repo, n)])[0];
  if (item?.actions.includes("retry")) {
    const posted = await act(github, repo, item, "retry");
    console.log(`factory takeover: handed #${n} back ("${posted}")`);
  } else if (item) {
    console.log(`factory takeover: #${n} is waiting on you (${item.kind}); choose: factory inbox ${n} <${item.actions.join("|")}> --repo ${repo}`);
  } else {
    console.log(`factory takeover: #${n} is not parked; nothing to hand back`);
  }
}

// Runs the whole loop for one issue on one preset, with the raw output recorded as a fixture.
async function cmdVerifyAgent(): Promise<void> {
  const name = args[1];
  if (!name || name.startsWith("--")) throw new UsageError("verify-agent: <name> is required");
  const cloneDir = await resolveCloneDir();
  const issueNumber = Number(flag("issue"));
  if (!issueNumber) throw new UsageError("verify-agent: --issue <N> is required");
  const loaded = await loadConfig(cloneDir);
  const config: FactoryConfig = { ...loaded, ...configFor(name) };
  const out = flag("out") ? resolve(flag("out")!) : defaultFixtureDir(name);
  const deps = { ...buildWatchDeps(cloneDir, config), executor: new CommandExecutor(config.agents, config.stages, config.routes, new FixtureRecorder(out, name)) };
  const outcome = await advanceIssue(deps, config, await deps.github.getIssue(config.repo, issueNumber));
  if (outcome === "awaiting-approval") {
    console.log(`Plan gate: read the plan on #${issueNumber}, approve it (/factory approve), then run this command again to finish and record the rest.`);
  }
  const report = reportFor(name, deps.state.listStageRuns(config.repo, { issue: issueNumber }), outcome);
  console.log(formatReport(report));
  console.log(`fixture: ${out}`);
  if (!report.pass) process.exit(EXIT.runFailed);
}

async function cmdLearn(): Promise<void> {
  const cloneDir = await resolveCloneDir();
  const config = await loadConfig(cloneDir);
  const deps = buildWatchDeps(cloneDir, config);
  const result = await runLearn(deps, config.repo, config.base);
  if (has("json")) {
    console.log(successJson(result, true));
    return;
  }
  if (result.batched === 0) {
    console.log("factory learn: nothing pending.");
    return;
  }
  console.log(`factory learn: batched ${result.batched} proposal(s) on ${result.branch} -> ${result.prUrl}`);
}

async function cmdInstall(): Promise<void> {
  const target = args[1];
  if (!target) throw new UsageError("install: usage: factory install <target-dir> [--dry-run] [--update] [--ci] [--agents a,b,c]");
  const passthrough = [
    ...(has("dry-run") ? ["--dry-run"] : []),
    ...(has("update") ? ["--update"] : []),
    ...(has("ci") ? ["--ci"] : []),
    ...(flag("agents") ? ["--agents", flag("agents")!] : []),
  ];
  const script = resolve(import.meta.dir, "..", "install.sh");
  const proc = Bun.spawn(["bash", script, target, ...passthrough], { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
  if (has("dry-run")) return;
  // Labels are cheap and idempotent, so create them right after a real install
  // instead of making every repo run a separate `doctor --fix` first. Best
  // effort: a fresh install with no filled-in config.json still gets the
  // "next:" hint above, and `doctor --fix` stays the authoritative fixer.
  try {
    const config = await loadConfig(resolve(target));
    await fixDoctor(new GitHub(), config.repo, config.routes);
    console.log(`factory install: labels ensured on ${config.repo}`);
  } catch {
    // no usable config.json yet
  }
}

async function main(): Promise<void> {
  switch (command) {
    case "up":
      return cmdUp();
    case "watch":
      return cmdWatch();
    case "run":
      return cmdRun();
    case "tick":
      return cmdTick();
    case "park":
      return cmdPark();
    case "dashboard":
      return cmdDashboard();
    case "logs":
      return cmdLogs();
    case "inbox":
      return cmdInbox();
    case "scan":
      return cmdScan();
    case "reset":
      return cmdReset();
    case "rebaseline":
      return cmdRebaseline();
    case "doctor":
      return cmdDoctor();
    case "install":
      return cmdInstall();
    case "verify-agent":
      return cmdVerifyAgent();
    case "learn":
      return cmdLearn();
    case "attach":
      return cmdAttach();
    case "takeover":
      return cmdTakeover();
    default:
      console.log(helpText());
      if (command && !["help", "--help", "-h"].includes(command)) process.exit(EXIT.error);
  }
}

try {
  await main();
} catch (err) {
  if (has("json")) console.error(failureJson(err));
  else console.error(`factory: ${plain(err instanceof Error ? err.message : String(err))}`);
  process.exit(EXIT.error);
}
