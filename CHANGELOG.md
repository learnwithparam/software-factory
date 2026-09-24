# Changelog

## v2.3.0

Honest foundation: what the README and labels promise now matches what the code does.

- `/factory cancel` closes the issue and any PR, removes the labels and the worktree, from every waiting
  state (needs-info, awaiting-approval, needs-human, failed, in-review). Before, it only worked at plan
  approval and never closed the issue, and in needs-info it was recorded as the answer.
- `.factory/config.json` is validated at boot: unknown or mistyped keys and wrong types refuse to start,
  and every problem is listed at once. `riskCriteria` and `_comment` keys stay allowed.
- New `stage_runs` table: one row per stage attempt (duration, tokens, cost, exit, kill reason), so retries
  keep their history. Forward-only migration; existing databases are upgraded in place.
- `--json` on `run`, `tick`, `watch --once` and `doctor`, with a documented exit-code table (2 run failed,
  3 paused, 4 doctor failed). Pattern from jiractrl.
- The Claude Code pin moves from 2.0.5 to 2.1.281 (Dockerfile and CI template); every flag the executor passes
  is present in that version's `--help`. A test keeps the two pins equal.
- Docs: the `factory:failed` label text, the dashboard bind comment and the README no longer claim a
  `factory:monitor` stage (that label marks issues filed by `factory scan`).
- Fix: `claim` and the runner's commits failed on a host with no git identity (a fresh CI runner or
  container). The runner now supplies a fallback identity only when none is configured. `make test` runs
  with no identity so this cannot hide on a developer machine again.

Not in this release: a monitor stage (v2.8), any agent besides Claude (v2.5).
