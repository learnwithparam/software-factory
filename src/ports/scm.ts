// What the factory needs from a code host: issues, comments, labels and PRs.
// GitHub (and GHE through GH_HOST) is the adapter today, in src/github.ts; a
// GitLab or Bitbucket adapter implements this same interface.

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
  comments: GhComment[];
  // Only populated by getIssue (blockers.ts is the one caller that needs
  // them); listIssuesByLabel and listOpenIssues leave both undefined.
  state?: "OPEN" | "CLOSED";
  stateReason?: string | null;
}

export interface GhComment {
  id: number;
  author: string;
  authorAssociation: string;
  body: string;
  createdAt: string;
}

export interface CreatePrOptions {
  repo: string;
  base: string;
  head: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface GhPr {
  number: number;
  url: string;
  state: string;
  headRefName: string;
  isDraft: boolean;
  closingIssuesReferences?: { number: number }[];
}

export interface CiCheck {
  readonly name?: string;
  readonly context?: string;
  readonly status?: string;
  readonly state?: string;
  readonly conclusion?: string;
}

export interface PrStatus {
  readonly state: "open" | "closed" | "merged";
  readonly headRefOid: string;
  readonly closingIssuesReferences: readonly { number: number }[];
  readonly statusCheckRollup: readonly CiCheck[];
}

// merge-policy.ts's readiness snapshot (src/merge-policy.ts). mergeable and
// reviewDecision come straight off `gh pr view`; hasUnresolvedReviewThreads
// needs a separate GraphQL call, since neither `gh pr view` nor `gh pr
// checks` exposes thread resolution.
export interface MergeReadiness {
  readonly state: "open" | "closed" | "merged";
  readonly isDraft: boolean;
  readonly baseRefName: string;
  readonly headRefOid: string;
  readonly mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  readonly reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "";
  readonly hasUnresolvedReviewThreads: boolean;
  // Every CHANGES_REQUESTED review is against a commit the head has since
  // moved past (v2.9.0 item 3, from assembler's unmerged fix branch, idea
  // only, no code copied): a reviewer who asked for changes on an old commit
  // no longer blocks a PR that has since been updated.
  readonly changesRequestedStale: boolean;
}

export interface ScmPort {
  listIssuesByLabel(repo: string, label: string): Promise<GhIssue[]>;
  getIssue(repo: string, number: number): Promise<GhIssue>;
  listOpenIssues(repo: string): Promise<GhIssue[]>;
  commentIssue(repo: string, number: number, body: string): Promise<number | undefined>;
  editComment(repo: string, commentId: number, body: string): Promise<void>;
  addLabels(repo: string, number: number, labels: string[]): Promise<void>;
  removeLabels(repo: string, number: number, labels: string[]): Promise<void>;
  setStateLabel(repo: string, number: number, current: string[], next: string): Promise<void>;
  closeIssue(repo: string, number: number): Promise<void>;
  reopenIssue(repo: string, number: number): Promise<void>;
  createIssue(repo: string, title: string, body: string, labels: string[]): Promise<number>;
  createPr(opts: CreatePrOptions): Promise<string>;
  listPrs(repo: string, opts?: { state?: string }): Promise<GhPr[]>;
  findPrByHead(repo: string, head: string): Promise<GhPr | undefined>;
  prFeedback(repo: string, head: string): Promise<GhComment[]>;
  markReady(repo: string, ref: string | number, ready: boolean): Promise<void>;
  closePr(repo: string, number: number): Promise<void>;
  prStatus(repo: string, number: number): Promise<PrStatus>;
  mergeReadiness(repo: string, number: number): Promise<MergeReadiness>;
  prDiff(repo: string, prNumber: number): Promise<string>;
  prForIssue(repo: string, issueNumber: number, opts?: { excludeHead?: string }): Promise<GhPr | undefined>;
  mergePr(repo: string, number: number, headSha: string): Promise<void>;
  listLabels(repo: string): Promise<string[]>;
  ensureLabel(repo: string, name: string, color: string, description: string): Promise<void>;
  currentLogin(): Promise<string>;
  authStatus(): Promise<{ ok: boolean; detail: string }>;
}
