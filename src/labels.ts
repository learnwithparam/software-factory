// Single source for every `factory:*` label plus the five issue-form type labels.
// Nothing else in this repo (or the template it installs) should spell a label
// string literally: import from here. tests/labels.test.ts greps for that.

export type LabelCategory = "state" | "parked" | "provenance" | "type";

export interface FactoryLabel {
  readonly name: string;
  readonly color: string;
  readonly description: string;
  readonly category: LabelCategory;
}

// The only place a `factory:*` label string is spelled out. Every other file
// (watch.ts, scan.ts, the dashboard) imports LABEL.* instead of writing the
// string itself — tests/labels.test.ts greps the rest of the tree for that.
export const LABEL = {
  ready: "factory:ready",
  triaging: "factory:triaging",
  planning: "factory:planning",
  awaitingApproval: "factory:awaiting-approval",
  building: "factory:building",
  verifying: "factory:verifying",
  inReview: "factory:in-review",
  needsInfo: "factory:needs-info",
  needsHuman: "factory:needs-human",
  failed: "factory:failed",
  monitor: "factory:monitor",
} as const;

// One state label at a time: where an issue sits in the lifecycle (plan section 1).
export const STATE_LABELS = [
  LABEL.ready,
  LABEL.triaging,
  LABEL.planning,
  LABEL.awaitingApproval,
  LABEL.building,
  LABEL.verifying,
  LABEL.inReview,
] as const;

// Parked: the loop stopped and a human (or a retry) is needed to continue.
export const PARKED_LABELS = [LABEL.needsInfo, LABEL.needsHuman, LABEL.failed] as const;

// Provenance: how the issue was filed.
export const PROVENANCE_LABELS = [LABEL.monitor] as const;

// Type: set by the issue form, read by triage/plan for risk policy.
export const TYPE_LABELS = ["bug", "feature", "docs", "security", "dependency"] as const;

export type StateLabel = (typeof STATE_LABELS)[number];
export type ParkedLabel = (typeof PARKED_LABELS)[number];
export type ProvenanceLabel = (typeof PROVENANCE_LABELS)[number];
export type TypeLabel = (typeof TYPE_LABELS)[number];
export type AnyFactoryLabel = StateLabel | ParkedLabel | ProvenanceLabel;

const STATE_COLOR = "0e8a16"; // green: the loop is actively moving this
const PARKED_COLOR = "d93f0b"; // orange/red: stopped, needs a human
const PROVENANCE_COLOR = "5319e7"; // purple: how it got filed
const TYPE_COLOR: Record<TypeLabel, string> = {
  bug: "d73a4a",
  feature: "a2eeef",
  docs: "0075ca",
  security: "b60205",
  dependency: "fbca04",
};

const STATE_DESCRIPTIONS: Record<StateLabel, string> = {
  "factory:ready": "Human marked this ready for the loop to pick up",
  "factory:triaging": "factory-triage is classifying this issue",
  "factory:planning": "factory-plan is writing the plan comment",
  "factory:awaiting-approval": "Plan posted, waiting on /factory approve",
  "factory:building": "factory-build is making the change on factory/issue-N",
  "factory:verifying": "factory-verifier and factory-reviewer are checking the diff",
  "factory:in-review": "Draft PR open, waiting on human review and merge",
};

const PARKED_DESCRIPTIONS: Record<ParkedLabel, string> = {
  "factory:needs-info": "Waiting on an answer to a question comment",
  "factory:needs-human": "Refused, or unresolved after two rounds; a human decides",
  "factory:failed": "A stage broke (timeout, red gates, boundary, denied tool); /factory retry resumes",
};

const PROVENANCE_DESCRIPTIONS: Record<ProvenanceLabel, string> = {
  "factory:monitor": "Filed by factory scan from a production signal",
};

const TYPE_DESCRIPTIONS: Record<TypeLabel, string> = {
  bug: "Something behaves incorrectly",
  feature: "A new capability",
  docs: "Documentation only",
  security: "A vulnerability or authorization gap",
  dependency: "A package upgrade or advisory",
};

export const LABELS: readonly FactoryLabel[] = [
  ...STATE_LABELS.map((name) => ({
    name,
    color: STATE_COLOR,
    description: STATE_DESCRIPTIONS[name],
    category: "state" as const,
  })),
  ...PARKED_LABELS.map((name) => ({
    name,
    color: PARKED_COLOR,
    description: PARKED_DESCRIPTIONS[name],
    category: "parked" as const,
  })),
  ...PROVENANCE_LABELS.map((name) => ({
    name,
    color: PROVENANCE_COLOR,
    description: PROVENANCE_DESCRIPTIONS[name],
    category: "provenance" as const,
  })),
  ...TYPE_LABELS.map((name) => ({
    name,
    color: TYPE_COLOR[name],
    description: TYPE_DESCRIPTIONS[name],
    category: "type" as const,
  })),
];

export function findLabel(name: string): FactoryLabel | undefined {
  return LABELS.find((l) => l.name === name);
}

// Labels that mark an issue as "in the loop, not yet parked and not done".
// Used by watch.ts to compute the STOP_IF PR count and by the dashboard board columns.
export function isStateLabel(name: string): name is StateLabel {
  return (STATE_LABELS as readonly string[]).includes(name);
}

export function isParkedLabel(name: string): name is ParkedLabel {
  return (PARKED_LABELS as readonly string[]).includes(name);
}

// Strip every factory:* state/parked label from a label list, keeping type and monitor.
export function withoutLifecycleLabels(names: readonly string[]): string[] {
  return names.filter((n) => !isStateLabel(n) && !isParkedLabel(n));
}
