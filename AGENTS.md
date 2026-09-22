# Software Factory

Lab for the learnwithparam Software Factory sessions. It runs live in front of a room, so every change is
proven by running it.

- `make install` installs. `make check` runs prose, types, unit and structural tests with no model and no network.
- `make prove` breaks each scored gate and confirms it fails.
- `make e2e` uses the real model, repo and PRs.
- `make book` prints both PDFs. `make score` exits 1 below 100. `make demo STEP=02` runs one step.
- Every target takes `REPO=<path>`.

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
- Two teaching documents, nothing else: `workbook.html` (attendees) and `guide.html` (facilitators, one part per session, each starts a fresh page). The workbook holds each idea once, drawn as a diagram; the guide cites concepts by id. `teach/` keeps only `sessions.json` and `manifest.json`.
- Diagrams are drawn by `scripts/diagram.mjs` from `design/diagrams/*.json` (`make diagrams`); a hand edit to a figure, a label under 7.5pt on paper, or a concept with no diagram and no reason in `design/diagrams/exempt.json` fails `make check`. Colours are tokens from `design/tokens.json`, explained in `design/BRAND.md`, never a hex.
- `make book` records source hashes; `make check` names a stale PDF. Never judge a PDF by eye: the text
  layer resets live in `design/book.css` (`tests/book.test.ts`) and `make book` reads back with `pdftotext`.
- Code blocks, tables and figures keep 5 mm before what follows: `make book` measures it and fails below.
- `.githooks/pre-commit` runs `make book` when a commit stages a PDF source, then stages the PDFs. Arm it once
  per clone: `git config core.hooksPath .githooks`.
- Titles are claims that name the subject, in sentence case; `python3 ~/.claude/skills/lwp-shared/scripts/house_rules.py --voice --terms` on `workbook.html` and `guide.html` must report 0.
- Every external claim cites `sources.json` (`tests/sources.test.ts`); links are checked weekly, never in `make check`.
- No em dashes (`scripts/check-prose.ts`). Secrets never go on a command line.
- Test worktrees go to a temp dir (`tests/setup.ts`); session sandboxes live in `~/.cache/software-factory/sandboxes`.
