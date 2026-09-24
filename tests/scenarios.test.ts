// One offline replay test per branch of the issue state machine. Each row is
// a scenario a human can put the factory in; none needs a model or GitHub, so
// every path is proven on every `make check` instead of by a live run.
// The last test fails if a factory label exists that no scenario reaches.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, mergeConfig } from "../src/config";
import { runDir } from "../src/artifacts";
import type { StageName, StageRunResult } from "../src/executor";
import { FactoryState } from "../src/state";
import { LABEL } from "../src/labels";
import { advanceIssue, pollOnce, recoverInFlight } from "../src/watch";
import { baseIssue, FakeGateRunner, FakeGit, FakeGitHub, fixtureFor, MultiStageExecutor } from "./harness";

const seen = new Set<string>();
const initialLabels = new Map<object, string[]>();
const dirs: string[] = [];

function labels(github: FakeGitHub, n: number): string[] {
  return github.issues.get(n)!.labels.map((l) => l.name);
}

function setup(initial: string[], overrides: Partial<typeof DEFAULT_CONFIG> = {}, n = 1) {
  const workspacesDir = mkdtempSync(join(tmpdir(), "factory-ws-"));
  const cloneDir = mkdtempSync(join(tmpdir(), "factory-clone-"));
  dirs.push(workspacesDir, cloneDir);
  const github = new FakeGitHub([baseIssue(n, initial)]);
  const git = new FakeGit();
  const state = new FactoryState(":memory:");
  const executor = new MultiStageExecutor();
  const gateRunner = new FakeGateRunner();
  const config = mergeConfig({ repo: "acme/widgets", ...overrides });
  const deps = { github, git, state, executor, gateRunner, cloneDir, workspacesDir };
  initialLabels.set(github, initial);
  const step = async () => advanceIssue(deps, config, github.issues.get(n)!);
  const push = (stage: StageName, files: Record<string, string>, result?: Partial<StageRunResult>) =>
    executor.push(stage, n, fixtureFor(stage, n), files, result);
  return { n, github, git, state, executor, gateRunner, config, deps, step, push, workspacesDir };
}
type Ctx = ReturnType<typeof setup>;

const triage = (o: object = {}) => ({
  "triage-comment.md": "<!-- factory:triage v1 -->\ntriage",
  "triage.json": JSON.stringify({ disposition: "proceed", type: "bug", risk: "low", done_when: "x", files_expected: ["src/a.ts"], gate_level: "make check", confidence: 0.9, ...o }),
});
const question = (text = "Which one?") => ({ "question-comment.md": `<!-- factory:question v1 -->\n${text}` });
const plan = (risk: "low" | "medium", extra: object = {}, rev = 1) => ({
  "plan-comment.md": `<!-- factory:plan v1 rev=${rev} -->\nplan`,
  "plan.json": JSON.stringify({ risk, revision: rev, files: ["src/a.ts"], autoApproveEligible: risk === "low", ...extra }),
});
const build = () => ({
  "status-comment.md": "<!-- factory:status v1 -->\nbuilding",
  "build.json": JSON.stringify({ status: "green", gate_line: "ok", rounds: 1 }),
});
const verdict = (result: "pass" | "reject") => ({
  "verdict-comment.md": "<!-- factory:verdict v1 -->\nverdict",
  "verdict.json": JSON.stringify({ result, rounds: 1, findings: [] }),
});
const pr = () => ({ "pr-body.md": "Did it.\nCloses #1" });

