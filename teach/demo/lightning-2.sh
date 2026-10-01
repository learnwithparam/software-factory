#!/usr/bin/env bash
# The tmux layout, scene titles, screenshots and recording for the lightning-2 demo.
# The steps to run inside it are in teach/lightning-2.md.
# Usage: teach/demo/lightning-2.sh [--dry-run] [--record] up|attach|scene <n>|snap <name> [window]|down|scenes
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO_DIR="${DEMO_DIR:-$(cd "$ROOT/.." && pwd)/splitbill-demo}"
REPO="${DEMO_REPO:-learnwithparam/splitbill-demo}"
SESSION="lightning-2"
VERSION="$(jq -r .version "$ROOT/package.json")"
OUT="${FACTORY_HOME:-$HOME/.factory}/recordings/lightning-2/v$VERSION"
WORKSPACES="${FACTORY_HOME:-$HOME/.factory}/$REPO/workspaces"
DRY=0
RECORD=0

SCENES=(
  "0|setup|reset, doctor, layout"
  "1|worktree per task|two issues, two worktrees, one cancelled"
  "2|sandbox boundaries|protected paths, allowed commands, budgets"
  "3|execution harness|label to claim to PR"
  "4|your branch isolated|my-feature untouched"
  "5|close|deliver and reset"
)

run() {
  if [ "$DRY" = 1 ]; then printf '%q ' "$@"; echo; else "$@"; fi
}

up() {
  if [ "$DRY" = 0 ] && tmux has-session -t "$SESSION" 2>/dev/null; then echo "session $SESSION already up"; return; fi
  run tmux new-session -d -s "$SESSION" -n you -c "$DEMO_DIR" -x 200 -y 50
  run tmux new-window -t "$SESSION" -n factory -c "$ROOT" "make up REPO_DIR=$DEMO_DIR"
  run tmux split-window -t "$SESSION:factory" -v -c "$DEMO_DIR" \
    "while :; do clear; git worktree list; ls $WORKSPACES 2>/dev/null; sleep 2; done"
  run tmux new-window -t "$SESSION" -n logs -c "$ROOT"
  run tmux new-window -t "$SESSION" -n boundary -c "$DEMO_DIR"
  run tmux new-window -t "$SESSION" -n flow -c "$DEMO_DIR" \
    "while :; do clear; gh issue list -R $REPO --state all --limit 10 --json number,title,labels -q '.[]|\"#\\(.number) \\(.title[0:40])  \\(.labels|map(.name)|join(\" \"))\"'; sleep 5; done"
  run tmux set-option -t "$SESSION" status-left-length 80
  run tmux select-window -t "$SESSION:you"
  scene 0
}

scene() {
  local n="$1" row
  for row in "${SCENES[@]}"; do
    IFS='|' read -r id name what <<<"$row"
    if [ "$id" = "$n" ]; then run tmux set-option -t "$SESSION" status-left " lightning-2 | scene $id: $name "; return; fi
  done
  echo "no scene $n" >&2; exit 2
}

snap() {
  local name="$1" window="${2:-}"
  [ -n "$window" ] || window="$(tmux display-message -p -t "$SESSION" '#{window_name}')"
  run mkdir -p "$OUT"
  run bun "$ROOT/teach/demo/snap.ts" "$SESSION:$window" "$OUT/$name.png"
}

attach() {
  if [ "$RECORD" = 1 ]; then
    run mkdir -p "$OUT"
    run asciinema rec --idle-time-limit 2 --command "tmux attach -t $SESSION" "$OUT/session-$(date +%H%M%S).cast"
  else
    run tmux attach -t "$SESSION"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --record) RECORD=1; shift ;;
    *) break ;;
  esac
done

case "${1:-}" in
  up) up ;;
  attach) attach ;;
  scene) scene "${2:?scene number}" ;;
  snap) snap "${2:?shot name}" "${3:-}" ;;
  down) run tmux kill-session -t "$SESSION" ;;
  scenes) for row in "${SCENES[@]}"; do echo "$row"; done ;;
  *) sed -n 2,4p "$0" | sed 's/^# //'; exit 2 ;;
esac
