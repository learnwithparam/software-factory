#!/usr/bin/env bash
#
# The checks, behind one command, ending in one line.
#
# Nothing downstream may paraphrase that line. An agent reporting that
# everything passed is a claim; the line is evidence, and the two are not
# interchangeable.
#
# The behaviour that earns its keep is what happens when a required check is
# missing. A repository with no test command must not produce a green run: it
# produces MISCONFIGURED and exit 2, because absence and success are
# indistinguishable from the outside and only one of them is safe to act on.
#
#   gates.sh                  run the checks for what changed since HEAD~1
#   gates.sh --all            run every check in the repository
#   gates.sh --paths a,b      run the checks for these paths
#   gates.sh --without-tests  drop the test command, to see it fail closed
#
# Exit codes: 0 pass, 1 fail, 2 misconfigured.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="$ROOT/target"

SELECT=(--since HEAD~1)
WITHOUT_TESTS=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) SELECT=(--all); shift ;;
    --since) SELECT=(--since "$2"); shift 2 ;;
    --paths) SELECT=(--paths "$2"); shift 2 ;;
    --without-tests) WITHOUT_TESTS=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

PLAN="$(cd "$TARGET" && bun tools/affected.ts "${SELECT[@]}" 2>&1)"
PLAN_STATUS=$?

if [[ $PLAN_STATUS -ne 0 ]]; then
  echo "$PLAN"
  echo
  echo "VERDICT: MISCONFIGURED a path in this change is owned by no target, so nothing declares its checks"
  exit 2
fi

if [[ -z "$PLAN" || "$PLAN" == "nothing changed" ]]; then
  echo
  echo "VERDICT: MISCONFIGURED no target was selected, so this run checked nothing"
  exit 2
fi

FAILED=()
RAN_A_TEST=0

while IFS=$'\t' read -r TARGET_NAME CHECK COMMAND; do
  [[ -z "${TARGET_NAME:-}" ]] && continue
  if [[ "$CHECK" == "test" && $WITHOUT_TESTS -eq 1 ]]; then
    echo "skip  $TARGET_NAME $CHECK"
    continue
  fi
  echo "run   $TARGET_NAME $CHECK"
  if ( cd "$TARGET" && eval "$COMMAND" ) > /tmp/gate-output.$$ 2>&1; then
    [[ "$CHECK" == "test" ]] && RAN_A_TEST=1
  else
    FAILED+=("$TARGET_NAME $CHECK")
    sed 's/^/      /' /tmp/gate-output.$$ | tail -20
  fi
  rm -f /tmp/gate-output.$$
done <<< "$PLAN"

if [[ $RAN_A_TEST -eq 0 ]]; then
  echo
  echo "VERDICT: MISCONFIGURED no test command ran, so this run proves nothing about behaviour"
  exit 2
fi

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo
  echo "VERDICT: FAIL ${#FAILED[@]} check(s) failed: ${FAILED[*]}"
  exit 1
fi

echo
echo "VERDICT: PASS every selected check passed"
exit 0
