---
name: factory-build
description: Implements an approved plan test-first, applies the named repo skills, and runs the repo's gate script, quoting the gate line verbatim in the status comment. Use as the build stage, after a plan has been approved (or was auto-approve-eligible).
---

# factory-build

Invoked as `/factory-build <N>`. No push, no `gh` access — the runner
commits and pushes what's in the worktree after you stop; you only edit
files inside this worktree and write the artifact files below.

## 1. Read the inputs

- `.factory/runs/issue-<N>/issue.json`, `triage.json`, `plan.json`,
  `plan-comment.md` — the approved plan: AC-n, NG-n, files, tests, repo
  skills to apply, gate level.
- `AGENTS.md`, `.factory/charter.md`.
- The repo skills named in the plan (`.claude/skills/<name>/SKILL.md`) —
  read and follow them; they encode repo-specific rules you don't know.

## 2. Build test-first, smallest change

For each AC, write its named test first, watch it fail for the right
reason, then write the smallest change that makes it pass. Do not touch a
file outside the plan's "files to touch" list without a real reason — if
you find you need to, that's a signal to stop and ask (step 4), not to
quietly expand scope. Never cross a non-goal (NG-n); those are binding.

Apply every repo skill named in the plan as you go, not as an afterthought.

## 3. Run the gate

Run `.factory/gates.sh` (or the narrower `gate_level` the plan named).
Quote the exact gate line — the command and its pass/fail output — verbatim
in the status comment. Do not paraphrase or summarize a failure as "some
tests failed"; show the line that failed.

If the gate fails and you can see why, fix it and re-run. Don't loop more
than a few times guessing; if you can't get it green, say so in the status
comment and stop — `factory-verify` will catch a red gate anyway, but a
build that knows it's broken shouldn't pretend otherwise.

## 4. Escape hatch: back to needs-info mid-build

If the plan turns out to rest on a wrong assumption, or you hit a decision
only a human can make, stop here rather than guessing:

- Write `.factory/runs/issue-<N>/question-comment.md` with the
  `factory-comment` skill's `question.md` template.
- Write `.factory/runs/issue-<N>/build.json` with `"status": "needs_info"`.
- Leave the worktree and any partial commits as they are — the runner
  preserves both the worktree and the current stage so build can resume
  from here once the question is answered, instead of starting over.

## 5. Write the outputs

Write `.factory/runs/issue-<N>/status-comment.md` using the
`factory-comment` skill's `status.md` template (stage `build`, progress
`3/5`, the gate line, one-line detail). Then write
`.factory/runs/issue-<N>/build.json`:

```json
{
  "status": "green",
  "gate_line": "make check: 42 pass, 0 fail",
  "rounds": 1
}
```

`status` is one of `green`, `red` (gate never went green after reasonable
effort), or `needs-info` (see step 4). `rounds` is this issue's build
attempt count so far, including any verify-reject that sent you back here
— read the previous `build.json` if present and increment it yourself; the
runner does not track this for you. Leave the worktree exactly as you want
it committed — the runner commits and pushes it verbatim.
