/**
 * The clean path: an issue nobody argues about, from intake to a reviewed pull
 * request.
 *
 * This is the run Lightning 1 and Module 1 open on, and the one every other
 * route is a deviation from. It is deliberately the dullest issue in the
 * repository, because the point is the shape of the loop rather than the
 * cleverness of the change.
 *
 * Two boards, which is the thing that surprises people. The issue lives on the
 * work board and reaches done when its pull request is opened. The pull request
 * is a separate item on the review board, with its own phases. A run that ends
 * at done has not skipped review; review is somewhere else.
 */

import { test } from '@playwright/test'
import { expect, openBoard } from '../lib/factory.ts'
import { LEDGER } from '../lib/ledger.ts'
import { advance, approveWaiting, itemForPull, itemForRoute, settle, startRun, stageOf, transition } from '../lib/drive.ts'
import { shot } from '../lib/shot.ts'
import { execFileSync } from 'node:child_process'

const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

function openPullRequests(): Array<{ number: number; title: string }> {
	const out = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--json', 'number,title'], { encoding: 'utf8' })
	return JSON.parse(out) as Array<{ number: number; title: string }>
}

test('an uncontroversial issue reaches a reviewed pull request', async ({ page }) => {
	test.setTimeout(45 * 60 * 1000)

	await openBoard(page)
	await shot(page, 'factory-intake')

	const item = await itemForRoute(LEDGER, 'clean')
	expect(stageOf(item), 'the clean issue should start in intake').toBe('intake')

	// Triage. The agent reads the issue and classifies it; nobody has accepted
	// anything yet, which is what the screenshot is for.
	await startRun(item, 'triage', 'factory-triage')
	const triaged = await settle(item.id)
	expect(triaged.decision?.status, 'triage should succeed').toBe('succeeded')
	expect(triaged.item.triageType, 'a README change is documentation').toBe('docs')
	await page.reload({ waitUntil: 'domcontentloaded' })
	await shot(page, 'factory-triage')
	await shot(page, 'factory-accept')

	// Planning. Accepting is a person moving the item, not the agent deciding to.
	const planned = await advance(item.id, 'planning', 'accepted after triage')
	expect(planned.decision?.status, 'planning should succeed').toBe('succeeded')
	await page.reload({ waitUntil: 'domcontentloaded' })
	await shot(page, 'factory-plan-waiting')

	// Building. The session claims a sandbox, checks the repository out and works.
	const built = await advance(item.id, 'execute', 'plan approved')
	expect(built.decision?.status, 'the build should succeed').toBe('succeeded')
	await page.reload({ waitUntil: 'domcontentloaded' })
	await shot(page, 'factory-building')

	// The agent closes the issue itself once the pull request exists, so the work
	// board reaching done is the signal, not a person moving it.
	expect(stageOf(built.item), 'the work item should be done once the PR is open').toBe('done')
	await page.reload({ waitUntil: 'domcontentloaded' })
	await shot(page, 'factory-work-done')
	await shot(page, 'factory-board-work')

	const pulls = openPullRequests()
	expect(pulls.length, 'the run should have opened exactly one pull request').toBe(1)
	const pull = pulls[0] as { number: number; title: string }

	// The pull request is a different item on a different board. It is put there
	// by scripts/lib/webhook-stand-in.ts, because GitHub cannot reach localhost.
	const review = await itemForPull(pull.number)
	await transition(review, 'review', 'sent to review')
	await approveWaiting(review.id)
	const reviewed = await settle(review.id)
	expect(reviewed.decision?.status, 'the review should succeed').toBe('succeeded')

	await page.reload({ waitUntil: 'domcontentloaded' })
	await shot(page, 'factory-pr-opened')

	// The verdict is a line the review posts, not a status anybody set by hand.
	const comments = execFileSync('gh', ['api', `repos/${REPO}/issues/${pull.number}/comments`, '--jq', '.[].body'], { encoding: 'utf8' })
	expect(comments, 'the review should state a verdict').toMatch(/Verdict:\s*(approve|request changes)/i)
})
