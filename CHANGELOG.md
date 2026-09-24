# Changelog

## v2.6.0

One factory, any agent. Every preset except Claude ships `verified: false`; participants verify them with
`factory verify-agent` (see `docs/verify-an-agent.md`). Every fixture except Claude's is synthetic, written
from each CLI's docs.

- New presets: `gemini`, `opencode`, `cursor`, `pi`, `mastracode`. Each declares its pinned `version`,
  the API keys it may see (`envKeys`), its skills dir, its context file and how it holds read-only stages
  (`readOnlyBy`). A stage's env now drops every other known provider key, so a Codex stage never sees the
  Anthropic key. Agents with a custom `command` keep the old behaviour.
- Gemini and Mastra Code parse through a per-run parser (`newParser`), because their events arrive as deltas.
- `factory install --agents a,b,c` links `.claude/skills` into each agent's skills dir and writes an
  `AGENTS.md` (or `GEMINI.md`) pointer only when absent. Ported from skills `internal/agents/agents.go`.
- The install always links `.agents/skills` too (the shared dir), and the Dockerfile now installs four CLIs by
  default (`claude codex gemini opencode`); pass `--build-arg AGENTS=claude` for the old image.
- `factory doctor` warns when an agent binary's version differs from its pin.
- The Dockerfile takes `--build-arg AGENTS="gemini pi"` and pins every agent's version; a build with two
  agents was run. Cursor is host-only (`docker: false`): it has no pinnable download.
- `docs/agents.md`: a matrix generated from the registry (a test fails if they drift), a safety table and an
  aider walkthrough. One registry test walks every preset for its fixture, pins, install target and docs.
