// JSON Schema (draft-07) for each stage artifact. The property lists come from
// STEP_KEYS and VERDICT_KEYS in artifacts.ts, so the validators stay the one
// definition of which fields exist; only the field types are written here.

import { type ArtifactStage, STEP_KEYS, VERDICT_KEY_LIST } from "./artifacts";

type Prop = Record<string, unknown>;
const str: Prop = { type: "string" };
const int: Prop = { type: "integer" };
const strings: Prop = { type: "array", items: str };
const outcome: Prop = { enum: ["complete", "blocked", "failed"] };
const risk: Prop = { enum: ["low", "medium", "high"] };

const TYPES: Record<ArtifactStage, Record<string, Prop>> = {
  triage: {
    disposition: { enum: ["proceed", "needs-info", "refused", "duplicate"] },
    type: { enum: ["bug", "feature", "docs", "security", "dependency"] },
    risk,
    done_when: str,
    files_expected: strings,
    gate_level: str,
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  plan: { status: { enum: ["needs-info"] }, risk, revision: int, files: strings, autoApproveEligible: { type: "boolean" }, commentId: int },
  build: { status: { enum: ["green", "red", "needs-info"] }, gate_line: str, rounds: int },
  verify: {
    result: { enum: ["pass", "reject", "uncertain"] },
    rounds: int,
    findings: { type: "array", items: { anyOf: [str, { type: "object" }] } },
    criteria: { type: "array", items: { type: "object" } },
  },
  pr: {},
};

const REQUIRED: Record<ArtifactStage, readonly string[]> = {
  triage: ["disposition", "type", "risk", "done_when", "files_expected", "gate_level", "confidence"],
  plan: ["risk", "revision", "files", "autoApproveEligible"],
  build: ["status", "gate_line", "rounds"],
  verify: ["result", "rounds", "findings"],
  pr: [],
};

export function stageSchema(stage: ArtifactStage): Record<string, unknown> {
  const keys = stage === "verify" ? VERDICT_KEY_LIST : STEP_KEYS[stage];
  const properties: Record<string, Prop> = {};
  for (const k of keys) properties[k] = k === "outcome" ? outcome : k === "summary" ? str : (TYPES[stage][k] ?? {});
  return { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties, required: REQUIRED[stage], additionalProperties: false };
}

// The read-only reply envelope around a stage's schema.
export function replySchema(stage: ArtifactStage): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: { artifact: stageSchema(stage), comment: str, question: str },
    required: ["artifact"],
    additionalProperties: false,
  };
}
