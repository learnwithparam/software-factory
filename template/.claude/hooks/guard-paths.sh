#!/usr/bin/env bash
# PreToolUse guard for Edit|Write|MultiEdit|Bash. Refuses writes to protected
# paths (from .factory/config.json's protectedPaths, plus .claude/** and
# .factory/** always) and dangerous git/gh commands. `.factory/runs/**` is
# always allowed — that is where a stage hands its output back to the runner
# (see src/artifacts.ts in the software-factory repo). Exit 2 + stderr blocks.
set -euo pipefail
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"

# The script is written to a temp file rather than piped via `python3 -
# <<PY`: that form redirects the python3 process's OWN stdin to the heredoc
# text, leaving nothing on stdin for json.load() to read the hook's JSON
# from. A temp file keeps stdin free. (Also: macOS ships bash 3.2, which
# mis-parses a heredoc containing parentheses nested inside `<(...)`.)
SCRIPT="$(mktemp)"
trap 'rm -f "$SCRIPT"' EXIT

cat >"$SCRIPT" <<'PY'
import fnmatch
import json
import re
import sys

project_dir = sys.argv[1]
try:
    hook_input = json.load(sys.stdin)
except Exception:
    sys.exit(0)  # can't parse our own input: fail open, never fail the session

tool_name = hook_input.get("tool_name", "")
tool_input = hook_input.get("tool_input", {})


def block(reason):
    print(reason, file=sys.stderr)
    sys.exit(2)


if tool_name == "Bash":
    command = tool_input.get("command", "")
    if (
        re.search(r"\bgit\s+merge\b", command)
        or re.search(r"\bgh\s+pr\s+merge\b", command)
        or re.search(r"\bgit\s+push\b[^\n]*--force\b", command)
    ):
        block(f"guard-paths: blocked — a stage never merges or force-pushes: {command}")
    sys.exit(0)

if tool_name not in ("Edit", "Write", "MultiEdit"):
    sys.exit(0)

path = tool_input.get("file_path") or tool_input.get("path") or ""
if not path:
    sys.exit(0)

rel = path[len(project_dir) + 1 :] if path.startswith(project_dir + "/") else path

if rel.startswith(".factory/runs/"):
    sys.exit(0)

try:
    with open(f"{project_dir}/.factory/config.json") as f:
        globs = list(json.load(f).get("protectedPaths", []))
except Exception:
    globs = []

globs += [".claude/**", ".factory/**"]

for g in globs:
    if fnmatch.fnmatch(rel, g) or fnmatch.fnmatch(path, g):
        block(f'guard-paths: "{rel}" matches protected path "{g}" — this needs a human, not a stage edit')

sys.exit(0)
PY

# Fail CLOSED, not open: without python3 there is no way to evaluate
# protectedPaths or the merge/force-push blocklist, so every tool call must
# be refused rather than silently let through (audit finding #13 — a bare
# `python3 "$SCRIPT"` on a PATH without python3 exits 127, which Claude Code
# treats as "hook errored", not "hook blocked", so the tool call would have
# gone through anyway).
if ! command -v python3 >/dev/null 2>&1; then
  echo "guard-paths: blocked — python3 is not on PATH, so protected paths can't be checked; refusing every tool call until this is fixed (fails closed, not open)" >&2
  exit 2
fi

python3 "$SCRIPT" "$PROJECT_DIR"
