// Structural: every label that needs a human maps to exactly one inbox kind with
// at least one action, and no in-flight label does. A new parked or waiting
// state that is not added to WAITING fails here instead of going unseen.

import { describe, expect, test } from "bun:test";
import { parseChatOps } from "../src/chatops";
import type { GhIssue } from "../src/github";
import { InboxError, WAITING, WAITING_LABELS, act, buildInbox, commandText } from "../src/inbox";
import { LABELS, LABEL, PARKED_LABELS, STATE_LABELS } from "../src/labels";

const at = (n: number) => `2026-09-2${n}T10:00:00Z`;
function issue(number: number, label: string, body = "<!-- factory:plan v1 -->\nThe plan", when = at(1)): GhIssue {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    labels: [{ name: label }, { name: "bug" }],
    comments: [{ id: number, author: "op", authorAssociation: "OWNER", body, createdAt: when }],
  };
}

describe("inbox structure", () => {
  test("WAITING covers exactly the parked labels plus awaiting-approval and in-review", () => {
    expect(Object.keys(WAITING).sort()).toEqual([...WAITING_LABELS].sort());
    for (const p of PARKED_LABELS) expect(WAITING[p]).toBeDefined();
  });

  test("every factory state or parked label yields one item with actions, or none for in-flight labels", () => {
    const inFlight = new Set<string>([LABEL.ready, LABEL.triaging, LABEL.planning, LABEL.building, LABEL.verifying]);
    for (const l of LABELS.filter((x) => x.category === "state" || x.category === "parked")) {
      const items = buildInbox([issue(1, l.name)]);
      if (inFlight.has(l.name)) expect(items, l.name).toHaveLength(0);
      else {
        expect(items, l.name).toHaveLength(1);
        expect(items[0]!.actions.length, l.name).toBeGreaterThan(0);
      }
    }
    expect(STATE_LABELS.filter((s) => !inFlight.has(s) && !WAITING[s])).toEqual([]);
  });

  test("every action is a command the trust parser recognises", () => {
    for (const { actions } of Object.values(WAITING)) {
      for (const a of actions) {
        const parsed = parseChatOps(commandText(a, "some words"));
        expect(parsed.type).toBe(a);
      }
    }
  });
});

describe("buildInbox", () => {
  test("orders the longest-waiting item first, strips markers and control codes, and caps the ask", () => {
    const items = buildInbox([
      issue(2, LABEL.failed, "<!-- factory:data {\"stage\":\"build\"} -->\n\x1b[31mBuild broke\x1b[0m", at(3)),
      issue(1, LABEL.awaitingApproval, "<!-- factory:plan v1 -->\n" + "x".repeat(5000), at(2)),
    ]);
    expect(items.map((i) => i.issue)).toEqual([1, 2]);
    expect(items[0]!.ask.length).toBe(1200);
    expect(items[1]!.ask).toBe("Build broke");
    expect(items[1]!.kind).toBe("failed");
  });

  test("pages past one screen: 250 waiting issues all appear", () => {
    const many = Array.from({ length: 250 }, (_, i) => issue(i + 1, LABEL.needsHuman));
    expect(buildInbox(many)).toHaveLength(250);
  });
});

describe("act", () => {
  const item = { issue: 7, kind: "approve-plan" as const, actions: WAITING[LABEL.awaitingApproval]!.actions };
  test("posts the same comment a human would type", async () => {
    const posted: string[] = [];
    const github = { commentIssue: async (_r: string, _n: number, body: string) => (posted.push(body), 1) };
    expect(await act(github, "o/r", item, "approve")).toBe("/factory approve");
    expect(await act(github, "o/r", item, "revise", " cover zero ")).toBe("/factory revise cover zero");
    expect(posted).toEqual(["/factory approve", "/factory revise cover zero"]);
  });
  test("refuses an action the item does not offer, and text-less revise or answer", async () => {
    const github = { commentIssue: async () => 1 };
    await expect(act(github, "o/r", item, "retry")).rejects.toThrow(InboxError);
    await expect(act(github, "o/r", item, "revise", "  ")).rejects.toThrow(/needs text/);
    const q = { issue: 8, kind: "answer-question" as const, actions: WAITING[LABEL.needsInfo]!.actions };
    await expect(act(github, "o/r", q, "answer", "")).rejects.toThrow(/needs text/);
  });
  test("an answer is posted as plain text, not a command", async () => {
    const posted: string[] = [];
    const q = { issue: 8, kind: "answer-question" as const, actions: WAITING[LABEL.needsInfo]!.actions };
    await act({ commentIssue: async (_r, _n, b) => (posted.push(b), 1) }, "o/r", q, "answer", "USD only");
    expect(posted).toEqual(["USD only"]);
    expect(parseChatOps("USD only").type).toBe("answer");
  });
});
