#!/usr/bin/env bash
# Installs the factory template into a target repo. Never overwrites a file
# that is already there — a repo customizing a skill keeps its own copy.
# `--dry-run` lists what would be written without touching anything.
set -euo pipefail

usage() {
  echo "usage: install.sh <target-dir> [--dry-run]" >&2
}

TARGET=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) TARGET="$arg" ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  usage
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/template"

if [[ ! -d "$SRC" ]]; then
  echo "install.sh: no template/ next to this script ($SRC)" >&2
  exit 1
fi

mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

wrote=0
skipped=0

while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  dest="$TARGET/$rel"
  if [[ -e "$dest" || -L "$dest" ]]; then
    echo "skip (exists): $rel"
    skipped=$((skipped + 1))
    continue
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "write: $rel"
    wrote=$((wrote + 1))
    continue
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$file" "$dest"
  case "$rel" in
    .claude/hooks/*) chmod +x "$dest" ;;
  esac
  echo "wrote: $rel"
  wrote=$((wrote + 1))
done < <(find "$SRC" -type f -print0 | sort -z)

LINK_REL=".agents/skills"
LINK="$TARGET/$LINK_REL"
if [[ -e "$LINK" || -L "$LINK" ]]; then
  echo "skip (exists): $LINK_REL"
  skipped=$((skipped + 1))
elif [[ "$DRY_RUN" -eq 1 ]]; then
  echo "symlink: $LINK_REL -> ../.claude/skills"
  wrote=$((wrote + 1))
else
  mkdir -p "$TARGET/.agents"
  ln -s "../.claude/skills" "$LINK"
  echo "symlinked: $LINK_REL -> ../.claude/skills"
  wrote=$((wrote + 1))
fi

action="wrote"
[[ "$DRY_RUN" -eq 1 ]] && action="would write"
echo ""
echo "install.sh: $action $wrote item(s), skipped $skipped existing item(s) in $TARGET"
echo "install.sh: .factory/config.json is not part of this template — add it (or reconcile with your repo's own) before \`factory watch\`."
