---
name: add-a-test-that-bites
when: **
outcome: A new test that has been shown to fail without the change it covers.
---

# Adding a test that bites

## What good looks like

The test names the behaviour, not the implementation. It fails when the behaviour is wrong and
passes when it is right, and you have watched it do both. A test that has never been red is not
known to test anything.

## The sequence, every time

1. Write the test and watch it fail for the reason you expect. If it fails for a different reason,
   the test is wrong, not the code.
2. Make the change. Watch it pass.
3. Undo the change, keeping the test. Confirm it goes red again.
4. Restore the change.

Step three is the one people skip and the one that matters. It is the only check that proves the
test is connected to the behaviour.

## Constraints that are not obvious from the code

- Never weaken an existing assertion to make a run green. Adding tests is ordinary work; editing one
  so a failure disappears needs a person, and the reviewer is told to look for exactly that.
- A fixture smaller than one page cannot test paging. Match the size of the fixture to the boundary
  you are claiming to cross.
- Prefer a test at the edge of the behaviour to three in the middle of it. The interesting values
  are zero, one, the threshold, and one past the threshold.

## Evidence that it is done

The run record carries the reverted proof: the test was red without the change and green with it.
