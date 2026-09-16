---
name: change-the-shared-contract
when: packages/contracts/**
outcome: One definition changed, and every language that reads it updated in the same change.
---

# Changing the shared contract

## What good looks like

The schema, the TypeScript types, the Go struct tags and the Rust field list all describe the same
shape when you are done. Three test suites, in three languages, pass together. No side of it is
left for a follow-up, because a contract that is half changed is a contract nobody can trust.

## Constraints that are not obvious from the code

- The schema is the definition. Every other file asserts itself against it. Never edit a language
  binding to match code you just wrote; edit the schema and let three suites tell you what to fix.
- Every property is required. There is no optional field in this contract, and the test that
  enforces that is deliberate: an optional field is a field two services will disagree about.
- Money is an integer in minor units. No amount is ever divided, and no ratio is ever a float.
- The Rust side reads the schema as text with no JSON dependency, so a property is matched where it
  is defined rather than where it is merely listed. If you add a property, check it is picked up.

## Evidence that it is done

- `bun tools/affected.ts --paths packages/contracts/...` lists every dependant, and every command it
  prints has been run.
- The contract test in each language passes: `bun test` in `packages/contracts`, `go test ./...` in
  `services/ingest`, `cargo test` in `services/budget`.
- At least one new test fails when the change is reverted.

## What to do when it gets hard

If a language binding cannot express the shape, that is information about the shape rather than
about the language. Say so and stop, rather than adding a special case on one side only.
