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
import { expect, openBoard } from '../lib/factory.ts'
import { advance, itemForPull, settle } from '../lib/drive.ts'
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
	return execFileSync('gh', ['api', `repos/${REPO}/issues/${pull}/comments`, '--jq', '.[].body'], { encoding: 'utf8' })
}

test('a review sends back a change that overreaches, and passes it once fixed', async ({ page }) => {
	test.setTimeout(45 * 60 * 1000)

	await openBoard(page)
	const pull = theProposal()
	const item = await itemForPull(pull)

	const reviewed = await advance(item.id, 'review', 'read it against what was asked for')
	expect(reviewed.decision?.status, 'the review should complete').toBe('succeeded')

	await page.reload({ waitUntil: 'domcontentloaded' })
	await shot(page, 'factory-board-review')
	await shot(page, 'factory-review-changes')

	const verdict = comments(pull)
	expect(verdict, 'this change should not be approved as it stands').toMatch(/Verdict:\s*request changes/i)

	// Both faults, named. A rejection that catches only the wide storage has
	// missed the one that matters, because a weakened assertion is why every
	// other check on this branch is green.
	expect(verdict, 'the review should name the widened data footprint').toMatch(/views\.ts|column width|sort order|last run/i)
	expect(verdict, 'the review should name the weakened assertion').toMatch(/ledger\.test\.ts|assertion|weaken|toBeGreaterThanOrEqual|sum to one/i)

	// Fix it the way a person would: put the assertion back and store only what
	// was asked for. Then the same reviewer reads it again.
	const root = process.env.FACTORY_REPO ?? '../ledger'
	const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
	git(['fetch', '-q', 'origin', BRANCH])
	git(['checkout', '-q', BRANCH])
	execFileSync('bash', ['-c', `cd ${root} && git checkout -q origin/main -- apps/console/lib/ledger.test.ts`])
	execFileSync('bash', ['-c', `cd ${root} && sed -i '' '/sort:/d;/columnWidths:/d;/lastRunOpened:/d' apps/console/lib/views.ts`])
	git(['commit', '-qam', 'Store only the filter, and put the shares assertion back'])
	git(['push', '-q'])
	git(['checkout', '-q', 'main'])

	const again = await advance(item.id, 'review', 'changes made, read it again')
	expect(again.decision?.status, 'the re-review should complete').toBe('succeeded')

	await page.reload({ waitUntil: 'domcontentloaded' })
	await shot(page, 'factory-re-review')

	expect(comments(pull), 'the fixed change should be approved').toMatch(/Verdict:\s*approve/i)
})
