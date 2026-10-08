# Workflows

An issue runs a workflow: named steps, each a built-in step type, the label it holds while it runs,
and where it goes next. `config.workflow` names it (default `feature-to-pr`). The runner reads
`.factory/workflows/<name>.yml` from the repo, else its own copy in
`template/.factory/workflows/`. A file that does not parse stops `factory watch` at boot, and
`factory doctor` lists every problem.

## Step keys

| key | meaning |
|---|---|
| `uses` | the step type: `triage`, `plan`, `build`, `verify`, `pr` or `check` |
| `label` | the `factory:*` label the issue holds during the step; unique per workflow |
| `next` | a step id, or a list of edges; `pr` ends the workflow, so it has none |
| `reject` | where a rejection goes; required on `verify` |
| `revise` | where `/factory revise` goes when the issue is parked on this step's label |
| `run` | a `check` step's shell command; exit 0 moves on, anything else parks the issue as failed |

An edge is `{ to: <step> }` or `{ park: awaiting-approval, approve: <step>, revise: <step> }`,
with an optional `if:`. The first edge whose `if:` holds wins; the last has no `if:`.

`limits.questions` caps needs-info rounds and `limits.rejects` caps rejections (both default 2).

## `if:`

`if:` reads a step's JSON by its id (`plan.risk`), `toggles.autoApproveLowRisk` and `config`. It
has `==`, `!=`, `&&`, `||`, `!`, parentheses, and string, number and boolean literals. A name it
cannot resolve is a load error.

## What the loader refuses

Unknown keys, an unknown step type, a duplicate label, an edge to a missing step, a `next:` loop
(only `reject`, `revise` and `approve` may point back), a step no edge reaches, and edges after
one with no `if:`.

## Example: lint before verify

```yaml
name: quick-fix
steps:
  triage: { uses: triage, label: factory:triaging, next: build }
  build: { uses: build, label: factory:building, next: lint }
  lint: { uses: check, label: factory:linting, run: make lint, next: verify }
  verify: { uses: verify, label: factory:verifying, next: pr, reject: build }
  pr: { uses: pr, label: factory:in-review, revise: build }
```

A new label such as `factory:linting` needs creating once: `factory doctor --fix`.
