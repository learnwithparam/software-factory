# The shape the routes are written against

The graph in `targets.json` here is the one the six routes need, and it is not one of the four
company shapes in `../../profiles/`:

| target | autonomy | which route needs it |
|---|---|---|
| `contracts` | `propose` | 04 cross-stack. A contract change is never local, so a person accepts the plan |
| `budget` | `refuse` | 05 refusal. The money path is refused rather than attempted |
| `ingest`, `console` | `build` | 01, 02, 03. Ordinary work, unattended |
| `repo` | `refuse` | The protected paths, which no shape relaxes |

`make lab-reset` writes both files into the example repository and pushes them, because a run
clones from the remote rather than from the working copy.

This exists because `make lab-reset` once restored `profiles/solo/` instead, which sets every
target to `build`. Under that graph route 05 builds the money path rather than refusing it, and
route 04 loses the plan gate that justifies the whole ownership graph. `tests/example-repo.test.ts`
caught it, one command before a ninety minute run started.
