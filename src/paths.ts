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

// A second repo (splitbill-demo, lwp-website, ...) sharing one FACTORY_HOME
// must never share a workspace or a state DB with the first: two repos each
// carrying an issue #3 would otherwise collide on one worktree and one row
// set. `repo` ("owner/name") namespaces both under FACTORY_HOME; omitting it
// keeps the pre-v2.6.2 shared path, which DEFAULT_DB_PATH and existing
// fixtures still rely on.
function repoHome(repo: string, env: NodeJS.ProcessEnv): string {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`repo must be "owner/name", got ${JSON.stringify(repo)}`);
  return `${factoryHome(env)}/${owner}/${name}`;
}

export function workspacesDir(env: NodeJS.ProcessEnv = process.env, repo?: string): string {
  return repo ? `${repoHome(repo, env)}/workspaces` : `${factoryHome(env)}/workspaces`;
}

export function defaultStatePath(env: NodeJS.ProcessEnv = process.env, repo?: string): string {
  return repo ? `${repoHome(repo, env)}/factory.db` : `${factoryHome(env)}/factory.db`;
}

export function reposDir(env: NodeJS.ProcessEnv = process.env): string {
  return `${factoryHome(env)}/repos`;
}

// Where a given issue's worktree lives, always absolute regardless of what
// cwd the process was started from.
export function worktreePath(issue: number, env: NodeJS.ProcessEnv = process.env, repo?: string): string {
  return `${workspacesDir(env, repo)}/issue-${issue}`;
}
