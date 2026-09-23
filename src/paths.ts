// Every path the runner touches (clones, worktrees, the state DB) is
// resolved from here, always absolute. Before this file, `bin/factory`
// passed `workspaces` (relative to whatever cwd `bun` started in) straight
// into `git worktree add`, while `claude` was later spawned with
// `cwd: worktree` computed the same way — on any machine where those two
// resolve differently (they always do: bun's cwd is the shell's cwd, not
// the repo dir), the agent ran outside a git checkout. FACTORY_HOME fixes
// the ambiguity once, for local, Docker and CI alike (audit finding #1).

import { resolve } from "node:path";

export function factoryHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.FACTORY_HOME ?? `${env.HOME ?? "."}/.factory`);
}

export function workspacesDir(env: NodeJS.ProcessEnv = process.env): string {
  return `${factoryHome(env)}/workspaces`;
}

export function defaultStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return `${factoryHome(env)}/factory.db`;
}

export function reposDir(env: NodeJS.ProcessEnv = process.env): string {
  return `${factoryHome(env)}/repos`;
}

// Where a given issue's worktree lives, always absolute regardless of what
// cwd the process was started from.
export function worktreePath(issue: number, env: NodeJS.ProcessEnv = process.env): string {
  return `${workspacesDir(env)}/issue-${issue}`;
}
