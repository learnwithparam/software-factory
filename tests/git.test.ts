// Two properties that were flat-out bugs before this refactor, both only
// provable against a real git repo:
//   - claim() is a real compare-and-swap (audit finding #3): pushing the
//     same base SHA twice used to be a fast-forward no-op that let two
//     racing watchers both "win" the same issue.
//   - commitAll() excludes `.factory/runs` (audit finding #4): that
//     directory is the stage handoff, never meant to land in the target repo.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Git, GitCommandRunner } from "../src/git";

const roots: string[] = [];

function tmpRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "factory-git-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

async function run(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} (cwd=${cwd}) failed: ${stderr}`);
  return stdout;
}

async function initSeededRepo(dir: string): Promise<void> {
  await run(["git", "init", "-b", "main", dir], dir);
  await run(["git", "config", "user.email", "t@example.com"], dir);
  await run(["git", "config", "user.name", "t"], dir);
  writeFileSync(join(dir, "README.md"), "seed\n");
  await run(["git", "add", "-A"], dir);
  await run(["git", "commit", "-m", "seed"], dir);
}

// A bare "origin" plus two independent clones, each standing in for a
// separate watcher process/machine claiming against the same repo.
async function bareOriginWithClones(root: string, names: string[]): Promise<{ bare: string; clones: string[] }> {
  const bare = join(root, "origin.git");
  mkdirSync(bare, { recursive: true });
  await run(["git", "init", "--bare", "-b", "main", bare], root);

  const seed = join(root, "seed");
  mkdirSync(seed, { recursive: true });
  await initSeededRepo(seed);
  await run(["git", "remote", "add", "origin", bare], seed);
  await run(["git", "push", "origin", "main"], seed);

  const clones = names.map((n) => join(root, n));
  for (const clone of clones) await run(["git", "clone", bare, clone], root);
  return { bare, clones };
}

describe("Git.claim (compare-and-swap)", () => {
  test("two clones racing on the same issue: exactly one wins the push", async () => {
    const root = tmpRoot();
    const { bare, clones } = await bareOriginWithClones(root, ["clone-a", "clone-b"]);
    const git = new Git(new GitCommandRunner());

    const [wonA, wonB] = await Promise.all([git.claim(clones[0]!, 42, "main"), git.claim(clones[1]!, 42, "main")]);
    expect([wonA, wonB].filter(Boolean)).toHaveLength(1);

    const branches = await run(["git", "ls-remote", "--heads", bare, "factory/issue-42"], root);
    expect(branches.trim().split("\n").filter(Boolean)).toHaveLength(1);
  });

  test("claiming twice sequentially: the second call loses, it does not silently no-op win", async () => {
    const root = tmpRoot();
    const { clones } = await bareOriginWithClones(root, ["clone-a", "clone-b"]);
    const git = new Git(new GitCommandRunner());

    expect(await git.claim(clones[0]!, 7, "main")).toBe(true);
    // The old implementation pushed the same base SHA both times, which is a
    // fast-forward no-op — both calls exited 0. This must not happen: B's
    // claim commit descends from base, not from A's now-pushed claim commit,
    // so it cannot fast-forward.
    expect(await git.claim(clones[1]!, 7, "main")).toBe(false);
  });

  test("claiming against a base that doesn't exist on origin fails cleanly", async () => {
    const root = tmpRoot();
    const { clones } = await bareOriginWithClones(root, ["clone-a"]);
    const git = new Git(new GitCommandRunner());
    expect(await git.claim(clones[0]!, 1, "no-such-branch")).toBe(false);
  });
});

describe("Git.commitAll", () => {
  test("commits everything except .factory/runs", async () => {
    const root = tmpRoot();
    const repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    await initSeededRepo(repo);

    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
    mkdirSync(join(repo, ".factory", "runs", "issue-1"), { recursive: true });
    writeFileSync(join(repo, ".factory", "runs", "issue-1", "triage.json"), "{}");

    const git = new Git(new GitCommandRunner());
    expect(await git.commitAll(repo, "factory: build #1")).toBe(true);

    const files = (await run(["git", "show", "--name-only", "--pretty=", "HEAD"], repo)).split("\n").filter(Boolean);
    expect(files).toContain("src/a.ts");
    expect(files).not.toContain(".factory/runs/issue-1/triage.json");

    // The runs directory is still on disk for the stage that wrote it — just
    // never committed to the repo history. --untracked-files=all so an
    // untracked dir isn't collapsed to its own line, hiding the path we want.
    const status = await run(["git", "status", "--porcelain", "--untracked-files=all"], repo);
    expect(status).toContain(".factory/runs/issue-1/triage.json");
  });

  test("returns false when the only changes are under .factory/runs", async () => {
    const root = tmpRoot();
    const repo = join(root, "repo");
    mkdirSync(repo, { recursive: true });
    await initSeededRepo(repo);
    mkdirSync(join(repo, ".factory", "runs", "issue-1"), { recursive: true });
    writeFileSync(join(repo, ".factory", "runs", "issue-1", "x.json"), "{}");

    const git = new Git(new GitCommandRunner());
    expect(await git.commitAll(repo, "factory: build #1")).toBe(false);
  });
});

describe("Git.changedFiles", () => {
  test("reports files changed on the branch versus its base", async () => {
    const root = tmpRoot();
    const { clones } = await bareOriginWithClones(root, ["clone-a"]);
    const clone = clones[0]!;
    await run(["git", "checkout", "-b", "factory/issue-5"], clone);
    writeFileSync(join(clone, "src.ts"), "changed\n");
    await run(["git", "add", "-A"], clone);
    await run(["git", "commit", "-m", "change"], clone);

    const git = new Git(new GitCommandRunner());
    expect(await git.changedFiles(clone, "main")).toEqual(["src.ts"]);
  });

  test("reports nothing when the branch hasn't diverged from base", async () => {
    const root = tmpRoot();
    const { clones } = await bareOriginWithClones(root, ["clone-a"]);
    const git = new Git(new GitCommandRunner());
    expect(await git.changedFiles(clones[0]!, "main")).toEqual([]);
  });
});
