/**
 * The rejection: a review that sends work back, and the re-review that lets it
 * through.
 *
 * This is the only route that starts from somebody else's change rather than
 * from an issue, so the lab writes that change. `fixtures/saved-view.ts` opens a
 * pull request with two faults, both taken from the recorded cold review in
 * `steps/04-verification/reviews/6.json`, so the live reviewer and the offline
 * one are graded against the same answer:
 *
 *   1. It stores the filter that was asked for, plus the sort order, the column
 *      widths and the last run opened. A wider data footprint than anyone asked
 *      for, and the kind nobody notices because each piece looks harmless.
 *   2. It replaces an assertion that shares sum to one with one that holds for
 *      any input. That is why the suite is green, and it is the reason the
 *      charter says never to weaken a check to make it pass.
 *
 * A review that approves this has failed, and that is the point. Passing every
 * review is not evidence a reviewer works; catching something is.
 */

import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, openBoard, showBoard } from '../lib/factory.ts'
import { advance, itemForPull, reviewText, settle, verdictOf } from '../lib/drive.ts'
import { LEDGER } from '../lib/ledger.ts'
import { BRANCH } from '../../fixtures/saved-view.ts'
import { shot } from '../lib/shot.ts'

const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

function theProposal(): number {
	const out = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--json', 'number,headRefName'], { encoding: 'utf8' })
	const found = (JSON.parse(out) as Array<{ number: number; headRefName: string }>).find((pull) => pull.headRefName === BRANCH)
	if (found === undefined) throw new Error(`no open pull request on ${BRANCH}; run make lab-reset`)
	return found.number
}

function comments(pull: number): string {
	return reviewText(REPO, pull)
}

test('a review sends back a change that overreaches, and passes it once fixed', async ({ page }) => {
	test.setTimeout(45 * 60 * 1000)

	await openBoard(page)
	const pull = theProposal()

	// The fixture has to still be broken. This spec repairs the branch and pushes
	// it, so running it twice without make lab-reset leaves a pull request that is
	// already correct: the review then approves it, git finds nothing to commit,
	// and the failure blames the repair rather than the missing reset.
	const diff = execFileSync('gh', ['api', `repos/${REPO}/pulls/${pull}/files`, '--jq', '.[].patch'], { encoding: 'utf8' })
	expect(diff, 'the fixture is already repaired; run make lab-reset before this spec').toContain('toBeGreaterThanOrEqual(0)')

	const item = await itemForPull(pull)

	const reviewed = await advance(item.id, 'review', 'read it against what was asked for')
	expect(reviewed.decision?.status, 'the review should complete').toBe('succeeded')

	await showBoard(page)
	await shot(page, 'factory-board-review')
	await shot(page, 'factory-review-changes')

	const verdict = comments(pull)
	expect(verdictOf(verdict), 'this change should not be approved as it stands').toBe('changes')

	// Both faults, named. A rejection that catches only the wide storage has
	// missed the one that matters, because a weakened assertion is why every
	// other check on this branch is green.
	expect(verdict, 'the review should name the widened data footprint').toMatch(/views\.ts|column width|sort order|last run/i)
	expect(verdict, 'the review should name the weakened assertion').toMatch(/ledger\.test\.ts|assertion|weaken|toBeGreaterThanOrEqual|sum to one/i)

	// Fix it the way a person would: put the assertion back and store only what
	// was asked for. Then the same reviewer reads it again.
	// LEDGER, not a relative path: this runs with e2e/ as its working directory,
	// so "../ledger" pointed inside the factory and git answered ENOENT.
	const git = (args: string[]): string => {
		try {
			return execFileSync('git', args, { cwd: LEDGER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
		} catch (error) {
			// execFileSync throws with the command line and swallows stderr, which
			// turns "nothing to commit" into "Command failed: git commit".
			const said = (error as { stderr?: Buffer | string; stdout?: Buffer | string })
			throw new Error(`git ${args.join(' ')} failed: ${String(said.stderr ?? '')}${String(said.stdout ?? '')}`.trim())
		}
	}
	git(['fetch', '-q', 'origin', BRANCH])
	git(['checkout', '-q', BRANCH])
	git(['checkout', '-q', 'origin/main', '--', 'apps/console/lib/ledger.test.ts'])
	writeFileSync(
		join(LEDGER, 'apps', 'console', 'lib', 'views.ts'),
		readFileSync(join(LEDGER, 'apps', 'console', 'lib', 'views.ts'), 'utf8')
			.split('\n')
			.filter((line) => !/\bsort:|columnWidths:|lastRunOpened:/.test(line))
			.join('\n'),
	)
	git(['commit', '-qam', 'Store only the filter, and put the shares assertion back'])
	git(['push', '-q'])
	git(['checkout', '-q', 'main'])

	const again = await advance(item.id, 'review', 'changes made, read it again')
	expect(again.decision?.status, 'the re-review should complete').toBe('succeeded')

	await showBoard(page)
	await shot(page, 'factory-re-review')

	expect(verdictOf(comments(pull)), 'the fixed change should be approved').toBe('approve')
})
