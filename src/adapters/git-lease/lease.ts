// Leases as refs on the repo's own remote: refs/factory/lease/<key> points at
// an empty-tree commit whose message is the lease record. Every new record is
// a child of the one it replaces, so a plain (never forced) push lands only
// as a fast-forward of what this worker read: compare-and-swap, the same
// mechanism as Git.claim. Releasing pushes a child with expiresAt 0, so the
// ref only ever moves forward.

import { decodeLease, encodeLease, mayTake } from "../../core/lease";
import { FALLBACK_IDENTITY } from "../../git";
import type { CommandResult } from "../../github";
import type { LeasePort } from "../../ports/lease";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

async function git(args: string[], cwd: string): Promise<CommandResult> {
  const proc = Bun.spawn(["git", ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

export class GitLeases implements LeasePort {
  // `cloneDir` is any clone whose `origin` is the shared remote.
  constructor(private readonly cloneDir: string) {}

  private ref(key: string): string {
    if (!/^[\w.-]{1,100}$/.test(key)) throw new Error(`lease key "${key}": letters, digits, _ . and -`);
    return `refs/factory/lease/${key}`;
  }

  // The remote's current lease commit and its record, or undefined when none exists.
  private async read(ref: string): Promise<{ sha: string; record: ReturnType<typeof decodeLease> } | undefined | "error"> {
    const ls = await git(["ls-remote", "origin", ref], this.cloneDir);
    if (ls.code !== 0) return "error";
    const sha = ls.stdout.split("\t")[0]?.trim();
    if (!sha) return undefined;
    // By sha, not FETCH_HEAD: concurrent issues share this clone.
    if ((await git(["fetch", "-q", "origin", sha], this.cloneDir)).code !== 0) return "error";
    const body = await git(["log", "-1", "--format=%B", sha], this.cloneDir);
    return { sha, record: decodeLease(body.stdout) };
  }

  private async write(ref: string, parent: string | undefined, message: string): Promise<boolean> {
    const commit = await git([...FALLBACK_IDENTITY, "commit-tree", EMPTY_TREE, ...(parent ? ["-p", parent] : []), "-m", message], this.cloneDir);
    const sha = commit.stdout.trim();
    if (commit.code !== 0 || !sha) return false;
    return (await git(["push", "-q", "origin", `${sha}:${ref}`], this.cloneDir)).code === 0;
  }

  async acquire(key: string, holder: string, ttlMs: number, now: number): Promise<boolean> {
    const ref = this.ref(key);
    const cur = await this.read(ref);
    if (cur === "error") return false;
    if (!mayTake(cur?.record, holder, now)) return false;
    return this.write(ref, cur?.sha, encodeLease({ holder, expiresAt: now + ttlMs }));
  }

  async release(key: string, holder: string): Promise<void> {
    const ref = this.ref(key);
    const cur = await this.read(ref);
    if (cur === "error" || !cur || cur.record?.holder !== holder) return;
    await this.write(ref, cur.sha, encodeLease({ holder, expiresAt: 0 }));
  }
}
