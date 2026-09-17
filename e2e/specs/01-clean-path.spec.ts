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
import { expect, openBoard, showBoard } from '../lib/factory.ts'
import { LEDGER } from '../lib/ledger.ts'
import { advance, announcePull, approveWaiting, itemForRoute, reviewText, settle, startRun, stageOf, transition, verdictOf } from '../lib/drive.ts'
import { shot } from '../lib/shot.ts'
import { execFileSync } from 'node:child_process'

const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

/**
 * What triage may call a README addition and still be right.
 *
 * The other eight categories are all failures with different names: "bug" reads
 * an addition as a defect, and "duplicate", "invalid", "spam", "out-of-scope"
 * and "resolved" each drop the work on the floor.
 */
const DEFENSIBLE_FOR_DOCS = ['docs', 'maintenance']

interface Pull {
	number: number
	title: string
	headRefName: string
}

/**
 * The pull request this run opened, found by its branch.
 *
 * Not "the only open one": the lab also opens the change route six reviews, and
 * not by title either, because the agent writes its own. The branch is the one
 * thing the factory names after the issue.
 */
function pullForIssue(issue: number): Pull {
	const out = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--json', 'number,title,headRefName'], { encoding: 'utf8' })
	const found = (JSON.parse(out) as Pull[]).filter((pull) => pull.headRefName === `factory/issue-${issue}`)
	if (found.length !== 1) throw new Error(`${found.length} open pull requests on factory/issue-${issue}, expected one`)
	return found[0] as Pull
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

	// The property, not the sample. Two runs of this classified the same issue as
	// "docs" and then "maintenance", and both are defensible for a README
	// addition, so pinning either one makes a test that fails on a coin toss.
	// What must hold is that a documentation change is not read as a defect and
	// not thrown away, and that is worth failing over.
	expect(DEFENSIBLE_FOR_DOCS, `a README addition classified as ${triaged.item.triageType}`)
		.toContain(triaged.item.triageType)
	await showBoard(page)
	await shot(page, 'factory-triage')
	await shot(page, 'factory-accept')

	// Planning. Accepting is a person moving the item, not the agent deciding to.
	const planned = await advance(item.id, 'planning', 'accepted after triage')
	expect(planned.decision?.status, 'planning should succeed').toBe('succeeded')
	await showBoard(page)
	await shot(page, 'factory-plan-waiting')

	// Building. The session claims a sandbox, checks the repository out and works.
	const built = await advance(item.id, 'execute', 'plan approved')
	expect(built.decision?.status, 'the build should succeed').toBe('succeeded')
	await showBoard(page)
	await shot(page, 'factory-building')

	const issueNumber = built.item.metadata.githubIssueNumber as number
	const pull = pullForIssue(issueNumber)

	// Sometimes the agent closes the issue itself once the pull request is open
	// and sometimes it leaves it in execute. Both happened across two runs, so the
	// spec no longer depends on which: a person moving finished work to done is
	// the supervised tier behaving exactly as its charter says it should.
	const finished = stageOf(built.item) === 'done'
		? built
		: await advance(built.item.id, 'done', 'pull request open, work finished')
	expect(stageOf(finished.item), 'the work should end in done with its PR open').toBe('done')

	await showBoard(page)
	await shot(page, 'factory-work-done')
	await shot(page, 'factory-board-work')

	// The pull request is a different item on a different board, and it only gets
	// there because the webhook stand-in announces it. GitHub cannot deliver to
	// localhost, and the reconcile sweep patches items rather than creating them.
	const review = await announcePull(pull.number, REPO)
	await transition(review, 'review', 'sent to review')
	await approveWaiting(review.id)
	const reviewed = await settle(review.id)
	expect(reviewed.decision?.status, 'the review should succeed').toBe('succeeded')

	await showBoard(page)
	await shot(page, 'factory-pr-opened')

	// The verdict is a line the review posts, not a status anybody set by hand.
	//
	// Approve, specifically. This issue is small, correct and asks for nothing
	// outside documentation, so a review that sends it back means either the
	// change or the reviewer is wrong, and both are worth a failure. Route six is
	// where a rejection is the thing being demonstrated.
	expect(verdictOf(reviewText(REPO, pull.number)), 'the review should state a verdict').toBe('approve')
})
