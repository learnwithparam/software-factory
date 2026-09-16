/**
 * The bug: a defect with a reproduction, which needs less ceremony than a
 * feature does.
 *
 * `GET /runs?limit=0` answers 400 where it should answer 200 with an empty list.
 * The issue states the reproduction, the expected answer, and the two cases that
 * must keep failing, so there is nothing to decide and nothing to design. That
 * is what makes a fast track defensible: not that bugs are urgent, but that a
 * bug with a reproduction has already had its planning done by whoever wrote it.
 *
 * `services/ingest` sits at `build` in the ownership graph, because wrong data
 * there is visible and recoverable. So this is the route where the factory is
 * allowed to go from issue to pull request without a person in the middle, and
 * the contrast with route five is the whole lesson.
 */

import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { expect, openBoard } from '../lib/factory.ts'
import { LEDGER } from '../lib/ledger.ts'
import { advance, itemForRoute, settle, stageOf, startRun } from '../lib/drive.ts'
import { shot } from '../lib/shot.ts'

const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

/** What triage may call a reproducible defect and still be right. */
const DEFENSIBLE_FOR_A_BUG = ['bug']

test('a bug with a reproduction goes straight to work', async ({ page }) => {
	test.setTimeout(45 * 60 * 1000)

	await openBoard(page)
	const item = await itemForRoute(LEDGER, 'bug')
	expect(stageOf(item), 'the bug should start in intake').toBe('intake')

	await startRun(item, 'triage', 'factory-triage')
	const triaged = await settle(item.id)
	expect(triaged.decision?.status, 'triage should succeed').toBe('succeeded')

	// The one classification this route depends on. A reproduction, an expected
	// answer and two cases that must keep failing is a bug by any reading, and if
	// triage calls it a feature request the fast track is not justified.
	expect(DEFENSIBLE_FOR_A_BUG, `a reproducible defect classified as ${triaged.item.triageType}`)
		.toContain(triaged.item.triageType)
	await page.reload({ waitUntil: 'domcontentloaded' })
	await shot(page, 'factory-bug-triage')

	const planned = await advance(item.id, 'planning', 'accepted, the reproduction is the plan')
	expect(planned.decision?.status, 'planning should succeed').toBe('succeeded')

	const built = await advance(item.id, 'execute', 'plan approved')
	expect(built.decision?.status, 'the build should succeed').toBe('succeeded')

	const issue = built.item.metadata.githubIssueNumber as number
	const pulls = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--json', 'number,headRefName'], { encoding: 'utf8' })
	expect(pulls, 'the run should have opened a pull request for this issue').toContain(`factory/issue-${issue}`)

	// The claim the issue actually made. A fix that does not touch the handler it
	// named, or that lands without a test, has not done what was asked.
	const files = execFileSync('gh', ['api', `repos/${REPO}/pulls/${JSON.parse(pulls).find((p: { headRefName: string }) => p.headRefName === `factory/issue-${issue}`).number}/files`, '--jq', '.[].filename'], { encoding: 'utf8' })
	expect(files, 'the fix should be in the handler the issue named').toContain('services/ingest/http.go')
	expect(files, 'a bug fix arrives with the test that would have caught it').toContain('services/ingest/http_test.go')
})
