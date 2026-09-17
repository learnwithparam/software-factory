/**
 * The question: an issue that does not say enough to build from.
 *
 * The issue asks for a cost-per-thousand-tokens rate, which does not exist, and
 * says nothing about where it should be computed. That matters here more than it
 * would elsewhere: `apps/console/lib/ledger.ts` opens by saying the console owns
 * no numbers and that the view is never the resolver. So the obvious
 * implementation, a division inside page.tsx, is the one the repository forbids,
 * and the issue never says which service should own the new figure.
 *
 * This is the hardest route to demonstrate honestly, because a model that asks
 * no question is not obviously broken, it is just guessing. What the spec can
 * check is that the work stopped somewhere a person can answer, rather than a
 * pull request appearing that quietly invented a number.
 *
 * The first version of this issue asked for a cost column that already existed,
 * and the run went and proved it existed, with line numbers and five real
 * currency values. That was the right answer to the wrong question, and the
 * issue was the thing that had to change.
 */

import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { expect, openBoard, showBoard } from '../lib/factory.ts'
import { LEDGER } from '../lib/ledger.ts'
import { advance, itemForRoute, settle, stageOf, startRun } from '../lib/drive.ts'
import { shot } from '../lib/shot.ts'

const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

function comments(issue: number): string {
	return execFileSync('gh', ['api', `repos/${REPO}/issues/${issue}/comments`, '--jq', '.[].body'], { encoding: 'utf8' })
}

test('an underspecified issue is asked about rather than guessed at', async ({ page }) => {
	test.setTimeout(30 * 60 * 1000)

	await openBoard(page)
	const item = await itemForRoute(LEDGER, 'question')
	expect(stageOf(item), 'the question issue should start in intake').toBe('intake')
	const issue = item.metadata.githubIssueNumber as number

	await startRun(item, 'triage', 'factory-triage')
	const triaged = await settle(item.id)
	expect(triaged.decision?.status, 'triage should succeed').toBe('succeeded')

	const planned = await advance(item.id, 'planning', 'accepted, to see what it asks')
	expect(planned.decision?.status, 'planning should succeed').toBe('succeeded')

	await showBoard(page)
	await shot(page, 'factory-question')

	// The claim: the ambiguity was surfaced, not resolved by assumption. Either
	// the run asked outright, or it wrote down the assumption it made, and both
	// leave a person able to correct it. Silence is the failure.
	const said = comments(issue).toLowerCase()
	const surfaced = /\?|assum|unclear|ambigu|open question|which\b/.test(said)
	expect(surfaced, `nothing on issue #${issue} names the decision the issue left open`).toBe(true)

	// And that it did not invent the number by shipping one.
	const pulls = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--json', 'headRefName', '--jq', '.[].headRefName'], { encoding: 'utf8' })
	expect(pulls, 'an unanswered question should not have produced a pull request').not.toContain(`factory/issue-${issue}`)

	// Answering it is a person's move, and the work resumes from the answer.
	execFileSync('gh', [
		'issue', 'comment', String(issue), '--repo', REPO,
		'--body', 'Compute it in the ingest service, which owns runs, and put it on the run alongside costMinor. The console renders it and derives nothing, the way ledger.ts says.',
	])

	const resumed = await advance(item.id, 'execute', 'question answered, build it')
	expect(resumed.decision?.status, 'the build should succeed once the question is answered').toBe('succeeded')

	await showBoard(page)
	await shot(page, 'factory-answered')
})
