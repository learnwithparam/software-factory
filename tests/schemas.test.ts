// The schemas and the validators must agree: same fields, and the fixture
// artifacts the validators accept satisfy the schema's required list.

import { expect, test, describe } from "bun:test";
import { STEP_KEYS, validateStepJson, validateVerdict, type ArtifactStage } from "../src/artifacts";
import { replySchema, stageSchema } from "../src/schemas";

const STAGES: ArtifactStage[] = ["triage", "plan", "build", "verify", "pr"];
const GOOD: Record<ArtifactStage, object> = {
  triage: { disposition: "proceed", type: "bug", risk: "low", done_when: "x", files_expected: [], gate_level: "g", confidence: 0.9 },
  plan: { risk: "low", revision: 1, files: [], autoApproveEligible: true },
  build: { status: "green", gate_line: "l", rounds: 1 },
  verify: { result: "pass", rounds: 1, findings: [] },
  pr: {},
};

test("every stage has a schema whose properties are exactly the validator's fields", () => {
  for (const stage of STAGES) {
    const s = stageSchema(stage) as { properties: object; required: string[]; additionalProperties: boolean };
    const keys = Object.keys(s.properties);
    if (stage !== "verify") expect(keys.sort(), stage).toEqual([...STEP_KEYS[stage as Exclude<ArtifactStage, "verify">]].sort());
    expect(s.additionalProperties).toBe(false);
    for (const r of s.required) expect(keys, `${stage}: required ${r} is not a property`).toContain(r);
  }
});

test("a good artifact for each stage satisfies the schema's required list and the validator", () => {
  for (const stage of STAGES) {
    const good = GOOD[stage] as Record<string, unknown>;
    for (const r of (stageSchema(stage) as { required: string[] }).required) expect(good, `${stage}.${r}`).toHaveProperty(r);
    expect(stage === "verify" ? validateVerdict(good).ok : validateStepJson(stage, good).ok, stage).toBe(true);
  }
});

test("the reply schema wraps the stage schema", () => {
  const r = replySchema("plan") as { properties: { artifact: unknown } };
  expect(r.properties.artifact).toEqual(stageSchema("plan"));
});

describe("validators enforce the schema, not just the key list", () => {
  test("a missing required field or a bad enum fails; a blocked step owes only its outcome", () => {
    expect(validateStepJson("plan", { risk: "low" })).toEqual({ ok: false, reason: 'plan.json: "revision" is required' });
    expect(validateStepJson("build", { status: "purple", gate_line: "x", rounds: 1 }).ok).toBe(false);
    expect(validateStepJson("triage", { outcome: "blocked", summary: "no sandbox key" })).toEqual({ ok: true });
  });

  test("a blocked verify with no verdict is accepted so the runner can route it", () => {
    const r = validateVerdict({ outcome: "blocked", summary: "cannot run the tests" });
    expect(r.ok).toBe(true);
    expect(validateVerdict({ outcome: "complete" }).ok).toBe(false);
  });
});
