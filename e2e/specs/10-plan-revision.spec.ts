/**
 * A plan sent back, and the second plan built instead.
 *
 * The fourth feedback loop, and the one most teams actually live in. The
 * workshop already shows a reviewer rejecting finished work, which is the
 * expensive place to disagree: the code exists, somebody wrote it, and changing
 * direction now costs all of it. Disagreeing at the plan costs a paragraph.
 *
 * The issue is deliberately vague about how far back is far enough. A first plan
 * has to pick something, and the exercise is a person reading that choice,
 * changing the priority, and the run revising rather than defending.
 *
 * What this spec can check is that the second plan is not the first one: that
 * the comment a person left changed what was proposed. A run that answers a
 * rejection by restating its original plan has not taken the feedback, and that
 * is the failure worth catching.
 */

import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { expect, openBoard, showBoard } from '../lib/factory.ts'
import { LEDGER } from '../lib/ledger.ts'
import { advance, itemForRoute, settleAfter, stageOf, startRun } from '../lib/drive.ts'
import { shot } from '../lib/shot.ts'

const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

function comments(issue: number): string {
	try {
		return execFileSync('gh', ['api', `repos/${REPO}/issues/${issue}/comments`, '--jq', '.[].body'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
	} catch {
		return ''
	}
}

test('a plan is sent back, and the next one answers the objection', async ({ page }) => {
	test.setTimeout(45 * 60 * 1000)

	await openBoard(page)
	const item = await itemForRoute(LEDGER, 'plan-revision')
	expect(stageOf(item), 'the vague issue should start in intake').toBe('intake')
	const issue = item.metadata.githubIssueNumber as number

	await startRun(item, 'triage', 'factory-triage')
	const triaged = await settleAfter(item.id, 0)
	expect(triaged.decision?.status, 'triage should succeed').toBe('succeeded')

	const planned = await advance(item.id, 'planning', 'accepted, let us see what it proposes')
	expect(planned.decision?.status, 'planning should succeed').toBe('succeeded')

	const first = comments(issue)
	expect(first.length, 'the run should have written a plan somebody can disagree with').toBeGreaterThan(200)

	await showBoard(page)
	await shot(page, 'factory-plan-proposed')

	// A person reads it and changes the priority. This is the whole loop: the
	// objection is about what to build, not about whether the code is correct,
	// and it arrives before any code exists.
	execFileSync('gh', [
		'issue', 'comment', String(issue), '--repo', REPO,
		'--body', [
			'Sending this plan back.',
			'',
			'Paging is the wrong shape for what this is for. A month-end review wants a date range, not',
			'a way to walk backwards through pages, and the reader knows the month they care about before',
			'they open the console.',
			'',
			'Plan a date range filter on the runs list instead. Keep the ingest service the only thing that',
			'decides what a run is, and keep the change to the two files the issue names.',
		].join('\n'),
	])

	const sentBackAt = Date.now()
	await advance(item.id, 'planning', 'plan rejected, the priority changed')
	const second = await settleAfter(item.id, sentBackAt)
	expect(second.decision?.status, 'the second plan should be written').toBe('succeeded')

	await showBoard(page)
	await shot(page, 'factory-plan-revised')

	// The claim: the objection moved the plan. A second plan that still proposes
	// paging has answered nothing, and saying so is the point of the route.
	const revised = comments(issue).slice(first.length)
	expect(revised, 'the second plan should take up the date range that was asked for').toMatch(/date range|date filter|from.*to|month/i)
})
