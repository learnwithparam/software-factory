# Software Factory

A software factory is the engineering system around a coding agent: what it may attempt, where it
runs, what context it receives, what proof it must produce, and where a human decides. This
repository builds one, layer by layer, on a codebase with three languages in it.

It is the lab for the learnwithparam Software Factory sessions. It is also readable on its own.

## What it does

An issue becomes a task. The task runs in an isolated worktree behind explicit boundaries. Context
is routed to it rather than pasted into an ever-longer prompt. The work is verified by gates that
fail closed and by an independent agent that reads the diff cold. What reaches you is a pull
request with its evidence attached, and the merge decision stays yours.

## The six layers

| Layer | The question it answers |
|---|---|
| Boundary | What may an agent attempt without asking, and what must it never touch? |
| Context | What does this task need to know, and where does that come from? |
| Skills | Which engineering know-how is reusable rather than retyped per prompt? |
| Execution | Where does the agent run, and what can it reach from there? |
| Verification | What proof must exist before a human spends attention on this? |
| Delivery | How does finished work reach a person, and who decides it ships? |

## Two codebases

`target/` is an agent run ledger: a Go ingest service, a Rust budget engine, a Next.js console and
one shared contract the three of them are each tested against. It exists so the factory has real
work to do across real language boundaries, and so a change to the shared contract goes red in three
test suites at once.

Everything outside `target/` is the factory. The two never import from one another.

## Running it

```bash
make install
make check    # prose, types, unit and structural tests. No model, no network
make score    # what is actually proven, 0 to 100
```

`make check` runs with no model and no network, because the executor is an interface: the same loop
runs against a recorded transcript for tests and against a real coding agent for `make e2e`.

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
  deciding in ordinary code, after the agent has finished talking, what a verdict is allowed to claim.
- [Owain Lewis's Machinist](https://github.com/owainlewis/machinist), [Blueprint](https://github.com/owainlewis/blueprint)
  and [Neo](https://github.com/owainlewis/neo) for the executor as a plain interface and for skills
  that state the outcome rather than script every move.
- [Mastra Factory](https://factory.mastra.ai) for the boards, phase rules and sandbox callback the
  last step maps these layers onto.
- Dex Horthy's talk, *Harness Engineering Is Not Enough: Why Software Factories Fail*, for the
  constraint the whole design turns on: generation scales more easily than human judgement.

## License

[MIT](LICENSE)
