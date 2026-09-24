#!/usr/bin/env bash
# Runs every gate in .factory/config.json and prints exactly one summary
# line the runner parses: FACTORY_GATES: status=... passed=N failed=N skipped=N failed_gates=a,b
# Exit code: 0 GREEN, 1 RED, 2 MISCONFIGURED.
set -u
cd "$(dirname "$0")/.."

CONFIG=".factory/config.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "FACTORY_GATES: status=MISCONFIGURED passed=0 failed=0 skipped=0 failed_gates=jq-not-found"
  exit 2
fi

if [ ! -f "$CONFIG" ]; then
  echo "FACTORY_GATES: status=MISCONFIGURED passed=0 failed=0 skipped=0 failed_gates=config-missing"
  exit 2
fi

if ! jq empty "$CONFIG" >/dev/null 2>&1; then
  echo "FACTORY_GATES: status=MISCONFIGURED passed=0 failed=0 skipped=0 failed_gates=config-invalid-json"
  exit 2
fi

gate_count=$(jq '.gates | length' "$CONFIG" 2>/dev/null || echo "")
if [ -z "$gate_count" ] || [ "$gate_count" = "null" ] || [ "$gate_count" -eq 0 ]; then
  echo "FACTORY_GATES: status=MISCONFIGURED passed=0 failed=0 skipped=0 failed_gates=no-gates-defined"
  exit 2
fi

passed=0
failed=0
skipped=0
required_failed_names=()
optional_failed_names=()

for i in $(seq 0 $((gate_count - 1))); do
  name=$(jq -r ".gates[$i].name" "$CONFIG")
  cmd=$(jq -r ".gates[$i].cmd" "$CONFIG")
  required=$(jq -r ".gates[$i].required" "$CONFIG")

  echo "--- gate: $name ($cmd) ---"
  gate_log=$(mktemp "${TMPDIR:-/tmp}/factory-gate-${name}.XXXXXX")
  if eval "$cmd" > "$gate_log" 2>&1; then
    echo "PASS: $name"
    passed=$((passed + 1))
  else
    echo "FAIL: $name"
    tail -n 20 "$gate_log"
    if [ "$required" = "true" ]; then
      failed=$((failed + 1))
      required_failed_names+=("$name")
    else
      skipped=$((skipped + 1))
      optional_failed_names+=("$name")
    fi
  fi
  rm -f "$gate_log"
done

all_failed_names=()
for n in "${required_failed_names[@]:-}" "${optional_failed_names[@]:-}"; do
  [ -n "$n" ] && all_failed_names+=("$n")
done
failed_gates=$(IFS=,; echo "${all_failed_names[*]:-}")

if [ "$failed" -gt 0 ]; then
  status="RED"
  exit_code=1
else
  status="GREEN"
  exit_code=0
fi

echo "FACTORY_GATES: status=$status passed=$passed failed=$failed skipped=$skipped failed_gates=$failed_gates"
exit $exit_code
