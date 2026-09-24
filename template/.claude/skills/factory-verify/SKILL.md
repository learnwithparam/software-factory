---
name: factory-verify
description: Verifies a build against its plan by running the factory-verifier and factory-reviewer subagents, then writes a pass, reject, or uncertain verdict with per-AC evidence and a test-that-bites proof. Use as the verification stage, after build finished.
---

# factory-verify

Invoked as `/factory-verify <N>`. No push, no `gh` access — write files,
the runner posts the verdict and moves the issue's label.

## 1. Read the inputs

- `.factory/runs/issue-<N>/issue.json`, `plan.json`, `plan-comment.md`,
  `build.json` — the plan's AC-n and NG-n, and what build reports it did,
  including build's own `rounds` count.
- `.factory/runs/issue-<N>/gate.json`: what the runner measured after build
  (`line`, `status`, `tree`). If its `tree` equals `git rev-parse HEAD^{tree}`,
  the gate result is current: use it and do not re-run the gates. If the tree
  differs, or the file is missing, the evidence is stale: report `uncertain`.
- The worktree at its current state (build's commits, uncommitted or not).
- `.factory/runs/issue-<N>/verdict.json`, if present from a prior round, to
  read its `rounds` so you increment it, not reset it. The runner tracks
  the reject count itself for routing; this field is your own record.

## 2. Run the subagents

Dispatch to `factory-verifier` (fresh context): it reverts the non-test
hunks, confirms each new test fails without them, restores the change,
confirms the gate is green, and checks that every AC has real evidence —
not a claim, an actual command and its output. "When uncertain, reject" is
its rule, not yours to override.

Dispatch to `factory-reviewer` (fresh context, read-only): correctness,
security (injection, authz, secrets), and whether the diff crosses any
NG-n. Collect its findings verbatim; do not soften or drop one.

Then re-check each finding yourself against the diff at the current head. Drop
one the code does not support (confidence 0-2); keep the rest. Never keep a
finding you could not reproduce from the diff.

## 3. Decide the verdict

- **pass** — every AC has evidence, the gate is green, no NG-n crossed, no
  blocking reviewer finding. A `pass` that lists a `must` or `should` finding
  at confidence 3 or more, or a criterion that is not `pass`, is refused by the
  runner and goes to a human.
- **reject** — any AC unproven, gate red, an NG-n crossed, or a blocking
  finding. The runner sends the issue back to `factory-build` up to twice;
  a third reject is routed to a human automatically, so just report
  `reject` honestly each time rather than trying to track the limit
  yourself.
- **uncertain** — the verifier or reviewer could not reach a confident
  answer, or round limit hit. Route to a human, don't guess.

## 4. Write the outputs

Use `factory-comment`'s `verdict.md` template for
`.factory/runs/issue-<N>/verdict-comment.md`: per-AC pass/fail with the
evidence command and result, the test-that-bites (name, failing output on
`main`, passing output here), reviewer findings verbatim, a summary of
non-goals respected, and — on reject — which round this is.

Then write `.factory/runs/issue-<N>/verdict.json`:

```json
{
  "result": "pass",
  "rounds": 1,
  "findings": [],
  "criteria": [{ "id": "AC-1", "status": "pass" }]
}
```

A finding is `{ "severity": "must|should|could", "confidence": 0-5, "what": "...",
"where": "file:line", "why": "...", "fix": "..." }` (`what` is required). A
criterion is `pass`, `fail`, or `unverified` (with a `gap`); AC ids come from the
plan and are never renumbered. No other fields are allowed, and the file must be
one JSON object under 16 KiB.

Set `outcome` to `blocked` (with a `summary`) only if you could not review at all.

`result` is `pass`, `reject`, or `uncertain`. `findings` is the reviewer's
list verbatim (empty array if none). On `reject`, the runner sends the
issue back to `factory-build`, up to twice; a third reject, or an
`uncertain` verdict at any round, routes to `factory:needs-human` instead
of looping again.
