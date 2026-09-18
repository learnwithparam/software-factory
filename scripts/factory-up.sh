#!/usr/bin/env bash
#
# Bring the Factory up: its backing services, then the server, with the secrets
# loaded from outside the repository.
#
# Secrets are exported from ~/.config/lwp-secrets/factory.env rather than passed
# on a command line, because a command line lands in shell history, in
# transcripts, and in a permission prompt that captures the whole line.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MASTRA="$HERE/../mastra"
SECRETS="$HOME/.config/lwp-secrets/factory.env"
LOG="$HERE/artifacts/factory.log"

if [[ ! -d "$MASTRA" ]]; then
  echo "No Factory project at $MASTRA." >&2
  echo "Generate one: (cd $HERE/.. && bunx create-factory@0.1.18 mastra --no-platform)" >&2
  exit 2
fi

if [[ -f "$SECRETS" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS"
  set +a
  echo "loaded $(grep -cE '^[A-Z][A-Z0-9_]*=' "$SECRETS") secrets from $SECRETS"
else
  echo "no $SECRETS yet; run make factory-doctor to see what is missing"
fi

# Any HTTP status means the server is up: with auth on, the root answers 401, which curl -f calls a failure.
answering() { [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:4111)" != "000" ]]; }

echo "starting postgres and redis"
docker compose -f "$MASTRA/docker-compose.yml" up -d --wait

if answering; then
  echo "the Factory server is already up on http://localhost:4111"
  exit 0
fi

mkdir -p "$HERE/artifacts" "$MASTRA/.sandboxes"
echo "starting the Factory server, logging to $LOG"
( cd "$MASTRA" && nohup bun run dev > "$LOG" 2>&1 & echo $! > "$HERE/artifacts/factory.pid" )

for _ in $(seq 1 60); do
  if answering; then
    echo "up on http://localhost:4111"
    exit 0
  fi
  sleep 2
done

echo "the server did not answer within two minutes. Last lines:" >&2
tail -20 "$LOG" >&2
exit 1
