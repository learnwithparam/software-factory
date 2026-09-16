#!/usr/bin/env bash
#
# The gate, as a command. The logic lives in gate.ts so one implementation
# serves the script, the loop and the tests.
#
#   gates.sh --repo ../ledger --paths a,b
#   gates.sh --repo ../ledger --all
#   gates.sh --repo ../ledger --paths a --without-tests
#
# Exit codes: 0 pass, 1 fail, 2 misconfigured.
set -uo pipefail
exec bun "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gate-cli.ts" "$@"
