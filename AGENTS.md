# Software Factory

The lab for the learnwithparam Software Factory sessions. **This is teaching material that has to
work live in front of a room.** A step that fails on stage costs the session, so every change is
proven by running it, never by reading it.

## Running it

```bash
make install   # the factory's own dependencies
make check     # prose, types, unit and structural tests. No model, no network
make prove     # break each scored gate on purpose and confirm it fails
make e2e       # real model, real repository, real pull requests
make score     # 0 to 100 from the latest check and e2e results. Below 100 exits 1
make demo STEP=02
make check REPO=~/work/your-repo   # every target takes a repository
```

## The factory knows nothing about any codebase

Everything the factory needs to know about a repository lives in that repository's `.factory`
directory. Nothing under `steps/` may name a service, a language or a directory belonging to a
particular project, and no test may assert a fact about one. Tests run against
`tests/fixtures/sample`, a repository invented for them; `tests/example-repo.test.ts` checks the
example beside this one for shape only.

A factory whose own suite knows the codebase it was written against is a script for that codebase.

## Rules

- **The score is the definition of done.** Every point in `scripts/rubric.ts` is bound to one test,
  and `tests/gate.test.ts` fails when the rubric names a test that does not exist. Add the test and
  the rubric line in the same change.
- **A gate nobody has seen fail is not a gate.** Break each new check on purpose once, confirm the
  score drops and the named check fails, then restore it.
- **The writer never grades the work.** Implementation delegates to a verifier that reads the diff
  cold. Its strongest check is one no gate can make: revert the fix and confirm the test goes red.
- **Deterministic code decides what a verdict may claim.** A verdict is downgraded when its evidence
  is missing, whatever the agent said about the run.
- **Merge is never automated.** The pipeline stops at a pull request and an engineer decides.
- **A mutation that makes its own assertion trivially true proves nothing.** When a proof reports
  that a check still passes, the mutation is wrong, not the check.
- **The teach surfaces hold one copy of each idea.** Explanations live in `teach.html`. Run sheets in
  `teach/` carry the talk track and the commands, and cite concepts by id.
- **No em dashes** in prose. `scripts/check-prose.ts` enforces it across every tracked markdown and
  HTML file.
- **Secrets never go on a command line.** Pass them through the environment or stdin.
