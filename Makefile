.PHONY: install check typecheck test skills-check up watch dashboard reset doctor scan

install:
	bun install

# make check = typecheck + test + skills validation. Hard-fails if uvx is
# missing rather than skipping skills-ref: an unwired or silently-skipped
# check did not ship (see ~/.claude/engineering.md, Rule 0).
check: typecheck test skills-check
	@echo "make check: ok"

typecheck:
	bun x tsc --noEmit

# Run with no git identity, like a fresh CI runner or container, so a code path
# that needs the developer's own identity fails here and not only on GitHub.
test:
	GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.useConfigOnly GIT_CONFIG_VALUE_0=true bun test

skills-check:
	@command -v uvx >/dev/null 2>&1 || { \
		echo "make check: uvx is required to validate template/.claude/skills (install: https://docs.astral.sh/uv/) — not skipping this check" >&2; \
		exit 1; \
	}
	@for dir in template/.claude/skills/*/; do \
		name="$$(basename "$$dir")"; \
		echo "skills-ref validate: $$name"; \
		uvx --from "git+https://github.com/agentskills/agentskills#subdirectory=skills-ref" skills-ref validate "$$dir" || exit 1; \
	done

# `make up`: run the poller and the dashboard together. Requires
# .factory/config.json in the target repo; --repo-dir defaults to $$PWD.
# `watch` never returns, so it's backgrounded and killed with the dashboard
# on Ctrl+C (trap), rather than listed as a `up: watch dashboard` prereq
# (make would run watch to completion first and never reach dashboard).
up:
	@trap 'kill 0' EXIT INT TERM; \
	bun bin/factory watch --repo-dir "$${REPO_DIR:-.}" & \
	bun bin/factory dashboard --repo-dir "$${REPO_DIR:-.}" & \
	wait

watch:
	bun bin/factory watch --repo-dir "$${REPO_DIR:-.}"

dashboard:
	bun bin/factory dashboard

reset:
	bun bin/factory reset --repo-dir "$${REPO_DIR:-.}" $(if $(DRY_RUN),--dry-run,)

doctor:
	bun bin/factory doctor --repo-dir "$${REPO_DIR:-.}"

scan:
	bun bin/factory scan --repo-dir "$${REPO_DIR:-.}"
