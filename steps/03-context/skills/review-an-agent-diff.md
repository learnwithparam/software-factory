---
name: review-an-agent-diff
when: **
outcome: A verdict on a diff, formed without reading any account of how the work went.
---

# Reviewing a diff cold

## What good looks like

You read the task and the diff. You do not read, and are not given, the story of the attempt.
Told what was tried, a reviewer anchors on it and starts confirming rather than checking.

## What to look for, in order

1. **Scope.** Does the diff touch files the task did not name? Extra files are the most common real
   defect and the easiest to miss.
2. **Widened behaviour.** Does it store more, expose more or allow more than the task asked for?
3. **Weakened checks.** Was an existing assertion changed, relaxed or deleted? This outranks
   everything else. A suite that was edited into passing is worse than a failing one.
4. **The negative proof.** Was the new test shown to fail without the change? If that evidence is
   missing, the verdict is not a pass whatever the suite says.
5. **Then correctness.** Only after the four above, which are cheap and catch more.

## Constraints that are not obvious from the code

- A green suite written by the same run that wrote the code means the code agrees with itself.
  Weigh the holdout checks higher than the ones that arrived with the change.
- Reject when uncertain. The cost of a false rejection is one more attempt. The cost of a false
  acceptance is a defect nobody is looking for any more.

## Evidence that it is done

A verdict of pass or fail, and when it fails, the reason attached to the specific file and line, so
the next attempt starts from the problem rather than from the beginning.
