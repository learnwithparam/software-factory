# The same six layers, on a platform

Step seven is the graduation, not the foundation. Everything before it was built by hand so that
this mapping is something you recognise rather than something you are told.

[Mastra Factory](https://factory.mastra.ai) is a real server: a board whose columns are stages,
where entering a stage starts an agent in a declared role, leaving one runs an action, and a policy
function allows or rejects a move. Those are the hooks the six layers land on.

## What maps onto what

| Layer | Built here | On the platform |
|---|---|---|
| Boundary | the repository's `.factory/charter.md`, read by `steps/01-boundary/policy.ts` | `transitionPolicy`, which allows or rejects a requested move and can demand recorded human acceptance |
| Context | `steps/03-context/router.ts` | The prompt an `invokeSkill` handler builds, plus the repository the sandbox checks out |
| Skills | `skills/*.md` here, plus the repository's own | `invokeSkill` with a `skillName`, resolved by the server |
| Execution | `steps/02-execution/worktree.ts` and `limits.ts` | The `sandbox` callback, returning a `LocalSandbox` or a cloud provider per session |
| Verification | `steps/04-verification/gate.ts` and `verifier.ts` | A working phase with a checking role, plus a `tools.<name>.onResult` rule reacting to what a tool returned |
| Delivery | `steps/06-delivery/deliver.ts` | The built-in Work and Review boards, and the pull request the server opens |

## What does not transfer

The judgement. A platform supplies the board, the sandboxes and the sessions. Which work may reach
done without a person, which needs recorded acceptance before any code exists, and where the money
path sits are still yours to state. On a platform they are a function; here they are a markdown file
and a JSON graph. The decision is about who maintains the parts you now understand, not about
whether to have them.

## Running it

The server is a normal Node project that runs fully local: LibSQL for storage, a local sandbox, and
authentication disabled for development.

```bash
npx create-factory@latest my-factory --no-platform
cd my-factory
openssl rand -base64 32          # FACTORY_CREDENTIAL_ENCRYPTION_KEY
npm run dev                      # the UI comes up on http://localhost:4111
```

`src/mastra/boards.ts` in this directory is the quality board described above, written against
`@mastra/factory`. Copy it into a generated project's `src/mastra/` and pass it in the
`MastraFactory` constructor's `boards` array.

It is not installed here. This repository has one dependency tree for the factory and one for the
target, and adding a third for a step that is taught by reading it would cost every student an
install they do not need.

## The honest comparison

What the platform gives you: a board, sessions with a workspace, sandboxes you do not operate,
integrations that already work, and a UI nobody had to build.

What it costs: another service in your estate, your policy expressed in someone else's shape, and
an upgrade path you do not control.

What you keep either way: the charter, the ownership graph, the checks, and the fact that nothing
merges without a person.
