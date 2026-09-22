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

Every one of the thirteen end-to-end specs has passed against the real model.
They cover the six issue routes, the staged gate recovery, the four company
shapes, the plan revision, the board and the click paths.

## Proven: the whole suite as one sequence

`make e2e` has run all thirteen specs as one uninterrupted pass. It took an hour
and a quarter, and it found what running the specs separately could not:

- a shared sign-in bucket. Nine sign-ins inside ten seconds met Better Auth's
  rate limit, which cannot see a client IP on localhost and so pools every
  sign-in into one bucket. Six routes died in under two hundred milliseconds.
  Fixed by signing in once per run in `e2e/global-setup.ts` and reusing the
  saved session, including in `drive.ts`, which had been signing in separately
- a board that draws its columns before its cards. `settleBoard` read zero cards
  three times and called that settled, in a second and a half
- a hard-coded issue count in two places, one of which had been red since the
  seventh issue landed
- `lab-reset` restoring the wrong ownership graph, which would have let the
  refusal route build the money path

Every one of those is fixed, and each now has a gate. What the sequence also
produced is the set of prompt-level instructions the model did not follow, which
`evidence/prompt-vs-gate.json` records and workbook.html teaches rather than hides.

## Run it before the first live session

It costs roughly ninety minutes of model spend and wall clock, and the board has
to start clean, which `make lab-reset` guarantees and `make e2e` now checks
before it begins:

```bash
make lab-reset
nohup make e2e > artifacts/e2e.log 2>&1 &
```

Then read `review.html`, which is regenerated at the end of that command.

## Not enforced by the platform: the ownership graph

This is the most important line in this file, because the material used to claim
otherwise.

Mastra Factory reads `AGENTS.md`, which states all three autonomy levels and
names the file they live in. It has no knowledge of `.factory/` and no code that
consults the graph before an agent writes a file.

There is also no stage gate. Nothing asks who is allowed to move an item. An agent that judges its own plan
finished moves itself into execute and starts building.

On the recorded runs it did both. It modified a path the graph refuses on the
clean route, and it wrote to a `propose` target with a plan nobody had accepted.
Neither is a misconfiguration and neither was worked around: the agent was told,
in the file the product reads, and nothing was there to stop it.

So the graph is advisory on the platform. In the hand-built pipeline it is enforced,
because `steps/01-boundary/policy.ts` is called before anything runs.

The file `evidence/prompt-vs-gate.json` records every instruction a run did not follow. The test
`tests/findings.test.ts` fails if workbook.html omits one. The page teaches the
contrast rather than the ideal. If you carry one thing from this repository into
your own, carry the check that reads the graph and refuses the diff.

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
