# Software Factory

A GitHub-native SDLC loop for coding agents: triage, plan, build, verify, PR. You watch
it happen in issues, comments, and a dashboard, instead of an agent's private terminal.

Point it at any repo, label an issue `factory:ready`, and it runs the loop end to end: a PR
lands with a test that proves it, or a human gets asked exactly what's missing.

## The loop

A human labels an issue `factory:ready`. The runner claims it, then drives five stages, each a
Claude Code skill working in its own git worktree, then the runner opens the PR:

1. **triage** classifies risk and posts a triage comment.
2. **plan** researches the code (via `factory-explorer`) and posts a plan comment with acceptance
   criteria and a risk verdict. Low risk with the auto-approve toggle on continues automatically;
   everything else waits on `/factory approve`.
3. **build** makes the smallest test-first change. The runner, not the agent, then runs the
   repo's own `gates.sh` and parses its `FACTORY_GATES:` line as the only source of green/red, and
   commits everything the stage touched (excluding `.factory/runs`, the stage handoff itself).
4. **verify** dispatches `factory-verifier` (proves the change actually causes the tests to fail
   if reverted) and `factory-reviewer` (correctness, security, scope). Reject sends it back to
   build, twice, then parks the issue on a human.
5. **pr** fills the repo's PR template and hands the body back.
6. The runner pushes the branch and opens the PR as a draft while it works, then marks it ready for review and labels the issue `factory:in-review`. A `/factory revise` puts it back to draft until the rebuild is done.

At every stop the loop can ask a question (`factory:needs-info`, capped at two rounds) or refuse
outright (`factory:needs-human`). Only replies from the repo's own owner/member/collaborators count
as answers, so a stranger's comment on the issue can't steer the agent. `/factory
approve|revise <text>|retry|cancel` also works from any trusted account, `retry` re-drives a
parked issue from its last completed stage, `revise` reopens an in-review PR for another build
round.

**The GitHub issue and its comment thread are the only record of truth**, not a database. Every
comment the runner posts carries a hidden `<!-- factory:data {...} -->` marker holding that
stage's structured output; `src/derive.ts` reconstructs stage, round counts, and the runner's own
status-comment id from nothing but the thread, and `src/rehydrate.ts` rebuilds a stage's working
files from it before every run. That is what makes an issue resumable from a machine that has
never seen it before, a fresh clone, a fresh CI job, `factory retry` after the workspace was
wiped, a watcher restarting after a crash. A local SQLite file (`src/state.ts`) still exists, but
only as a live telemetry cache (tool-call counts, cost, an event feed for the dashboard), deleting
it loses history, never state.

## Run anywhere

The loop is the same state machine regardless of where it runs; only how you start it
and where its clone lives changes. Claude Code is the only agent wired up today, `src/executor.ts`
defines the `Executor` interface as the seam for adding another one later, but there's no config
key for choosing between agents until a second implementation exists.

