---
name: factory-verify
description: Verifies a build against its plan by running the factory-verifier and factory-reviewer subagents, then writes a pass, reject, or uncertain verdict with per-AC evidence and a test-that-bites proof. Use as the verification stage, after build finished.
---

# factory-verify

Invoked as `/factory-verify <N>`. No push, no `gh` access — write files,
the runner posts the verdict and moves the issue's label.

## 1. Read the inputs

- `.factory/runs/issue-<N>/issue.json`, `plan.json`, `plan-comment.md`,
  `build.json` — the plan's AC-n and NG-n, and what build reports it did.
- `.factory/runs/issue-<N>/gate.json`: what the runner measured after build
  (`line`, `status`, `tree`). If its `tree` equals `git rev-parse HEAD^{tree}`,
  the gate result is current: use it and do not re-run the gates. If the tree
  differs, or the file is missing, the evidence is stale: report `uncertain`.
- The worktree at its current state (build's commits, uncommitted or not).
  Write `"rounds": 1`; the runner counts verify rounds itself and replaces
  the value. Holdout results are the runner's too: it runs them and posts a
  reject comment on failure before this skill is ever invoked again, so the
  skill never reads the holdout paths.

## 2. UI route: the visual check

Skip unless `triage.json`'s `type` is `ui`. Read `build.json`'s `screenshots`
array against `.claude/skills/lwp-design/SKILL.md`'s state list and rubric.
Every state x viewport (390, 1440) x theme (light, dark) combination the
plan's AC-n list covers needs an entry; a gap is a `must` finding at
confidence 5, and the verdict cannot be `pass`. Read each screenshot (a
worktree file, not a URL) against lwp-design's five-criterion rubric
(hierarchy, 390px thumb reach, AA contrast, token use, restraint, each
1-5); any criterion under 4 is a `should` finding naming the screenshot,
the criterion and the score, and three or more such findings become a
`must`. This runs alongside, not instead of, step 3: a `ui`-typed issue
still needs a green gate and every AC proven.

## 3. Run the subagents

Read `plan.json`'s `proof` (absent means `test`) and pass it to
`factory-verifier`.

Dispatch to `factory-verifier` (fresh context): under `proof: "test"` it
reverts the non-test hunks, confirms each new test fails without them,
restores the change, confirms the gate is green, and checks that every AC
has real evidence — not a claim, an actual command and its output. Under
`proof: "check"` it skips the revert step (there is no test to prove), and
instead re-runs every check command the plan named and confirms each
proves its AC; it never asks for or expects a test. "When uncertain,
reject" is its rule either way, not yours to override.

Dispatch to `factory-reviewer` (fresh context, read-only): correctness,
security (injection, authz, secrets), and whether the diff crosses any
NG-n. Collect its findings verbatim, do not soften or drop one, then
re-check each yourself against the diff at the current head. Drop one the
code does not support (confidence 0-2); never keep a finding you could not
reproduce from the diff.

## 4. Decide the verdict

- **pass** — every AC has evidence, the gate is green, no NG-n crossed, no
  blocking reviewer finding, and (on the `ui` route) no blocking step 2
  finding. A `must`/`should` finding at confidence 3 or more, or a
  non-`pass` criterion, refuses the verdict and routes to a human.
- **reject** — any AC unproven, gate red, an NG-n crossed, or a blocking
  finding. The runner retries `factory-build` up to twice, then routes to
  a human automatically; just report `reject` honestly each time.
- **uncertain** — the verifier or reviewer could not reach a confident
  answer, or round limit hit. Route to a human, don't guess.

## 5. Write the outputs

Use `factory-comment`'s `verdict.md` template for
`.factory/runs/issue-<N>/verdict-comment.md`: per-AC pass/fail with the
evidence command and result, the test-that-bites (name, failing output on
the base branch, passing output here), reviewer findings verbatim, a summary of
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

Set `outcome` to `blocked` (with a `summary`) only if you could not review at
all. `result` is `pass`, `reject`, or `uncertain`; `findings` is the
reviewer's list verbatim plus any from step 2 (empty array if none) — the
retry and escalation rules are step 4's, not repeated here.
