// Branch claim, worktree management, and the runner's own commit. Claim is a
// real compare-and-swap: fetch the base, build a unique commit on top of it,
// and push that exact commit to create `factory/issue-N` without --force.
// Two watchers racing on the same issue will have exactly one push succeed —
// pushing the *same* base SHA twice (the old implementation) is a no-op
// fast-forward and both exits 0, which is the bug this replaces (audit
// finding #3).

import type { CommandResult, CommandRunner } from "./github";

async function spawnGit(args: string[], cwd?: string): Promise<CommandResult> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

// A bare CI runner or container has no git identity, and `commit` and
// `commit-tree` refuse to run without one. Supply a fallback only when none is
// configured, so a developer's own identity is never overridden.
export const FALLBACK_IDENTITY = ["-c", "user.name=software-factory", "-c", "user.email=factory@users.noreply.github.com"];

export class GitCommandRunner implements CommandRunner {
  async run(args: string[], opts?: { cwd?: string }): Promise<CommandResult> {
    if (args[0] === "commit" || args[0] === "commit-tree") {
      const name = await spawnGit(["config", "user.name"], opts?.cwd);
      const email = await spawnGit(["config", "user.email"], opts?.cwd);
      if (name.stdout.trim() === "" || email.stdout.trim() === "") return spawnGit([...FALLBACK_IDENTITY, ...args], opts?.cwd);
    }
    return spawnGit(args, opts?.cwd);
  }
}

export class Git {
  constructor(private readonly runner: CommandRunner = new GitCommandRunner()) {}

  branchName(issue: number): string {
    return `factory/issue-${issue}`;
  }

  // Returns true if this call won the claim (push succeeded), false if
  // another watcher already claimed it first (or the base tag doesn't exist).
  async claim(cloneDir: string, issue: number, base: string): Promise<boolean> {
    const branch = this.branchName(issue);
    await this.runner.run(["fetch", "origin", base], { cwd: cloneDir });
    const baseRev = await this.runner.run(["rev-parse", `origin/${base}`], { cwd: cloneDir });
    const baseSha = baseRev.stdout.trim();
    if (!baseSha) return false;

    const runnerId = `${process.env.HOSTNAME ?? "runner"}-${process.pid}-${Date.now()}`;
    const commitTree = await this.runner.run(
      ["commit-tree", `${baseSha}^{tree}`, "-p", baseSha, "-m", `factory: claim #${issue} by ${runnerId}`],
      { cwd: cloneDir },
    );
    const claimSha = commitTree.stdout.trim();
    if (!claimSha) return false;

    // No --force: if `branch` already exists, this only succeeds when
    // claimSha is a fast-forward of it — which it never is, since its parent
    // is origin/base, not whatever another claimant already pushed.
    const push = await this.runner.run(["push", "origin", `${claimSha}:refs/heads/${branch}`], { cwd: cloneDir });
    return push.code === 0;
  }

  // Idempotent: safe to call again for a worktree that's already registered
  // (a restart on the same machine) or for a branch another machine already
  // claimed (a fresh clone resuming an in-flight issue) — both are how the
  // runner recovers after a crash (audit finding #21).
  async ensureWorktree(cloneDir: string, worktreeDir: string, issue: number): Promise<void> {
    const branch = this.branchName(issue);
    await this.runner.run(["fetch", "origin", branch], { cwd: cloneDir });
    const list = await this.runner.run(["worktree", "list", "--porcelain"], { cwd: cloneDir });
    if (list.stdout.includes(`worktree ${worktreeDir}\n`)) return;
    await this.runner.run(["worktree", "add", worktreeDir, branch], { cwd: cloneDir });
  }

  /** @deprecated use ensureWorktree */
  async addWorktree(cloneDir: string, worktreeDir: string, issue: number): Promise<void> {
    return this.ensureWorktree(cloneDir, worktreeDir, issue);
  }

  async removeWorktree(cloneDir: string, worktreeDir: string): Promise<void> {
    await this.runner.run(["worktree", "remove", "--force", worktreeDir], { cwd: cloneDir });
  }

  // Stages and commits everything in the worktree except `.factory/runs/`
  // (the stage handoff files, never meant to land in the target repo) using
  // a pathspec exclusion, which works the same in a linked worktree as in the
  // main checkout. Returns false when there was nothing to commit. Before
  // this, nobody committed at all: the build skill's own text said "the
  // runner commits", but the runner only pushed (audit finding #4).
  async commitAll(worktreeDir: string, message: string): Promise<boolean> {
    await this.runner.run(["add", "-A", "--", ".", ":!.factory/runs"], { cwd: worktreeDir });
    const status = await this.runner.run(["status", "--porcelain", "--", ".", ":!.factory/runs"], { cwd: worktreeDir });
    if (!status.stdout.trim()) return false;
    const result = await this.runner.run(["commit", "-m", message], { cwd: worktreeDir });
    return result.code === 0;
  }

  // Regular push only; the guard hook and settings.json refuse --force and merge.
  async push(worktreeDir: string, issue: number): Promise<CommandResult> {
    const branch = this.branchName(issue);
    return this.runner.run(["push", "origin", `HEAD:refs/heads/${branch}`], { cwd: worktreeDir });
  }

  async hasCommits(worktreeDir: string, base: string): Promise<boolean> {
    const result = await this.runner.run(["rev-list", `origin/${base}..HEAD`, "--count"], { cwd: worktreeDir });
    return Number(result.stdout.trim() || "0") > 0;
  }

  // Files changed on this branch versus its base, regardless of how they
  // were changed — the check that catches a Bash-made edit the Edit/Write
  // guard hook never saw (audit finding #12).
  async changedFiles(worktreeDir: string, base: string): Promise<string[]> {
    const result = await this.runner.run(["diff", "--name-only", `origin/${base}...HEAD`], { cwd: worktreeDir });
    return result.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