| Mode | Start | Auth | State lives in | Cockpit |
|---|---|---|---|---|
| **Local** | `make up REPO_DIR=../repo` (or `factory up --repo-dir ../repo`) | `gh auth login`, `claude` login (interactive) | `~/.factory` (`FACTORY_HOME`) | `http://localhost:4100` |
| **VM (Docker)** | `docker build -t software-factory .`, then `docker run -d --env-file factory.env -v factory-data:/data -p 127.0.0.1:4100:4100 software-factory up --repo owner/name` | `GH_TOKEN` + `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`) in an env file, mode `600`, never on a command line | the `/data` named volume (clone, worktrees, the SQLite cache) | `ssh -L 4100:localhost:4100 vm`, then open `localhost:4100` |
| **CI (GitHub Actions)** | `factory install <target-dir> --ci`, rename the written `factory.yml.example` to `factory.yml`, set repo variable `FACTORY_MODE=actions` | repo secrets `FACTORY_GH_TOKEN` (fine-grained PAT or GitHub App token, a plain `GITHUB_TOKEN`-authored PR never re-triggers this repo's own CI) and `ANTHROPIC_API_KEY` | none, every run starts from nothing and rebuilds from the issue thread | the issue thread itself, or point a local `factory dashboard --repo owner/name` at it as a cockpit |

Every mode drives `advanceIssue()` (`src/watch.ts`) through the same three entry points:
`watch`/`up` poll it in a loop, `factory run --issue N` advances one issue once (what a CI step
calls), and `factory tick` makes a single pass across every open issue (what a cron trigger calls
instead of holding a process open). `factory park --issue N --reason <text>` parks an issue as
`needs-human` from outside the loop, a CI failure step calls this when a timeout or runner crash
happened in a way nothing inside the loop caught.

**Only one mode should drive a given repo at a time.** Two drivers (Actions and your laptop) both
react to the same labels; the claim CAS stops a double build but not the noise. With
`FACTORY_MODE=actions` set locally, `factory doctor` checks that the workflow file exists.

`--repo-dir <path>` (local: the clone already exists) and `--repo <owner/name>` (VM/CI: nothing is
on disk yet) both work on `up`/`watch`/`run`/`tick`, the second clones under
`FACTORY_HOME/repos/<owner>__<name>` on first use and fetches + fast-forwards to origin's default
branch on every call after (`src/repo.ts`), so a container can start with an empty volume.

## State and labels

The issue's label is the state. Everything else is derived from the thread.

| Label | Meaning | Moves on when |
|---|---|---|
| `factory:ready` | a human queued it | the runner claims it |
| `factory:triaging` / `factory:planning` | the agent is working | the stage finishes |
| `factory:needs-info` | the agent asked a question (max two rounds, then `needs-human`) | a trusted comment answers it |
| `factory:awaiting-approval` | plan posted, waiting | `/factory approve`, or auto for low risk |
| `factory:building` / `factory:verifying` | building, or proving the build | gates and verifier finish; a reject goes back to build twice, then `needs-human` |
| `factory:in-review` | PR ready for review | a human merges, or asks `/factory revise` |
| `factory:failed` | a stage broke (timeout, red gates, boundary, denied tool) | `/factory retry` |
| `factory:needs-human` | refused or out of rounds | `/factory retry` |
| `factory:monitor` | filed by `factory scan` from a production signal; a provenance label, not a stage | nothing, it stays on the issue |

## Where a human acts

Always through GitHub state, which the runner polls every `pollIntervalSeconds`. Only `OWNER`,
`MEMBER` and `COLLABORATOR` count.

| Channel | How |
|---|---|
| Start a run | label the issue `factory:ready` |
| Issue comment | `/factory approve`, `/factory revise <text>`, `/factory retry`, `/factory cancel`; any other trusted comment answers a question |
| PR comment or review | `/factory revise <text>` rebuilds on the same PR |
| Dashboard | the buttons post those same comments |
| CLI | `run`, `tick`, `park` drive the same code from CI |

| State | `approve` | `revise <text>` | `retry` | `cancel` | free text |
|---|---|---|---|---|---|
| needs-info | | | | close | the answer |
| awaiting-approval | build | re-plan with the text | re-plan | close | ignored |
| failed / needs-human | | | resume at the last stage | close | ignored |
| in-review | | rebuild the PR | | close | ignored |

Every runner comment carries a hidden `<!-- factory:` marker, so the runner never mistakes its own
comments for an answer.

## Scripting the CLI

`run`, `tick`, `watch --once` and `doctor` take `--json`: success is `{"ok":true,"data":...}` on
stdout, failure is `{"ok":false,"error":{"kind":"config|usage|error","message":...}}` on stderr.
Progress lines go to stderr, so stdout stays parseable.

| Exit | Meaning |
|---:|---|
| 0 | success |
| 1 | usage, invalid config, `gh` or `git` failure, or anything unexpected |
| 2 | `run`: the issue ended in `factory:failed` |
| 3 | `tick` or `watch --once`: paused by `maxOpenFactoryPrs`, no new pickups |
| 4 | `doctor`: at least one check failed |

## Proving every scenario

You do not run every path live. `tests/scenarios.test.ts` replays each branch of the state machine
against fakes for GitHub, git, gates and the agent (approve, revise, cancel, needs-info at each
stage, refusal, red gates, verify rejects, boundary hits, timeouts, denied tools, lost claim,
untrusted commenter, crash recovery) and a structural test fails if any label has no scenario.
`make check` runs it on every change. A live run then shows each kind of human decision once.

## Safety contract

This runs against a real repo unattended, so the boundaries are enforced in more than one place,
not just at the tool-call layer a hook can see:

| Boundary | Enforced by |
|---|---|
| A stage never merges a PR or force-pushes | `guard-paths.sh` (PreToolUse hook, **fails closed**, a missing `python3` blocks rather than lets the call through) blocks `git merge`, `gh pr merge`, `git push --force`; `.claude/settings.json` denies `gh *`, `git push*`, `git merge *` outright |
| A stage never edits a protected path, even via `Bash` | `guard-paths.sh` checks every `Edit`/`Write`; independently, before any push, the runner diffs the branch against its base (`git diff --name-only origin/<base>...HEAD`) against `protectedPaths`, this is the one that catches `sed -i`/`cat >`/`bun -e`, which no hook ever sees |
| The agent can't read the runner's own credentials | the executor spawns `claude` with a scrubbed env (`GH_TOKEN`, `GITHUB_TOKEN`, `FACTORY_*` stripped); `.claude/settings.json` denies `Read` of `~/.config/gh/**` and `~/.ssh/**`. **Residual risk:** the model API key itself is visible to the agent process, use a spend-capped key, not your primary one |
| Only the runner talks to GitHub | stages write to `.factory/runs/issue-<N>/*` (`src/artifacts.ts`); `src/watch.ts` is the only caller of `gh` |
| Two runs can't both claim an issue | claiming builds a unique commit on top of `origin/<base>` (`commit-tree`) and pushes it without `--force`, a non-fast-forward rejection means another run already owns it (`src/git.ts`); pushing the *same* base SHA twice, the old bug, is a fast-forward no-op that lets both callers "win" |
| A stage can't run away on cost or time | `maxBudgetUsd` per stage passed to `claude -p --max-budget-usd`; `stageTimeoutMinutes` and `maxToolCalls` kill a stuck or runaway process and park the run as `failed` |
| Too many open PRs pauses new work | `maxOpenFactoryPrs` triggers a `STOP_IF` pause on intake, visible on the dashboard |
| The writer doesn't grade its own work | the runner runs `.factory/gates.sh` itself and trusts only its `FACTORY_GATES:` line, never the agent's own `build.json: green` claim; `factory-verifier` also runs in a fresh subagent context and reverts the non-test hunk to confirm the new test actually fails before restoring it |
| The dashboard isn't a public backdoor | binds `127.0.0.1` by default; a non-loopback `FACTORY_DASHBOARD_HOST` refuses to serve without `FACTORY_DASHBOARD_TOKEN` set; mutating routes require same-origin JSON, rejecting the `text/plain` a cross-site form can send without a CORS preflight |
| An untrusted comment can't steer the agent | `src/chatops.ts#isTrusted` only accepts `OWNER`/`MEMBER`/`COLLABORATOR`; the CI workflow's own `if:` re-checks the same association before spending a runner-minute, and the runner re-derives trust from the thread regardless of what the workflow-level check already filtered |

## Six layers

The course's taxonomy for "what makes unattended agent work safe to leave running," and where each
layer actually lives in this repo:

| Layer | Question | Lives in |
|---|---|---|
| **Boundary** | What may it touch unattended? | `.factory/config.json`'s `protectedPaths`, `guard-paths.sh` (fails closed), `.claude/settings.json` deny rules, env scrub in `src/executor.ts`, the runner's own diff check (`src/boundary.ts`), CODEOWNERS, the trust rule, per-stage budgets and timeouts |
| **Execution** | Where does it run, and what can it reach? | One git worktree per issue (`src/git.ts`), the `Executor` interface, claim-by-CAS, the worker pool (`src/pool.ts`), local/Docker/Actions run modes |
| **Context** | What does the task need to know? | `issue.json` plus the rehydrated stage handoff (`src/rehydrate.ts`), the repo's `AGENTS.md`/charter, the `factory-explorer` subagent |
| **Skills** | What know-how is reusable? | `template/.claude/skills/factory-{triage,plan,build,verify,pr}`, three repo-specific skills a target repo adds itself |
| **Verification** | What proof exists before a human looks? | runner-run `gates.sh` (`src/gates.ts`), `factory-verifier` (reverts the fix, proves the new test actually catches it), `factory-reviewer`, the CI required check |
| **Delivery** | How does work reach a person, and who ships it? | a PR from the target repo's own PR template, a human merges it, branch protection, `factory scan` feeding new issues into intake |

Checkpoint branches in the example target repo (`learnwithparam/splitbill`) use these same names:
`01-boundary`, `02-execution`, `03-context`, `04-skills`, `05-verification`, `06-delivery`.

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- [`gh`](https://cli.github.com), authenticated (`gh auth status`) with write access to the target repo
- [`claude`](https://claude.com/claude-code) on `PATH`, logged in, each stage runs as `claude -p`
- [`uv`](https://docs.astral.sh/uv/) (for `uvx`, used to validate skills against the
  [agentskills.io](https://agentskills.io) spec)
- [Docker](https://www.docker.com) only if you're using VM mode

## Quickstart

```bash
git clone git@github.com:learnwithparam/software-factory.git
cd software-factory
make install                    # bun install
make check                      # typecheck + test + skills validation
```

## Bring your own repo

Install the template into the target repo (never overwrites a file that's already there):

```bash
./bin/factory install ../your-repo --dry-run   # preview
./bin/factory install ../your-repo             # .claude/{agents,hooks,skills,settings.json} + .factory/{gates.sh,config.example.json,charter.md}
```

`--update` overwrites every factory-owned file except `.claude/settings.json`, which it diffs
instead (writing `.settings.json.factory-new` for you to reconcile), and skips the repo-owned
`.factory/` files. `--ci` also writes the inert `.github/workflows/factory.yml.example`.

Then make three repo-owned files yours:

1. `.factory/config.json` (copy `config.example.json`). The runner refuses to start without it.
2. `.factory/charter.md`: what the agent may and may not do here. Replace every `TODO`.
3. `.factory/gates.sh`: runs your checks from `config.gates` and prints one line the runner parses.

Config example:

```json
{
  "repo": "your-org/your-repo",
  "agentCommands": { "read": [], "build": ["make *"], "verify": ["make *"] },
  "gates": [{ "name": "check", "cmd": "make check" }],
  "base": "main",
  "baselineTag": "baseline",
  "protectedPaths": ["src/auth/**", ".factory/**", ".claude/**"],
  "riskPolicy": { "autoApproveLowRisk": true },
  "maxOpenFactoryPrs": 3,
  "concurrency": 3,
  "pollIntervalSeconds": 15,
  "maxBudgetUsd": { "triage": 1, "plan": 2, "build": 5, "verify": 3, "pr": 1 },
  "stageTimeoutMinutes": 15,
  "maxToolCalls": 60
}
```

Add `gates` (the commands `gates.sh` runs, each `{ "name": ..., "cmd": ... }`) and `agentCommands`
(`read`, `build`, `verify`: Bash patterns each stage may run, for example `["bun *", "make *"]` for
build). Stages get only what the config grants, through `--settings` on `claude -p`; a project
`permissions.allow` block is ignored in headless mode. `gates.sh` prints
`FACTORY_GATES: status=GREEN|RED|MISCONFIGURED passed=N failed=N skipped=N failed_gates=a,b`.
Unknown keys and a missing `repo` are errors, other missing fields take the defaults in
`src/config.ts`.

Then bring the target repo up to speed and start the loop:

```bash
./bin/factory doctor --repo-dir ../your-repo --fix   # gh auth, config, charter, gates.sh, baseline tag, labels
git -C ../your-repo tag baseline main && git -C ../your-repo push origin baseline

make watch REPO_DIR=../your-repo       # poll and drive the loop
make dashboard                         # board on http://localhost:4100
# or both together:
make up REPO_DIR=../your-repo
```

Want a global `factory` command instead of `./bin/factory` / `make ... REPO_DIR=`? `bun link`
after `make install` puts it on `PATH`.

**Full working example:** [`learnwithparam/splitbill`](https://github.com/learnwithparam/splitbill)
is a real target repo with `.factory/config.json`, `gates.sh`, repo-specific skills, GitHub issue
and PR templates, branch protection, and seeded issues (bugs, a SQL injection, an IDOR, a
dependency bump), clone it to see the loop run against something real before wiring up your own.

## Commands

| Command | Does |
|---|---|
| `factory install <target-dir> [--dry-run] [--update] [--ci]` | install or update the template in a repo |
| `factory doctor --repo-dir <path> [--fix]` | check `gh`/`claude`/`python3`/`jq` on PATH, `gh auth status`, config, charter, gates.sh, baseline tag, labels |
| `factory up [--repo-dir <path> \| --repo <owner/name>]` | watch + dashboard in one process, the Docker/VM entrypoint |
| `factory watch [--repo-dir <path> \| --repo <owner/name>] [--once]` | poll and drive the loop (local mode) |
| `factory run [--repo-dir <path> \| --repo <owner/name>] --issue <N>` | advance one issue once, then exit (CI mode) |
| `factory tick [--repo-dir <path> \| --repo <owner/name>]` | one poll pass across every open issue, then exit (cron) |
| `factory park --repo-dir <path> --issue <N> --reason <text>` | park an issue as `needs-human` from outside the loop |
| `factory dashboard [--repo <owner/name>] [--port <n>]` | serve the board on :4100 |
| `factory scan --repo-dir <path>` | file issues from `bun audit` findings, one per package. Bun/npm projects only |
| `factory rebaseline --repo-dir <path> [--dry-run]` | move the baseline tag to the current base, keeping merged setup changes across reset |
| `factory reset --repo-dir <path> [--dry-run]` | **destructive**: force-pushes the base branch to the baseline tag |

Also `--db`, `--workspaces`, `--port` and the `FACTORY_*` env vars; `factory --help` lists them all.

## Reset any time

> **Danger.** `reset` force-pushes the base branch back to the baseline tag and closes every open
> issue and PR. Run `--dry-run` first, and never against a repo with real work on it.

`factory reset` (or `--dry-run` first) closes factory PRs, deletes `factory/*` branches, forces
the base branch (`config.base`) back to the baseline tag, closes open issues, recreates the seeded ones from
`.factory/issues/*.md`, and wipes worktrees and local state. Idempotent, run it before every
workshop or demo run. The dry-run lists each commit the force push would drop as `drop-commit`.

**Protected base branch.** Rewinding a base that has commits after the tag needs force pushes allowed
on it. Reset pushes the base first, so a refusal fails the reset with git's message before any PR,
branch or issue is touched. Allow force pushes for yourself (GitHub: Settings, Branches, the rule
for the base, "Allow force pushes" for everyone or for you), run the reset, then turn it off again.
The settings API can report force pushes as enabled while the push is still refused, so trust the
push, not the setting.

**Keeping a merge across reset.** Reset returns the base branch to the baseline tag, so anything
merged after the tag is lost. Merge setup changes (config, charter, skills, CI), then run
`factory rebaseline --repo-dir <path>` to move the tag to the new base and keep them. Merge demo
output (a factory PR) and leave the tag alone, and reset drops it.

## Checks

`make check` runs typecheck, `bun test`, and `skills-ref validate` against every skill in
`template/.claude/skills`. It fails loudly if `uvx` isn't installed rather than skipping the
skills check, an unwired or silently-skipped check didn't ship. CI additionally runs `docker
build` on every push so the VM image can't silently rot.
