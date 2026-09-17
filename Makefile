.DEFAULT_GOAL := help
SHELL := /bin/bash

# The repository this factory is pointed at. The factory knows nothing about it
# beyond what its own .factory directory declares, so this is the only line that
# has to change to run everything below against your own codebase.
REPO ?= ../ledger
export FACTORY_REPO := $(REPO)

.PHONY: help install tokens status check prove e2e score demo lab-reset clean factory-up factory-down factory-model factory-connect factory-doctor factory-user factory-app

help: ## List every target
	@grep -E '^[a-z0-9-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[33m%-11s\033[0m %s\n", $$1, $$2}'

install: ## Install the factory's own dependencies
	bun install

tokens: ## Regenerate every surface stylesheet from design/tokens.json
	@bun scripts/build-tokens.ts

check: ## Prose, types, unit and structural tests. No model, no network
	@mkdir -p artifacts && rm -f artifacts/junit.xml
	@bun scripts/tree-hash.ts --all > artifacts/check-tree.txt
	bun scripts/check-prose.ts
	bun x tsc --noEmit
	bun test --reporter=junit --reporter-outfile=artifacts/junit.xml


prove: ## Break each scored gate on purpose and confirm it fails
	@bun scripts/prove-gates.ts

factory-up: ## Start the Mastra Factory and its backing services
	@bash scripts/factory-up.sh

factory-down: ## Stop them, leaving no listener behind
	@bash scripts/factory-down.sh

factory-model: ## Give the factory its model provider, without a key on a command line
	@bun scripts/factory-model.ts

factory-connect: ## Connect the codebase, and say what to click
	@bun scripts/factory-connect.ts

factory-doctor: ## Is this machine ready to run a session?
	@bun scripts/factory-doctor.ts

factory-user: ## Create the local sign-in for this machine
	@bun scripts/factory-user.ts

factory-app: ## Create and install the GitHub App the Factory needs
	@bun scripts/factory-app.ts

e2e: ## Real model, real repository, real pull requests. Writes the run report
	@mkdir -p artifacts evidence/screens && rm -f artifacts/playwright.json
	@bun scripts/lib/one-run.ts
	@bun scripts/tree-hash.ts > artifacts/e2e-tree.txt
	cd e2e && bun install && bun x playwright install chromium && bun x playwright test
	@bun scripts/run-report.ts
	@bun scripts/waterfall.ts
	@bun scripts/org-shapes.ts
	@bun scripts/review-page.ts

finish: ## Run only the specs whose evidence is missing, until nothing more can be produced
	@bun scripts/finish.ts

status: ## How much of the workshop exists, against teach/manifest.json
	@bun scripts/status.ts

score: ## Score the build 0 to 100 from the latest check and e2e results
	@bun scripts/score.ts $(SCORE_ARGS) $(filter-out $@,$(MAKECMDGOALS))

demo: ## Run one step live against $(REPO): make demo STEP=02
	@bun scripts/demo.ts $(STEP) $(filter-out $@,$(MAKECMDGOALS))

profile: ## Put the repository in a company shape: make profile NAME=solo
	@bun scripts/profile.ts $(NAME)

lab-reset: ## Put $(REPO) back the way it started, and drop every workspace
	@bun scripts/lab-reset.ts

clean: ## Remove build output and run artifacts
	rm -rf artifacts .worktrees .factory-runs e2e/test-results e2e/playwright-report
