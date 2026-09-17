# Charter

What an agent may attempt in the agent run ledger without asking, and what it must never touch.

This is the `scaleup` shape. The factory is the same under all four; this file is the only thing
that differs, which is the point.

This file is owned by a person. An agent may propose a change to it, and that proposal is read
like any other pull request. Nothing in the factory rewrites it, because limits an agent can edit
are not limits.

## Tier

`TIER: supervised`

Work may be planned and implemented unattended. Nothing merges without a named engineer approving
it, on any tier, ever. Runs are started deliberately rather than on arrival.

## Autonomy, per target

Freedom follows consequence, not size. A large change to display code is safer than a small change
to the code that decides what something costs, and the graph says so rather than leaving it to
whoever is on call.

| Level | What it permits |
|---|---|
| `build` | Investigate, plan, implement, and open a pull request, unattended |
| `propose` | Investigate and plan. A person accepts the plan before any code is written |
| `refuse` | Stop. Record the reason and route the item to a person |

Under this shape the money path is `refuse`. The money path has an owning team, and an item that reaches it belongs in their queue rather than
in a plan written by whoever filed it.

Levels live in `.factory/targets.json` beside the paths they govern, so a new directory cannot
quietly inherit a permission nobody granted it.

## Protected paths

Never modified by an agent, at any tier. This block is what the factory reads, and the reason on
each line is part of it, so a path cannot be added without saying why.

```protected
.factory/targets.json     # editing the ownership graph would widen every other rule in this file
.factory/charter.md       # limits an agent can edit are not limits
AGENTS.md                 # it repeats those limits, so the same argument applies to it
.github/**                # a workflow change can switch off the checks everything else rests on
**/*.lock                 # a lockfile changes only in a task that exists to change it
**/Cargo.lock             # the same, for the money path
**/go.sum                 # the same, for the ledger
```

Weakening an existing test assertion is protected too, and no glob can express it. Adding tests is
ordinary work; editing one so a failing run turns green is not. The verifier in step four is what
catches that, because it is a property of the diff rather than of a path.

## What finished means

A task is done when all of these hold. Any one missing is not done.

- The gate script ends in a passing verdict, quoted exactly, never summarised
- Every new test has been shown to fail without the change it covers
- A second agent has read the diff without being told how the work went, and agrees
- The change stays inside the files the task said it would touch
- A draft pull request exists, carrying its evidence, and nothing has been merged

## Stop conditions

The factory stops producing when any of these is true. Stopping is a result, not a fault.

- `STOP_IF: awaiting_review >= 5`. The limit is how many decisions can be waiting on a person,
  not how much can be generated. When the queue is full, starting more work makes things worse
- A task needs a path the graph marks `refuse`
- A task has failed its checks twice with the reason attached, and still fails
- A stage has run past its budget, which the factory declares and this file does not
- The gate reports a required check is missing, which is neither a pass nor a failure

## What a person still does

Writes this file. Starts runs. Accepts plans for anything marked `propose`. Owns the money path
outright: items that reach it are routed to that team rather than planned here.
