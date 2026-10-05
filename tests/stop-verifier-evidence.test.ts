// Exercises template/.claude/hooks/stop-verifier-evidence.sh as Claude Code
// calls it on SubagentStop (fields measured on claude 2.1.289).

import { expect, test } from "bun:test";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "..", "template", ".claude", "hooks", "stop-verifier-evidence.sh");

async function subagentStop(event: Record<string, unknown>, stage: string | null = "verify"): Promise<{ code: number; reason?: string }> {
  const { FACTORY_STAGE: _s, ...base } = process.env;
  const input = { hook_event_name: "SubagentStop", agent_type: "factory-verifier", stop_hook_active: false, ...event };
  const proc = Bun.spawn(["bash", HOOK], { stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe", env: stage ? { ...base, FACTORY_STAGE: stage } : base });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const reply = out.trim() ? (JSON.parse(out) as { decision: string; reason: string }) : undefined;
  if (reply) expect(reply.decision).toBe("block");
  return { code, reason: reply?.reason };
}

// Lines quoted from the splitbill-demo verify transcripts (#46, #47, #73, #75), plus one
// that names a command holding dots.
const REFUSED = [
  "Permission to use Bash has been denied because Claude Code is running in don't ask mode",
  "AC-4 could not verify: the revert command was refused.",
  "I couldn't verify AC-2 because the shell was denied.",
  "The command `bun test tests/a.test.ts` was refused.",
  "Unable to verify the mutation step.",
];

for (const text of REFUSED) {
  test(`sends the verifier back once: ${text}`, async () => {
    const first = await subagentStop({ last_assistant_message: text });
    expect(first.reason).toContain("one simple command per call");
    expect(await subagentStop({ last_assistant_message: text, stop_hook_active: true })).toEqual({ code: 0, reason: undefined });
  });
}

test("a feature that denies access is a result, not a refusal", async () => {
  expect((await subagentStop({ last_assistant_message: "AC-2 pass: unauthenticated GET /admin is denied with 403 (curl exit 0)." })).reason).toBeUndefined();
  expect((await subagentStop({ last_assistant_message: "AC-3 pass: writing /etc/x fails with Permission denied (exit 1)." })).reason).toBeUndefined();
});

test("passes a verifier report with evidence", async () => {
  expect(await subagentStop({ last_assistant_message: "AC-1 PASS: `bun test` exit 0. AC-2 PASS: `git diff --stat main HEAD` shows README.md." })).toEqual({ code: 0, reason: undefined });
});

test("ignores other subagents, sessions outside a stage, and bad input", async () => {
  expect((await subagentStop({ agent_type: "factory-reviewer", last_assistant_message: REFUSED[0] })).reason).toBeUndefined();
  expect((await subagentStop({ last_assistant_message: REFUSED[0] }, null)).reason).toBeUndefined();
  expect((await subagentStop({ last_assistant_message: 42 })).code).toBe(0);
});