// Pushes triage, plan, build, verify, pr for a straight run to in-review.
function happy(c: Ctx, risk: "low" | "medium" = "low") {
  c.push("triage", triage({ risk }));
  c.push("plan", plan(risk));
  build_to_pr(c);
}
function build_to_pr(c: Ctx) {
  c.push("build", build());
  c.push("verify", verdict("pass"));
  c.push("pr", pr());
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function done(c: Ctx) {
  for (const l of [...c.github.seenLabels, ...(initialLabels.get(c.github) ?? [])]) seen.add(l);
  c.state.close();
}

describe("approval paths", () => {
  test("1. low risk auto-approves and opens one draft PR", async () => {
    const c = setup([LABEL.ready]);
    c.state.setToggle("auto_approve_low_risk", true);
    happy(c);
    expect(await c.step()).toBe("shipped");
    expect(c.github.createdPrs).toHaveLength(1);
    expect(c.github.createdPrs[0]!.draft).toBe(true);
    // Draft while the factory works, ready for review on the hand-off.
    expect(c.github.readyCalls).toEqual([["factory/issue-1", true]]);
    expect(c.github.prs[0]!.isDraft).toBe(false);
    expect(labels(c.github, 1)).toEqual([LABEL.inReview]);
    done(c);
  });

  test("2. medium risk waits, then a trusted /factory approve ships", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", triage({ risk: "medium" }));
    c.push("plan", plan("medium"));
    expect(await c.step()).toBe("awaiting-approval");
    expect(labels(c.github, 1)).toEqual([LABEL.awaitingApproval]);
    expect(await c.step()).toBe("waiting");
    build_to_pr(c);
    c.github.say(1, "/factory approve");
    expect(await c.step()).toBe("shipped");
    done(c);
  });

  test("3. /factory revise re-plans at revision 2, then approve ships", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", triage({ risk: "medium" }));
    c.push("plan", plan("medium"));
    await c.step();
    c.push("plan", plan("medium", {}, 2));
    c.github.say(1, "/factory revise also cover the empty case");
    expect(await c.step()).toBe("awaiting-approval");
    expect(readFileSync(join(c.workspacesDir, "issue-1", runDir(1), "revise.md"), "utf8")).toBe("also cover the empty case");
    expect(c.github.issues.get(1)!.comments.filter((x) => x.body.includes("factory:plan v1")).length).toBe(2);
    build_to_pr(c);
    c.github.say(1, "/factory approve");
    expect(await c.step()).toBe("shipped");
    done(c);
  });

  test("4. /factory cancel clears the label and stops the run", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", triage({ risk: "medium" }));
    c.push("plan", plan("medium"));
    await c.step();
    c.github.say(1, "/factory cancel");
    expect(await c.step()).toBe("cancelled");
    expect(labels(c.github, 1)).toEqual([]);
    expect(c.state.getRun("acme/widgets", 1)!.status).toBe("cancelled");
    done(c);
  });

  test("18. an untrusted /factory approve is ignored", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", triage({ risk: "medium" }));
    c.push("plan", plan("medium"));
    await c.step();
    c.github.say(1, "/factory approve", "NONE");
    expect(await c.step()).toBe("waiting");
    expect(labels(c.github, 1)).toEqual([LABEL.awaitingApproval]);
    done(c);
  });

  test("7b. /factory retry at approval re-plans", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", triage({ risk: "medium" }));
    c.push("plan", plan("medium"));
    await c.step();
    c.push("plan", plan("medium", {}, 2));
    c.github.say(1, "/factory retry");
    expect(await c.step()).toBe("awaiting-approval");
    done(c);
  });
});

