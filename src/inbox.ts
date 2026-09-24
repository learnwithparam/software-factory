// The one answer to "what is waiting for me?". Derived from labels and the
// thread (GitHub stays the only state); acting posts the same comment a human
// would type, so the CLI, the dashboard and a later chat channel all go
// through chatops.ts and its trust rule instead of a second command path.

import { parseChatOps } from "./chatops";
import { plain } from "./display";
import type { GhComment, GhIssue, GitHub } from "./github";
import { LABEL, PARKED_LABELS } from "./labels";

export type InboxKind = "approve-plan" | "answer-question" | "review-pr" | "parked" | "failed";
export type InboxAction = "approve" | "revise" | "answer" | "retry" | "cancel";

// Actions that carry the human's own words.
export const ACTIONS_WITH_TEXT: readonly InboxAction[] = ["revise", "answer"];

export interface InboxItem {
  readonly id: string;
  readonly kind: InboxKind;
  readonly issue: number;
  readonly title: string;
  readonly label: string;
  readonly waitingSince: string | undefined;
  readonly ask: string;
  readonly actions: readonly InboxAction[];
}

// Every label that means "a human is needed", and what they can do about it.
// tests/inbox.test.ts walks LABELS so a new waiting state cannot skip this table.
export const WAITING: Readonly<Record<string, { kind: InboxKind; actions: readonly InboxAction[] }>> = {
  [LABEL.awaitingApproval]: { kind: "approve-plan", actions: ["approve", "revise", "cancel"] },
  [LABEL.needsInfo]: { kind: "answer-question", actions: ["answer", "cancel"] },
  [LABEL.inReview]: { kind: "review-pr", actions: ["revise", "cancel"] },
  [LABEL.needsHuman]: { kind: "parked", actions: ["retry", "cancel"] },
  [LABEL.failed]: { kind: "failed", actions: ["retry", "cancel"] },
};

export const WAITING_LABELS: readonly string[] = [LABEL.awaitingApproval, LABEL.inReview, ...PARKED_LABELS];

const ASK_LIMIT = 1200;

function stripMarkers(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "").trim();
}

// The runner's latest comment is what the human is being asked about.
function latestRunnerComment(comments: readonly GhComment[]): GhComment | undefined {
  return [...comments].reverse().find((c) => c.body.includes("<!-- factory:") && !c.body.includes("<!-- factory:status"));
}

export function buildInbox(issues: readonly GhIssue[]): InboxItem[] {
  const items: InboxItem[] = [];
  for (const issue of issues) {
    const label = issue.labels.map((l) => l.name).find((n) => WAITING[n]);
    if (!label) continue;
    const { kind, actions } = WAITING[label]!;
    const comment = latestRunnerComment(issue.comments);
    items.push({
      id: `issue-${issue.number}`,
      kind,
      issue: issue.number,
      title: plain(issue.title),
      label,
      waitingSince: comment?.createdAt,
      ask: plain(stripMarkers(comment?.body ?? "")).slice(0, ASK_LIMIT),
      actions,
    });
  }
  return items.sort((a, b) => (a.waitingSince ?? "").localeCompare(b.waitingSince ?? "") || a.issue - b.issue);
}

export function commandText(action: InboxAction, text: string): string {
  if (action === "answer") return text;
  return action === "revise" ? `/factory revise ${text}` : `/factory ${action}`;
}

export class InboxError extends Error {}

export async function act(
  github: Pick<GitHub, "commentIssue">,
  repo: string,
  item: Pick<InboxItem, "issue" | "actions" | "kind">,
  action: InboxAction,
  text = "",
): Promise<string> {
  if (!item.actions.includes(action)) throw new InboxError(`${action} is not available for a ${item.kind} item`);
  const words = text.trim();
  if (ACTIONS_WITH_TEXT.includes(action) && !words) throw new InboxError(`${action} needs text`);
  const body = commandText(action, words);
  // Round-trip through the parser so a UI command fails exactly like a typed one would.
  if (action !== "answer" && parseChatOps(body).type !== action) throw new InboxError(`not a recognized /factory command: ${body}`);
  await github.commentIssue(repo, item.issue, body);
  return body;
}

// What a chat or push channel implements (v3.1): show the waiting items, and
// send replies back through `act`, so it shares the trust rule with everything else.
export interface InboxChannel {
  readonly name: string;
  send(items: readonly InboxItem[]): Promise<void>;
}

// `factory inbox [issue [action]] [--flag value] [--json]`: the positional words after the verb.
export function inboxPositionals(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--json") continue;
    if (argv[i]!.startsWith("--")) i++; // a flag and its value
    else out.push(argv[i]!);
  }
  return out;
}
