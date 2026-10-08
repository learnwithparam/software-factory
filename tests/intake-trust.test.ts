// Intake trust (P36): factory:ready starts a run only when someone with write
// access or higher applied it.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeConfig } from "../src/config";
import { LABEL } from "../src/labels";
import { FactoryState } from "../src/state";
import { advanceIssue } from "../src/watch";
import { GitHub, type RepoRole } from "../src/github";
import { baseIssue, FakeGateRunner, FakeGit, FakeGitHub, FakeHoldoutRunner, MultiStageExecutor } from "./harness";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function setup(labeler: string | undefined, role?: RepoRole) {
  const [cloneDir, workspacesDir] = [mkdtempSync(join(tmpdir(), "trust-clone-")), mkdtempSync(join(tmpdir(), "trust-ws-"))];
  dirs.push(cloneDir, workspacesDir);
  const github = new FakeGitHub([baseIssue(1, [LABEL.ready])]);
  github.labelers.set(1, labeler);
  if (labeler && role) github.roles.set(labeler, role);
  const git = new FakeGit();
  const deps = { github, git, state: new FactoryState(":memory:"), executor: new MultiStageExecutor(), gateRunner: new FakeGateRunner(), holdoutRunner: new FakeHoldoutRunner(), cloneDir, workspacesDir };
  const run = () => advanceIssue(deps, mergeConfig({ repo: "acme/widgets" }), github.issues.get(1)!);
  return { github, git, run };
}

const labels = (gh: FakeGitHub) => gh.issues.get(1)!.labels.map((l) => l.name);
const lastComment = (gh: FakeGitHub) => gh.issues.get(1)!.comments.at(-1)?.body ?? "";

describe("intake trust", () => {
  test.each(["read", "triage", "none"] as const)("a %s user's factory:ready is removed with a reason, and nothing runs", async (role) => {
    const { github, git, run } = setup("drive-by", role);
    expect(await run()).toBe("untrusted");
    expect(labels(github)).not.toContain(LABEL.ready);
    expect(labels(github)).not.toContain(LABEL.triaging);
    expect(lastComment(github)).toContain(`@drive-by has the ${role} role`);
    expect(git.claims).toBe(0);
  });

  test("no labelled event in the history is not trusted either", async () => {
    const { github, run } = setup(undefined);
    expect(await run()).toBe("untrusted");
    expect(lastComment(github)).toContain("does not say who applied it");
  });

  test.each(["write", "maintain", "admin"] as const)("a %s user's factory:ready starts the run", async (role) => {
    const { github, git, run } = setup("dev", role);
    // Stop right after the claim: trust let it through, which is all this asserts.
    git.claimResult = false;
    expect(await run()).toBe("lost-claim");
    expect(git.claims).toBe(1);
    expect(lastComment(github)).not.toContain("was removed");
  });
});

describe("GitHub.labeledBy and roleOf", () => {
  const runner = (code: number, stdout: string, stderr = "") => ({
    calls: [] as string[][],
    async run(args: string[]) {
      this.calls.push(args);
      return { code, stdout, stderr };
    },
  });

  test("labeledBy is the last person to apply the label", async () => {
    expect(await new GitHub(runner(0, "alice\nbob\n")).labeledBy("acme/widgets", 1, LABEL.ready)).toBe("bob");
    expect(await new GitHub(runner(0, "")).labeledBy("acme/widgets", 1, LABEL.ready)).toBeUndefined();
  });

  test("roleOf reads the role name; a 404 is none; any other failure throws", async () => {
    expect(await new GitHub(runner(0, "maintain\n")).roleOf("acme/widgets", "dev")).toBe("maintain");
    expect(await new GitHub(runner(1, "", "gh: Not Found (HTTP 404)")).roleOf("acme/widgets", "stranger")).toBe("none");
    expect(new GitHub(runner(1, "", "gh: Server Error (HTTP 502)")).roleOf("acme/widgets", "dev")).rejects.toThrow();
  });

  test("an unknown role string is not trusted", async () => {
    expect(await new GitHub(runner(0, "superuser\n")).roleOf("acme/widgets", "dev")).toBe("none");
  });
});
