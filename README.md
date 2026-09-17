# Software Factory

A software factory is the engineering system around a coding agent: what it may attempt, where it
runs, what context it receives, what proof it must produce, and where a human decides.

This repository is that system, built one layer at a time so you can read it. It is the lab for the
learnwithparam Software Factory sessions, and it is useful on its own.

## It knows nothing about your codebase

Everything the factory needs to know about a repository lives in that repository, in a `.factory`
directory its own team owns.

```
.factory/
  charter.md      what may be attempted here, and what must never be touched
  targets.json    who owns which paths, what checks them, how much freedom they get
  skills/*.md     procedures worth reusing in this codebase
  issues/*.md     work items, standing in for an issue tracker so the lab runs offline
```

Point the factory somewhere else and it behaves differently, because it reads that repository's
rules and no others. Nothing in `steps/` names a service, a language or a directory belonging to any
particular project.

```bash
make check REPO=../ledger          # the example repository beside this one
make check REPO=~/work/your-repo   # yours
```

## The six layers

| Layer | The question it answers | Built in |
|---|---|---|
| Boundary | What may an agent attempt unattended, and what must it never touch? | `steps/01-boundary` |
| Execution | Where does it run, and what can it reach from there? | `steps/02-execution` |
| Context | What does this task need to know, and where does that come from? | `steps/03-context` |
| Skills | Which know-how is reusable rather than retyped per prompt? | `skills/` and each repo's own |
| Verification | What proof must exist before a person spends attention on this? | `steps/04-verification` |
| Delivery | How does finished work reach a person, and who decides it ships? | `steps/06-delivery` |

`steps/05-loop` is how a failure comes back with its reason attached and how a run ends.
`steps/07-mastra` maps all six onto a hosted platform, which is the honest way to answer whether to
build this or buy it.

## Running it

```bash
make install
make check    # prose, types, unit and structural tests. No model, no network
make prove    # break each scored gate on purpose and confirm it fails
make score    # what is actually proven, 0 to 100
make demo STEP=06
```

`make check` runs with no model and no network, because the executor is an interface: the same loop
runs against a recorded transcript for tests and against a real coding agent for a live run.

## Two things worth stealing even if you never run this

**A gate nobody has seen fail is not a gate.** `make prove` copies the tree to a scratch directory,
applies one declared break per scored check, and asserts that check goes red. A scorecard entry with
no break behind it fails the build. Every point is earned against a test that has been watched to
fail.

**Deterministic code decides what a verdict may claim.** After the reviewing agent has finished
talking, ordinary code reads the artifacts the run produced. A pass whose test was never shown to
fail without the change is downgraded. A quoted verdict that does not match the one the gate wrote is
downgraded. What the agent said about the run is never consulted.

## Build state

The score is the honest answer. `make score` names every check that has not run and reports how many
points are not yet bound to a test, so this README cannot claim more than the repository proves.

## Credit

The design borrows openly, and each of these is worth reading on its own:

- [Addy Osmani's Factory](https://github.com/addyosmani/factory) for the charter, the repository as
  the queue, the deterministic branch claim and the verdict line no agent may paraphrase, and its
  [demo write-up](https://github.com/addyosmani/factory-demo/blob/main/LEARNINGS.md) for the timings
  that shaped the latency budget here.
- [Damian Galarza's Software Factory](https://github.com/dgalarza/mastra-software-factory) for
  deciding in ordinary code, after the agent has finished talking, what a verdict may claim.
- [Owain Lewis's Machinist](https://github.com/owainlewis/machinist),
  [Blueprint](https://github.com/owainlewis/blueprint) and [Neo](https://github.com/owainlewis/neo)
  for the executor as a plain interface and for skills that state the outcome rather than script
  every move.
- [Mastra Factory](https://factory.mastra.ai) for the boards, phase rules and sandbox callback the
  last step maps these layers onto.
- Dex Horthy's talk, *Harness Engineering Is Not Enough: Why Software Factories Fail*, for the
  constraint the whole design turns on: generation scales more easily than human judgement.

## License

[MIT](LICENSE)

## What is proven, and what is not

[KNOWN.md](KNOWN.md) is the honest list: which instruments pass on a clean
clone, which claims are proven against the real model, and the three that are
not. Read it before the first live session. The largest gap is that all thirteen
end-to-end specs have passed individually and never as one sequence, which is
ninety minutes of `make e2e` and the only way to find the state one spec leaves
for the next.
