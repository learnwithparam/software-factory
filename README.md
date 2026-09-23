# Software Factory

An SDLC loop that runs on a GitHub repo. You watch it in issues, comments,
and a dashboard, instead of an agent's private terminal.

## The loop

A human labels an issue `factory:ready`. The runner claims it, then drives
six stages, each a Claude Code skill working in its own git worktree:

1. **triage** classifies risk and posts a triage comment.
2. **plan** researches the code (via factory-explorer) and posts a plan
   comment with acceptance criteria and a risk verdict. Low risk with the
   auto-approve toggle on continues automatically; everything else waits on
   `/factory approve`.
3. **build** makes the smallest test-first change, running the repo's own
   `gates.sh`, and posts progress to one status comment it edits in place.
4. **verify** dispatches factory-verifier (proves the change actually
   causes the tests to fail if reverted) and factory-reviewer (correctness,
   security, scope). Reject sends it back to build, twice, then parks the
   issue on a human.
5. **pr** fills the repo's PR template and hands the body back.
6. The runner opens the PR as a draft and labels the issue
   `factory:in-review`.

At every stop the loop can ask a question (`factory:needs-info`) or refuse
outright (`factory:needs-human`). Only replies from the repo's own
owner/member/collaborators count as answers, so a stranger's comment on the
issue can't steer the agent. `/factory approve|revise <text>|retry|cancel`
also works from any trusted account.

The GitHub issue and its comments are the record of truth. The dashboard is
a window onto that state, not a second copy of it.

## Six layers, six files

| Layer | Lives in |
|---|---|
| State machine | `factory:*` labels (`src/labels.ts`) |
| Orchestration | `src/watch.ts` (the only thing that calls `gh`) |
| Stage work | `template/.claude/skills/factory-{triage,plan,build,verify,pr}` |
| Research/checks | `template/.claude/agents/factory-{explorer,verifier,reviewer}.md` |
| Guardrails | `template/.claude/hooks/guard-paths.sh` + `template/.claude/settings.json` |
| Observability | `dashboard/` (Bun.serve on :4100, JSON + SSE from `src/state.ts`) |

A stage skill never touches `gh` or `git push`. It writes its comment body
and verdict to `.factory/runs/issue-<N>/*.md` / `*.json`
(`src/artifacts.ts`), and the runner is the sole caller of GitHub.

## Quickstart

```bash
make install                          # bun install
./install.sh ../your-repo             # copy the template in, never overwrites
cd ../your-repo
# add .factory/config.json (see src/config.ts's FactoryConfig) and
# .factory/issues/*.md seeds (those are repo-specific, not part of this template)
factory doctor --repo-dir .           # confirm gh auth, labels, config
factory watch --repo-dir .            # start the loop
factory dashboard                     # board on http://localhost:4100
```

Or from this repo: `make doctor REPO_DIR=../your-repo`, `make up
REPO_DIR=../your-repo`.

## Reset any time

`make reset` (or `factory reset --repo-dir <path> --dry-run` first) closes
factory PRs, deletes `factory/*` branches, forces `main` back to the
baseline tag, closes open issues, recreates the seeded ones, and wipes
worktrees and local state. Idempotent: run it before every workshop run.

## Checks

`make check` runs typecheck, `bun test`, and `skills-ref validate` against
every skill in `template/.claude/skills`. It fails loudly if `uvx` isn't
installed rather than skipping the skills check.
