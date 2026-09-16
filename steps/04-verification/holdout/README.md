# Holdout checks

Behaviour the implementing agent never sees.

When the same run writes the code and the tests that cover it, a green suite means the code agrees
with itself. These checks are kept out of reach so passing them is evidence about behaviour again.

They are a sample, not a second suite. A handful covering the contract and the behaviour a user
would notice is worth more than a large set the agent could read and aim at.

The context router never includes this directory, and `steps/04-verification/verifier.ts` runs it
after the change rather than before.
