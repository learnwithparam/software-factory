#!/usr/bin/env bash
# Installs the factory template into a target repo.
#
# Default mode never overwrites a file that is already there — a repo
# customizing a skill keeps its own copy. `--update` is for pulling in
# runner-side fixes (audit finding #17): every factory-owned file is
# overwritten EXCEPT .claude/settings.json, which a repo may have hand-tuned
# (extra deny entries) — that one is diffed instead of clobbered, and
# a `.claude/settings.json.factory-new` is written next to it when it
# differs, for the human to reconcile. `--ci` additionally writes an inert
# `.github/workflows/factory.yml.example` placeholder (the real workflow is
# a separate factory release — see the CI/CD section of the README).
# `--dry-run` lists what would happen without touching anything.
set -euo pipefail

usage() {
  echo "usage: install.sh <target-dir> [--dry-run] [--update] [--ci] [--agents a,b,c]" >&2
  echo "  --agents links the skills into each agent's own dir: claude,codex,gemini,opencode,cursor,pi,mastracode" >&2
}

TARGET=""
DRY_RUN=0
UPDATE=0
CI=0
AGENTS=""
NEXT_IS_AGENTS=0
for arg in "$@"; do
  if [[ "$NEXT_IS_AGENTS" -eq 1 ]]; then AGENTS="$arg"; NEXT_IS_AGENTS=0; continue; fi
  case "$arg" in
    --agents) NEXT_IS_AGENTS=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --update) UPDATE=1 ;;
    --ci) CI=1 ;;
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
unchanged=0

while IFS= read -r -d '' file; do
  rel="${file#"$SRC"/}"
  dest="$TARGET/$rel"

  # settings.json may carry repo-specific allow/deny entries on top of the
  # template's; --update never overwrites it silently.
  if [[ "$rel" == ".claude/settings.json" && "$UPDATE" -eq 1 && ( -e "$dest" || -L "$dest" ) ]]; then
    if diff -q "$file" "$dest" >/dev/null 2>&1; then
      echo "unchanged: $rel"
      unchanged=$((unchanged + 1))
    elif [[ "$DRY_RUN" -eq 1 ]]; then
      echo "differs (would write $rel.factory-new for review): $rel"
      wrote=$((wrote + 1))
    else
      cp "$file" "$dest.factory-new"
      echo "differs (not overwritten): $rel — reconcile with ${rel}.factory-new"
      wrote=$((wrote + 1))
    fi
    continue
  fi

  # Repo-owned files: the charter and config example are the repo's to edit.
  if [[ "$rel" == ".factory/charter.md" || "$rel" == ".factory/config.example.json" ]] && [[ -e "$dest" || -L "$dest" ]]; then
    echo "skip (repo-owned): $rel"
    skipped=$((skipped + 1))
    continue
  fi

  if [[ -e "$dest" || -L "$dest" ]]; then
    if [[ "$UPDATE" -eq 0 ]]; then
      echo "skip (exists): $rel"
      skipped=$((skipped + 1))
      continue
    fi
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "would overwrite: $rel"
      wrote=$((wrote + 1))
      continue
    fi
    cp "$file" "$dest"
    case "$rel" in
      .claude/hooks/*|.factory/gates.sh) chmod +x "$dest" ;;
    esac
    echo "overwrote: $rel"
    wrote=$((wrote + 1))
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
    .claude/hooks/*|.factory/gates.sh) chmod +x "$dest" ;;
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

# Skills stay in .claude/skills; each agent gets a symlink from its own dir. The map is
# pinned to the PRESETS registry by tests/install.test.ts.
agent_dirs() {
  case "$1" in
    claude) echo ".claude/skills CLAUDE.md" ;;
    codex) echo ".codex/skills AGENTS.md" ;;
    gemini) echo ".gemini/skills GEMINI.md" ;;
    opencode) echo ".opencode/skills AGENTS.md" ;;
    cursor) echo ".cursor/skills AGENTS.md" ;;
    pi) echo ".pi/agent/skills AGENTS.md" ;;
    mastracode) echo ".mastracode/skills AGENTS.md" ;;
    *) return 1 ;;
  esac
}

if [[ -n "$AGENTS" ]]; then
  IFS=',' read -r -a AGENT_LIST <<< "$AGENTS"
  for agent in "${AGENT_LIST[@]}"; do
    if ! read -r skills_dir context_file < <(agent_dirs "$agent"); then
      echo "install.sh: unknown agent \"$agent\" (see --help)" >&2
      exit 1
    fi
    [[ "$skills_dir" == ".claude/skills" ]] && continue
    link="$TARGET/$skills_dir"
    up="$(dirname "$skills_dir" | sed -E 's#[^/]+#..#g')"
    if [[ -e "$link" || -L "$link" ]]; then
      echo "skip (exists): $skills_dir"
      skipped=$((skipped + 1))
    elif [[ "$DRY_RUN" -eq 1 ]]; then
      echo "symlink: $skills_dir -> $up/.claude/skills"
      wrote=$((wrote + 1))
    else
      mkdir -p "$(dirname "$link")"
      ln -s "$up/.claude/skills" "$link"
      echo "symlinked: $skills_dir -> $up/.claude/skills"
      wrote=$((wrote + 1))
    fi
    context="$TARGET/$context_file"
    if [[ "$context_file" != "CLAUDE.md" && ! -e "$context" && ! -L "$context" ]]; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "write: $context_file"
      else
        printf '%s\n' "# Factory" "" "Factory skills are in .claude/skills/ (linked into $skills_dir)." "The repo charter is .factory/charter.md; read it before any stage." > "$context"
        echo "wrote: $context_file"
      fi
      wrote=$((wrote + 1))
    fi
  done
fi

if [[ "$CI" -eq 1 ]]; then
  CI_SRC="$SCRIPT_DIR/template-ci/factory.yml.example"
  CI_DEST_REL=".github/workflows/factory.yml.example"
  CI_DEST="$TARGET/$CI_DEST_REL"
  if [[ ! -f "$CI_SRC" ]]; then
    echo "install.sh: --ci requested but $CI_SRC is missing" >&2
    exit 1
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "write: $CI_DEST_REL"
    wrote=$((wrote + 1))
  else
    mkdir -p "$(dirname "$CI_DEST")"
    cp "$CI_SRC" "$CI_DEST"
    echo "wrote: $CI_DEST_REL (inert — rename to factory.yml and set repo variable FACTORY_MODE=actions to activate)"
    wrote=$((wrote + 1))
  fi
fi

action="wrote"
[[ "$DRY_RUN" -eq 1 ]] && action="would write"
echo ""
echo "install.sh: $action $wrote item(s), skipped $skipped existing item(s), $unchanged unchanged in $TARGET"
if [[ ! -e "$TARGET/.factory/config.json" ]]; then
  echo "install.sh: next: cp .factory/config.example.json .factory/config.json, fill in every TODO (config.json, charter.md), then \`factory doctor --repo-dir $TARGET\`."
fi