describe("needs-info paths", () => {
  test("5. triage question, answered, resumes at triage and continues", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", { ...triage({ disposition: "needs-info" }), ...question() });
    expect(await c.step()).toBe("needs-info");
    expect(await c.step()).toBe("waiting");
    c.push("triage", triage({ risk: "medium" }));
    c.push("plan", plan("medium"));
    c.github.say(1, "staging");
    expect(await c.step()).toBe("awaiting-approval");
    expect(readFileSync(join(c.workspacesDir, "issue-1", runDir(1), "answer.md"), "utf8")).toBe("staging");
    done(c);
  });

  test("6. a third unanswered round parks as needs-human", async () => {
    const c = setup([LABEL.ready]);
    const ask = { ...triage({ disposition: "needs-info" }), ...question() };
    c.push("triage", ask);
    expect(await c.step()).toBe("needs-info");
    c.push("triage", ask);
    c.github.say(1, "a");
    expect(await c.step()).toBe("needs-info");
    c.push("triage", ask);
    c.github.say(1, "b");
    expect(await c.step()).toBe("needs-human");
    expect(labels(c.github, 1)).toEqual([LABEL.needsHuman]);
    done(c);
  });

  test("7. plan asks a question and resumes at plan, not triage", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", triage({ risk: "medium" }));
    c.push("plan", { ...plan("medium", { status: "needs-info" }), ...question("Which API?") });
    expect(await c.step()).toBe("needs-info");
    // triage has nothing queued: resuming at triage would throw.
    c.push("plan", plan("medium"));
    c.github.say(1, "the v2 API");
    expect(await c.step()).toBe("awaiting-approval");
    done(c);
  });

  test("8. build asks a question and resumes at build", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", triage({ risk: "medium" }));
    c.push("plan", plan("medium"));
    await c.step();
    c.push("build", { ...build(), "build.json": JSON.stringify({ status: "needs-info", gate_line: "", rounds: 1 }), ...question("Rename it?") });
    c.github.say(1, "/factory approve");
    expect(await c.step()).toBe("needs-info");
    build_to_pr(c);
    c.github.say(1, "yes rename it");
    expect(await c.step()).toBe("shipped");
    done(c);
  });

  test("19. the runner's own comments are not read as an answer", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", { ...triage({ disposition: "needs-info" }), ...question() });
    await c.step();
    // A later runner comment, authored by the (OWNER) operator, carries a marker.
    await c.github.commentIssue("acme/widgets", 1, "status update\n\n<!-- factory:notice -->");
    expect(await c.step()).toBe("waiting");
    done(c);
  });
});

describe("failure paths", () => {
  test("9. a refused issue parks as needs-human and never plans", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", triage({ disposition: "refused" }));
    expect(await c.step()).toBe("needs-human");
    expect(labels(c.github, 1)).toEqual([LABEL.needsHuman]);
    done(c);
  });

  test("10. red gates fail the run; /factory retry resumes it", async () => {
    const c = setup([LABEL.ready]);
    c.state.setToggle("auto_approve_low_risk", true);
    c.gateRunner.line = "FACTORY_GATES: status=RED passed=1 failed=1 skipped=0 failed_gates=unit";
    c.push("triage", triage());
    c.push("plan", plan("low"));
    c.push("build", build());
    expect(await c.step()).toBe("failed");
    expect(c.state.getRun("acme/widgets", 1)!.reason).toContain("unit");
    c.gateRunner.line = "FACTORY_GATES: status=GREEN passed=2 failed=0 skipped=0 failed_gates=-";
    c.push("build", build());
    c.push("verify", verdict("pass"));
    c.push("pr", pr());
    c.github.say(1, "/factory retry");
    expect(await c.step()).toBe("shipped");
    done(c);
  });

  test("11. a third verify reject parks as needs-human", async () => {
    const c = setup([LABEL.ready]);
    c.state.setToggle("auto_approve_low_risk", true);
    c.push("triage", triage());
    c.push("plan", plan("low"));
    for (let i = 0; i < 3; i++) {
      c.push("build", build());
      c.push("verify", verdict("reject"));
    }
    expect(await c.step()).toBe("needs-human");
    expect(c.state.getRun("acme/widgets", 1)!.reason).toContain("rejected 3 times");
    done(c);
  });

  test("12. a protected path in the diff parks before any push", async () => {
    const c = setup([LABEL.ready], { protectedPaths: ["src/auth/**"] });
    c.state.setToggle("auto_approve_low_risk", true);
    c.git.changed = ["src/auth/token.ts"];
    c.push("triage", triage());
    c.push("plan", plan("low"));
    c.push("build", build());
    expect(await c.step()).toBe("needs-human");
    expect(c.git.pushed).toEqual([]);
    expect(c.state.getRun("acme/widgets", 1)!.reason).toContain("src/auth/token.ts");
    done(c);
  });

  test("13. a killed stage fails with the kill reason", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", triage(), { exitCode: 1, killedReason: "timed out after 15 minutes" });
    expect(await c.step()).toBe("failed");
    expect(c.state.getRun("acme/widgets", 1)!.reason).toBe("timed out after 15 minutes");
    done(c);
  });

  test("14. a refused tool call fails with the tool and path named", async () => {
    const c = setup([LABEL.ready]);
    c.push("triage", {}, { exitCode: 0, permissionDenials: ["Write .factory/runs/issue-1/triage.json"] });
    expect(await c.step()).toBe("failed");
    expect(c.state.getRun("acme/widgets", 1)!.reason).toContain("Write .factory/runs/issue-1/triage.json");
    done(c);
  });
});

