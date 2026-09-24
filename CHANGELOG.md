# Changelog

## v2.5.0

Any coding agent: the factory no longer knows Claude by name. An agent is config.

- `src/agents/`: one `CommandExecutor` (spawn, prompt on stdin or in the command, timeout, process-group
  kill, stderr tail, bounded event log, tool-call cap) and presets for `claude` and `codex`. Claude's
  command is unchanged from v2.4.0 (a test pins it), plus `--model` when `agent.model` is set.
- `.factory/config.json` gains `agents` (a `preset`, or your own `command` with `{{prompt}}`,
  `{{promptFile}}`, `{{model}}`) and `stages` (`default` plus per-stage overrides, so one agent can build and
  another verify). Config is validated at boot, including an unknown preset or stage.
- Any agent that can write files works with no adapter: it gets the stage skill plus an artifact contract, and
  `FACTORY_ARTIFACT_DIR`, `FACTORY_ISSUE`, `FACTORY_STAGE`, `FACTORY_SCRATCH_DIR`. Runner credentials and repo
  `GIT_*` variables are stripped from its environment. Without a preset, tokens show as not reported.
- Token totals follow machinist: the last terminal event wins, malformed usage is "not reported", never zero.
  `stage_runs` records which agent and model ran each stage.
- Verify: findings are structured (`must|should|could`, confidence 0-5, what/why/where/fix) and per-criterion
  `pass|fail|unverified`. The runner sends a self-contradicting `pass` to a human. A step result must be one
  JSON object under 16 KiB. The runner writes `gate.json` (gate line and git tree hash) so a read-only
  verifier trusts current evidence instead of re-running the gates.
- `factory doctor` checks the binary of each agent a stage uses and warns about one with no preset.

Not in this release: Gemini, OpenCode, Pi, omp, Mastra Code and Amp presets (v2.6.0). The Codex preset is
covered by recorded-shape tests only; a live run is pending.

## v2.4.0

The cockpit: a redesigned dashboard and one place for everything that waits on a human.

- `src/inbox.ts` and `factory inbox [<N> <action> [--text <words>]] [--json]`: what is waiting (plan to
  approve, question, PR in review, parked, failed) derived from labels and the thread. Acting posts the same
  `/factory` comment a human would type, so GitHub stays the only state.
- Dashboard redesign, no build step: machinist design tokens (light, dark, system), self-hosted Manrope
  (OFL), a sidebar that becomes a bottom nav under 768px. Views: Inbox (conversation and composer), Line
  (one row per issue, stations sized by duration), Runs, Analytics, and a run side sheet with stages,
  artifact preview and log.
- New routes: `/api/inbox`, `/api/inbox/:n/act`, `/api/analytics`, `/api/runs/:id/stages`,
  `/api/issues/:n/artifacts`, `/api/line`. Artifacts are text only, capped at 1 MiB, sandboxed headers.
- Dashboard auth: constant-time token compare, header or HttpOnly session cookie (`POST /api/session`),
  no `?token=`, and a default-deny route allow-list proven by a test that walks every route.
- `factory logs N [--follow] [--json]`; terminal control sequences stripped from displayed text; revision
  history keeps every earlier `/factory revise`.
- Ports from owainlewis/machinist and assembler, with their tests, recorded in `THIRD_PARTY_NOTICES.md`
  and enforced by `tests/provenance.test.ts`.

Not in this release: the merge dry-run inbox item (v2.9), the Agents page (v2.6).

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
