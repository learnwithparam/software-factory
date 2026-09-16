#!/usr/bin/env bash
# Stop the Factory server and its backing services, leaving no listener behind.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MASTRA="$HERE/../mastra"

if [[ -f "$HERE/artifacts/factory.pid" ]]; then
  kill "$(cat "$HERE/artifacts/factory.pid")" 2>/dev/null
  rm -f "$HERE/artifacts/factory.pid"
fi
pkill -f "mastra factory dev" 2>/dev/null
sleep 1
for pid in $(lsof -t -nP -iTCP:4111 -sTCP:LISTEN 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done

[[ -d "$MASTRA" ]] && docker compose -f "$MASTRA/docker-compose.yml" down
echo "listeners left on 4111: $(lsof -nP -iTCP:4111 -sTCP:LISTEN 2>/dev/null | grep -c LISTEN)"