describe("in-review and claim paths", () => {
  async function shipped() {
    const c = setup([LABEL.ready]);
    c.state.setToggle("auto_approve_low_risk", true);
    happy(c);
    await c.step();
    return c;
  }

  test("15. /factory revise on the issue rebuilds and updates the same PR", async () => {
    const c = await shipped();
    expect(await c.step()).toBe("waiting");
    build_to_pr(c);
    c.github.say(1, "/factory revise rename the helper");
    expect(await c.step()).toBe("shipped");
    expect(c.github.createdPrs).toHaveLength(1);
    // Back to draft for the rebuild, then ready again.
    expect(c.github.readyCalls).toEqual([["factory/issue-1", true], ["factory/issue-1", false], ["factory/issue-1", true]]);
    expect(c.github.prs[0]!.isDraft).toBe(false);
    expect(await c.step()).toBe("waiting"); // handled once, not re-triggered
    done(c);
  });

  test("16. /factory revise as a PR comment or review rebuilds the same PR", async () => {
    const c = await shipped();
    c.github.sayOnPr("/factory revise handle negative amounts", "NONE");
    expect(await c.step()).toBe("waiting"); // untrusted
    build_to_pr(c);
    c.github.sayOnPr("/factory revise handle negative amounts");
    expect(await c.step()).toBe("shipped");
    expect(c.github.createdPrs).toHaveLength(1);
    expect(await c.step()).toBe("waiting");
    done(c);
  });

  test("17. a lost claim removes factory:ready and comments once", async () => {
    const c = setup([LABEL.ready]);
    c.git.claimResult = false;
    expect(await c.step()).toBe("lost-claim");
    expect(labels(c.github, 1)).toEqual([]);
    expect(await c.step()).toBe("waiting");
    expect(c.github.issues.get(1)!.comments).toHaveLength(1);
    done(c);
  });

  test("20. recoverInFlight re-drives an issue left in factory:building", async () => {
    const c = setup([LABEL.building]);
    c.github.issues.get(1)!.comments = [
      { id: 1, author: "bot", authorAssociation: "OWNER", body: `<!-- factory:data ${JSON.stringify({ stage: "plan", json: { risk: "low" } })} -->`, createdAt: "2026-01-01T00:00:00Z" },
    ];
    build_to_pr(c);
    expect(await recoverInFlight(c.deps, c.config)).toEqual([1]);
    expect(labels(c.github, 1)).toEqual([LABEL.inReview]);
    done(c);
  });

  test("21. STOP_IF stops new pickups but not approvals on existing runs", async () => {
    const c = setup([LABEL.ready], { maxOpenFactoryPrs: 3 });
    for (const [i, head] of ["factory/issue-90", "factory/issue-91", "factory/issue-92"].entries()) {
      c.github.prs.push({ number: 90 + i, url: "u", state: "open", headRefName: head, isDraft: true });
    }
    const waiting = baseIssue(2, [LABEL.awaitingApproval]);
    waiting.comments = [{ id: 5, author: "bot", authorAssociation: "OWNER", body: "<!-- factory:plan v1 rev=1 -->", createdAt: "2026-01-01T00:00:00Z" }];
    c.github.issues.set(2, waiting);
    c.github.say(2, "/factory cancel");
    const result = await pollOnce(c.deps, c.config);
    expect(result.paused).toBe(true);
    expect(result.processed).toEqual([2]);
    expect(labels(c.github, 1)).toEqual([LABEL.ready]);
    done(c);
  });
});

test("every state and parked label is reached by a scenario", () => {
  const unreached = Object.values(LABEL).filter((l) => l !== LABEL.monitor && !seen.has(l));
  expect(unreached).toEqual([]);
});
