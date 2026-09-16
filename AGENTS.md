# Software Factory

The lab for the learnwithparam Software Factory sessions. **This is teaching material that has to
work live in front of a room.** A step that fails on stage costs the session, so every change is
proven by running it, never by reading it.

## Running it

```bash
make install   # the factory's own dependencies
make check     # prose, types, unit and structural tests. No model, no network
make e2e       # real model, real repository, real pull requests
make score     # 0 to 100 from the latest check and e2e results. Below 100 exits 1
make demo STEP=02
```

## Two codebases, one repository

`target/` is the codebase the agents change. Everything else is the factory that changes it. They
never import from one another. A factory that reaches into the target's source is a factory that
only works on one repository.

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
- **The teach surfaces hold one copy of each idea.** Explanations live in `teach.html`. Run sheets in
  `teach/` carry the talk track and the commands, and cite concepts by id.
- **No em dashes** in prose. `scripts/check-prose.ts` enforces it across every tracked markdown and
  HTML file.
- **Secrets never go on a command line.** Pass them through the environment or stdin.
