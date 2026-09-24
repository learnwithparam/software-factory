import { describe, expect, test } from "bun:test";
import type { StageName } from "../src/executor";
import { stageSettings } from "../src/stage-permissions";

const STAGES: StageName[] = ["triage", "plan", "build", "verify", "pr"];

describe("stageSettings", () => {
  for (const stage of STAGES) {
    test(`${stage}: valid JSON, may write only its own run dir (build also source), no deny key`, () => {
      const parsed = JSON.parse(stageSettings(stage, 15));
      const allow: string[] = parsed.permissions.allow;
      expect(allow).toContain("Edit(.factory/runs/issue-15/**)");
      expect(allow.includes("Edit(**)")).toBe(stage === "build");
      expect(parsed.permissions.deny).toBeUndefined();
      expect(allow.some((r) => /gh|push|merge/.test(r))).toBe(false);
    });
  }

  test("only verify may stash or checkout (revert-to-fail); no other stage can", () => {
    for (const stage of STAGES) {
      const allow: string[] = JSON.parse(stageSettings(stage, 1)).permissions.allow;
      expect(allow.includes("Bash(git checkout *)")).toBe(stage === "verify");
    }
  });
});

describe("repo-supplied agent commands", () => {
  const extra = { read: ["npm run lint"], build: ["npm test *"], verify: ["pytest *"] };

  test("no stage assumes bun or make without config", () => {
    for (const stage of STAGES) {
      const allow: string[] = JSON.parse(stageSettings(stage, 1)).permissions.allow;
      expect(allow.some((r) => /bun|make/.test(r))).toBe(false);
    }
  });

  test("read applies everywhere; build and verify grants stay in their own stage", () => {
    for (const stage of STAGES) {
      const allow: string[] = JSON.parse(stageSettings(stage, 1, extra)).permissions.allow;
      expect(allow.includes("Bash(npm run lint)")).toBe(true);
      expect(allow.includes("Bash(npm test *)")).toBe(stage === "build");
      expect(allow.includes("Bash(pytest *)")).toBe(stage === "verify");
    }
  });
});
