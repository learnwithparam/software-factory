// Branch claim and worktree management. Claim is a compare-and-swap: push an
// empty commit on `factory/issue-N` without --force. Only the push result is
// trusted (not the label) — two watchers racing on the same issue will have
// exactly one push succeed.

import type { CommandResult, CommandRunner } from "./github";

export class GitCommandRunner implements CommandRunner {
  async run(args: string[], opts?: { cwd?: string }): Promise<CommandResult> {
    const proc = Bun.spawn(["git", ...args], { cwd: opts?.cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  }
}

export class Git {
  constructor(private readonly runner: CommandRunner = new GitCommandRunner()) {}

  branchName(issue: number): string {
    return `factory/issue-${issue}`;
  }

  // Returns true if this call won the claim (push succeeded), false if the
  // branch already exists remotely (another watcher got there first).
  async claim(cloneDir: string, issue: number, base: string): Promise<boolean> {
    const branch = this.branchName(issue);
    const result = await this.runner.run(
      ["push", "origin", `${base}:refs/heads/${branch}`],
      { cwd: cloneDir },
    );
    return result.code === 0;
  }

  async addWorktree(cloneDir: string, worktreeDir: string, issue: number): Promise<void> {
    const branch = this.branchName(issue);
    await this.runner.run(["fetch", "origin", branch], { cwd: cloneDir });
    await this.runner.run(["worktree", "add", worktreeDir, branch], { cwd: cloneDir });
  }

  async removeWorktree(cloneDir: string, worktreeDir: string): Promise<void> {
    await this.runner.run(["worktree", "remove", "--force", worktreeDir], { cwd: cloneDir });
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
}