- Agents page and `GET /api/agents`. New `factory-operator` skill (ported from machinist's skill).
  `tests/docs-links.test.ts` checks every `*.md` for unbalanced fences and dead local links (blueprint).
- `FixtureRecorder` replaces a synthetic fixture instead of appending to it.

Not in v2.6:
- Live runs of any agent except Claude. OpenCode and Cursor event shapes are from memory, not from a
  capture. Mastra `--mode plan` as read-only, Pi print mode reading stdin and OpenCode reading stdin are
  unconfirmed until a participant runs them.
- omp and Amp are cut; either still runs as a custom `command`. Mistral Vibe is config-only.
- `prompt.ts` keeps reading the canonical `.claude/skills`, because `install` always writes it and links the
  other agents' dirs to it. There is no `renderPolicy` hook; each preset's `command` applies `stagePolicy`.
- The Agents page shows configuration and pins, not the installed version or doctor rows.

## v2.5.2

Makes v2.5 work on a real run. Every fix has a test that fails when the fix is reverted.

Correction to v2.5.1: its note "the provenance test now checks one ported test per row" was wrong. The test
checks each ported file's header and notice, not the rows of `research/upstream.lock`, and that lock file
sits outside this repo, so no test here can read it. `THIRD_PARTY_NOTICES.md` plus the provenance test are
the in-repo record; the lock's `shipped:` line was corrected by hand.

- Verify no longer runs on a red gate: a failing fresh gate goes back to build, or to failed at the round cap.
- The gate tree now hashes the working tree, so uncommitted build edits no longer look like "same tree".
- Read-only stages may run `git rev-parse`; a test checks every command a skill tells an agent to run
  against its stage allow-list.
- Step artifacts are validated for required fields and enums from `src/schemas.ts`. `outcome: blocked`
  without a verdict routes to needs-human. Review rounds live in the runner, not the artifact.
- Rehydrate writes the build object shape. The per-run event budget is evicted when the run ends.
- `factory doctor` warns when installed skills differ from this runner, and when a preset is not verified.
- The dashboard cookie gets `Secure` over https. Durations under a minute show whole seconds (`42s`).
  Board titles and stage rows pass through `plain()`, with a test that walks every read route.
- Finding re-check (P40): after verify, Claude re-checks each must/should finding against the diff in a
  tool-free call and drops the unsupported ones. Fails open. Runs only when Claude is the verifier.
- Ported assembler runtime cases: literal prompt args, stdin/stderr/exit preserved, hung-process timeout.
- `bin/factory` is now type-checked (it has no `.ts` extension, so `tsc` skipped it). That found an
  out-of-scope `config` in `buildWatchDeps` and a type error in `park`.
- Participant verification path: presets carry `verified`; `factory verify-agent <name>` runs one issue on
  that agent, records a scrubbed fixture and prints pass/fail, cost and tokens; `make agent-matrix` runs it
  for every installed agent; `docs/verify-an-agent.md` is the runbook. Only Claude is verified by us.

Live proof (Claude, splitbill issue #61, cent split): triage, plan, build, verify and pr all passed with
no manual step except approving the plan. 5 stages, about 4.5 minutes, $1.68. Verify passed 5 of 5
acceptance criteria and the PR changed only `src/money/cents.ts` and its test. `--json-schema` with no tools
returns `structured_output`, which the P40 re-check reads. Recorded fixtures: `tests/fixtures/agents/claude/`
(triage and plan) with a replay test; a preset can only say `verified: true` with a real fixture.

Not in this release:

- Claude fixtures for build, verify and pr: that run was not recorded. The next live Claude run adds them.
- The P40 re-check has not fired in a live run (verify raised no findings); only its call was probed live.
- R10: `cost_usd` stays `NOT NULL DEFAULT 0` in old databases. Incomplete usage is flagged by `usage_complete`.
- Assembler `readCommandDecision` and `runSDK` (dead code for a CLI runner) and `test/delivery.test.ts`
  (task-to-pr workflow, v2.8).
- Machinist `runs-view.test.js` (needs React, jsdom and vite; our dashboard has no build step),
  `artifacts_test.go` and the control-plane auth tests (a leased SQLite store and CSRF-protected HTTP
  artifacts; we keep artifacts as files under `.factory/runs/`). Nothing to port to.
- Live runs of any agent except Claude; participants verify those.

## v2.5.1

Finishes v2.5: the pieces it promised and did not ship.

- Cost meter: `src/pricing.ts` holds a dated per-model price table. An unknown model is "not reported",
  never $0. `stage_runs` gains `tokens_cached` and `usage_complete` (guarded, idempotent `ALTER`), and the
  dashboard shows "Not reported" for incomplete usage.
- Stage policy: triage, plan and verify run Codex with `-s read-only` and return their artifact as the final
  message; the runner validates it (`src/agents/reply.ts`) and writes the file. Build and pr keep
  `workspace-write`. Opt in to `--output-schema` with `outputSchema: true` on an agent.
- Stage artifacts get a JSON Schema built from the validators (`src/schemas.ts`), included in the artifact
  contract. Every step artifact accepts `outcome: complete|blocked|failed` and rejects unknown fields;
  `blocked` goes to needs-human with the reason.
- Event log has a 32 MiB byte budget per run, with a `process.output_truncated` marker.
- A `command` agent that is really `codex exec` or `claude -p`, even behind `env`, `mise` or `direnv`, gets
  its JSON flag and preset parser.
- Verify refuses stale evidence: if `gate.json` names a different tree than HEAD, the gates re-run first.
  Triage refuses an issue another open PR already closes, before any tokens are spent.
- Skills: `outcome` is taught, verdict comments render `pass|fail|unverified` per criterion, AC ids are never
  renumbered, build stops after 3 failed gate runs.
- Dashboard: the session cookie is a random id, not the token. Thread, run titles, artifact previews and CLI
  errors pass through `plain()`. `InboxChannel` interface, inbox argument parsing and every ChatOps
  command are tested.
- Provenance: the test now checks one ported test per row and Markdown ports.

Not in this release:

- No live Codex run (#18). Claude gets no `--json-schema`; `outputSchema` is opt-in.
- `gpt-5.6-terra` is unpriced, so its cost is not reported. Incomplete usage stores `cost_usd = 0` with
  `usage_complete = 0`, not NULL.
- A read-only reply's artifact is capped at 16 KiB.
- The tool-free finding re-check call (P40) was still prompt text only here; v2.5.2 made it a second tool-free call.
- Sub-minute durations keep the upstream `42.5s` format.
- Upstream `runs-view.test.js`, `artifacts_test.go` and the auth tests are not ported.
- Real Claude fixtures per stage are not recorded; they spend tokens.

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
- After a timeout the runner stops waiting on pipes held by a descendant that left the process group.
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
