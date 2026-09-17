# Four company shapes, one repository

The same issues, the same factory, the same model. What changes is the contract the repository
hands it, and the whole argument of the workshop is that this is the only thing that should change.

The demonstration is issue five, which asks for the spend warning threshold to move earlier. It is
one line of Rust on the money path, and it takes a different route under each shape:

| Shape | `services/budget` | What happens to issue five |
|---|---|---|
| `solo` | `build` | A pull request, unattended. The author reads every diff before merging anyway, so the gate is at merge |
| `startup` | `propose` | A plan, waiting. Shared consequence needs a person to accept the approach before code exists |
| `scaleup` | `refuse` | Refused at planning and routed. The money path has an owning team, and this is not their queue |
| `enterprise` | protected | Refused before planning starts. The path is in the protected block, so there is nothing to plan |

None of these is the correct answer. They are four defensible positions about who carries the cost
of being wrong, and a factory that cannot express all four is a factory that has an opinion about
your company.

Apply one with `make profile NAME=solo`, which writes the charter and the ownership graph into the
repository and sets the two board switches to match. `make profile` with no name says which is
applied now.
