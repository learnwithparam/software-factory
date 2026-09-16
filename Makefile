.DEFAULT_GOAL := help
SHELL := /bin/bash

.PHONY: help install tokens check prove e2e score demo lab-reset clean

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

e2e: ## Real model, real repository, real pull requests. Writes the run report
	@mkdir -p artifacts evidence/screens && rm -f artifacts/playwright.json
	@bun scripts/tree-hash.ts > artifacts/e2e-tree.txt
	cd e2e && bun install && bun x playwright install chromium && bun x playwright test

score: ## Score the build 0 to 100 from the latest check and e2e results
	@bun scripts/score.ts

demo: ## Run one step live: make demo STEP=02
	@bun scripts/demo.ts $(STEP)

lab-reset: ## Recreate the scratch GitHub repository from the seed commit
	@bun scripts/lab-reset.ts

clean: ## Remove build output and run artifacts
	rm -rf artifacts .worktrees e2e/test-results e2e/playwright-report
