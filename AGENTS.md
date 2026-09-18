# Software Factory

Lab for the learnwithparam Software Factory sessions. It runs live in front of a room, so every change is
proven by running it.

`make install` · `make check` (prose, types, unit, structural; no model, no network) · `make prove` (break
each scored gate, confirm it fails) · `make e2e` (real model, repo, PRs) · `make book` · `make score`
(below 100 exits 1) · `make demo STEP=02`. Every target takes `REPO=<path>`.

## The factory knows no codebase

Repository knowledge lives in that repository's `.factory/`. Nothing under `steps/` names a service,
language or directory of a real project; tests use `tests/fixtures/sample`.

## Rules

- The e2e stamp covers what a run loads: `scripts/tree-hash.ts` lists stamped and unstamped paths with a
  reason each, and `tests/gate.test.ts` fails on a path in neither.
- The score is done: each point in `scripts/rubric.ts` binds one test. Add test and rubric line together.
- Break every new check once on purpose and watch the score drop. A mutation that makes its own assertion
  trivially true is a broken mutation.
- The writer never grades: a verifier reads the diff cold and reverts the fix to see red.
- Deterministic code downgrades a verdict whose evidence is missing. Merge is never automated.
- `teach.html` holds each idea once; run sheets in `teach/` cite concepts by id.
- `make book` records source hashes; `make check` names a stale PDF. Never judge a PDF by eye: the text
  layer resets live in `teach/teach.css` (`tests/design.test.ts`) and `make book` reads back with `pdftotext`.
- Every external claim cites `sources.json` (`tests/sources.test.ts`); links are checked weekly, never in `make check`.
- No em dashes (`scripts/check-prose.ts`). Secrets never go on a command line.
- Test worktrees go to a temp dir (`tests/setup.ts`); session sandboxes live in `~/.cache/software-factory/sandboxes`.
