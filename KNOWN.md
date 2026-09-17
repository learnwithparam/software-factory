# What is proven, and what is not

Written down because the difference matters more than the totals, and because a
caveat that lives in somebody's memory is a caveat that has already been lost.

## Proven, on a machine with none of the author's state

A fresh clone of this repository and the ledger beside it passes all four
instruments:

| Command | Result |
|---|---|
| `make check` | 114 pass, 0 fail |
| `make prove` | 74 of 74 gates watched failing |
| `make score` | 100 / 100 |
| `make status` | 85 of 86 delivered |

Every one of the thirteen end-to-end specs has passed against the real model:
the six issue routes, the staged gate recovery, the four company shapes, the
plan revision, the board, and the click paths.

## Not proven: the whole suite as one sequence

`make e2e` runs all thirteen specs in order. Every spec has passed on its own.
**They have never run as one uninterrupted pass.**

That gap is worth naming rather than rounding away, because the specs share one
board and one repository, and four separate bugs during this build came from a
spec finding the state a previous spec had left:

- a route that insisted its item began in intake, after another route moved it
- a review that reused a verdict from the run before
- a fixture already repaired by the attempt that failed to read its own result
- the company-shapes spec leaving the ledger in the last shape it applied, so
  the cross-stack route was judged by a contract nobody chose

Each is fixed, and each was found by accident rather than by running the
sequence. A full pass is the only thing that would find the fifth.

It costs roughly ninety minutes of model spend and wall clock. Run it before the
first live session, unattended:

```bash
nohup make e2e > artifacts/e2e.log 2>&1 &
```

Then read `review.html`, which is regenerated at the end of that command.

## Not proven: approving a gate by clicking

`11-click-paths.spec.ts` proves a person can **start** a run by clicking, which
is the gate the supervised tier rests on. Approving a decision **mid-run** still
happens through the API in every spec. The board's approval control has never
been clicked by a test.

## Known about the lab, not about the factory

- The webhook is parked. GitHub refuses one it cannot reach, so
  `scripts/lib/webhook-stand-in.ts` delivers `issues.opened`,
  `pull_request.opened`, `pull_request.synchronize` and `issue_comment.created`
  to the server itself, signed with the app's secret. Polling does not stand in:
  the reconcile sweep patches and closes items that exist and never creates one.
- The ledger carries several hundred issues and pull requests from this build.
  `make lab-reset` returns the board and the repository to a session start, and
  the history is left alone.
