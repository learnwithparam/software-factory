// Resolves `--repo owner/name` into a local clone under FACTORY_HOME/repos,
// cloning on first use and fast-forwarding to origin's default branch on
// every call after — the piece that lets a Docker or CI container start
// with nothing on disk (plan "Run anywhere": VM mode is `up --repo
// owner/name`; CI's `factory run`/`tick` accept the same flag). Local mode
// keeps using `--repo-dir <path>` and never touches this file.

import { existsSync } from "node:fs";
import type { CommandRunner } from "./github";
import { reposDir } from "./paths";

export function cloneDirFor(repoSlug: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${reposDir(env)}/${repoSlug.replace("/", "__")}`;
}

async function run(runner: CommandRunner, args: string[], cwd?: string): Promise<string> {
  const result = await runner.run(args, cwd ? { cwd } : undefined);
  if (result.code !== 0) throw new Error(`git ${args.join(" ")} (cwd=${cwd ?? "."}) failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

export interface EnsureRepoCloneOptions {
  readonly env?: NodeJS.ProcessEnv;
  // Overrides the clone URL; tests point this at a local bare repo instead
  // of https://github.com/<repoSlug>.git.
  readonly remoteUrl?: string;
}

export async function ensureRepoClone(
  runner: CommandRunner,
  repoSlug: string,
  opts: EnsureRepoCloneOptions = {},
): Promise<string> {
  const env = opts.env ?? process.env;
  const dir = cloneDirFor(repoSlug, env);
  const remoteUrl = opts.remoteUrl ?? `https://github.com/${repoSlug}.git`;

  if (!existsSync(`${dir}/.git`)) {
    await run(runner, ["clone", remoteUrl, dir]);
    return dir;
  }

  // Already cloned from an earlier container start: fetch and fast-forward
  // to whatever origin's default branch currently is, discarding any local
  // drift — a stateless CI/VM clone is never a place to keep local commits.
  await run(runner, ["fetch", "--prune", "origin"], dir);
  const defaultRef = await run(runner, ["rev-parse", "--abbrev-ref", "origin/HEAD"], dir); // "origin/main"
  const defaultBranch = defaultRef.replace(/^origin\//, "");
  await run(runner, ["checkout", defaultBranch], dir);
  await run(runner, ["reset", "--hard", `origin/${defaultBranch}`], dir);
  return dir;
}
