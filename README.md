# Software Factory

A GitHub-native SDLC loop for coding agents: triage, plan, build, verify, PR, monitor. You watch
it happen in issues, comments, and a dashboard, instead of an agent's private terminal.

Point it at any repo, label an issue `factory:ready`, and it runs the loop end to end: a draft PR
lands with a test that proves it, or a human gets asked exactly what's missing.

## The loop

A human labels an issue `factory:ready`. The runner claims it, then drives six stages, each a
Claude Code skill working in its own git worktree:

1. **triage** classifies risk and posts a triage comment.
2. **plan** researches the code (via `factory-explorer`) and posts a plan comment with acceptance
   criteria and a risk verdict. Low risk with the auto-approve toggle on continues automatically;
   everything else waits on `/factory approve`.
3. **build** makes the smallest test-first change, running the repo's own `gates.sh`, and posts
   progress to one status comment it edits in place.
4. **verify** dispatches `factory-verifier` (proves the change actually causes the tests to fail
   if reverted) and `factory-reviewer` (correctness, security, scope). Reject sends it back to
   build, twice, then parks the issue on a human.
5. **pr** fills the repo's PR template and hands the body back.
6. The runner opens the PR as a draft and labels the issue `factory:in-review`.

At every stop the loop can ask a question (`factory:needs-info`) or refuse outright
(`factory:needs-human`). Only replies from the repo's own owner/member/collaborators count as
answers, so a stranger's comment on the issue can't steer the agent. `/factory
approve|revise <text>|retry|cancel` also works from any trusted account.

The GitHub issue and its comments are the record of truth. The dashboard is a window onto that
state, not a second copy of it.

## Safety contract

This runs against a real repo unattended, so the boundaries are enforced in more than one place:

| Boundary | Enforced by |
|---|---|
| A stage never merges a PR or force-pushes | `guard-paths.sh` (PreToolUse hook) blocks `git merge`, `gh pr merge`, `git push --force`; `.claude/settings.json` denies `gh *`, `git push*`, `git merge *` outright |
| A stage never edits a protected path | `guard-paths.sh` checks every `Edit`/`Write` against `protectedPaths` in the target's `.factory/config.json`; a plan that needs one is refused at triage, never built |
| Only the runner talks to GitHub | stages write to `.factory/runs/issue-<N>/*` (`src/artifacts.ts`); `src/watch.ts` is the only caller of `gh` |
| Two runs can't both claim an issue | claiming pushes an empty commit to `factory/issue-N` without `--force` — a non-fast-forward push means another run already owns it (`src/git.ts`) |
| A stage can't run away on cost | `maxBudgetUsd` per stage, passed to `claude -p` as `--max-budget-usd` |
| Too many open PRs pauses new work | `maxOpenFactoryPrs` triggers a `STOP_IF` pause on intake, visible on the dashboard |
| The writer doesn't grade its own work | `factory-verifier` runs in a fresh subagent context and reverts the non-test hunk to confirm the new test actually fails before restoring it |

## Six layers, six files

| Layer | Lives in |
|---|---|
| State machine | `factory:*` labels (`src/labels.ts`) |
| Orchestration | `src/watch.ts` (the only thing that calls `gh`) |
| Stage work | `template/.claude/skills/factory-{triage,plan,build,verify,pr}` |
| Research/checks | `template/.claude/agents/factory-{explorer,verifier,reviewer}.md` |
| Guardrails | `template/.claude/hooks/guard-paths.sh` + `template/.claude/settings.json` |
| Observability | `dashboard/` (`Bun.serve` on :4100, JSON + SSE from `src/state.ts`) |

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- [`gh`](https://cli.github.com), authenticated (`gh auth status`) with write access to the target repo
- [`claude`](https://claude.com/claude-code) on `PATH`, logged in — each stage runs as `claude -p`
- [`uv`](https://docs.astral.sh/uv/) (for `uvx`, used to validate skills against the
  [agentskills.io](https://agentskills.io) spec)

## Quickstart

```bash
git clone git@github.com:learnwithparam/software-factory.git
cd software-factory
make install                    # bun install
make check                      # typecheck + test + skills validation
```

Install the template into a target repo (never overwrites files that already exist there):

```bash
./bin/factory install ../your-repo --dry-run   # preview
./bin/factory install ../your-repo             # write .claude/{agents,hooks,skills,settings.json}
```

Add the one file the template doesn't provide — `.factory/config.json` in the target repo:

```json
{
  "repo": "your-org/your-repo",
  "base": "main",
  "baselineTag": "baseline",
  "protectedPaths": ["src/auth/**", ".factory/**", ".claude/**"],
  "riskPolicy": { "autoApproveLowRisk": true },
  "maxOpenFactoryPrs": 3,
  "concurrency": 3,
  "pollIntervalSeconds": 15,
  "maxBudgetUsd": { "triage": 1, "plan": 2, "build": 5, "verify": 3, "pr": 1 }
}
```

and a `.factory/gates.sh` that runs your checks and prints one line the runner parses:
`FACTORY_GATES: status=GREEN|RED|MISCONFIGURED passed=N failed=N skipped=N failed_gates=a,b`.
Missing fields fall back to the defaults in `src/config.ts`.

Then bring the target repo up to speed and start the loop:

```bash
./bin/factory doctor --repo-dir ../your-repo --fix   # gh auth, config, gates.sh, baseline tag, labels
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
dependency bump) — clone it to see the loop run against something real before wiring up your own.

## Commands

| Command | Does |
|---|---|
| `factory install <target-dir> [--dry-run]` | copy the template into a repo |
| `factory doctor --repo-dir <path> [--fix]` | check `gh`/`claude` on PATH, config, gates.sh, baseline tag, labels |
| `factory watch --repo-dir <path> [--once]` | poll and drive the loop |
| `factory dashboard` | serve the board on :4100 |
| `factory scan --repo-dir <path>` | file issues from `bun audit` / `bun outdated` findings |
| `factory reset --repo-dir <path> [--dry-run]` | put the target back to baseline |

## Reset any time

`factory reset` (or `--dry-run` first) closes factory PRs, deletes `factory/*` branches, forces
`main` back to the baseline tag, closes open issues, recreates the seeded ones from
`.factory/issues/*.md`, and wipes worktrees and local state. Idempotent — run it before every
workshop or demo run.

## Checks

`make check` runs typecheck, `bun test`, and `skills-ref validate` against every skill in
`template/.claude/skills`. It fails loudly if `uvx` isn't installed rather than skipping the
skills check — an unwired or silently-skipped check didn't ship.
