/**
 * The cross-stack change: one field, three languages, one schema.
 *
 * `toolCalls` becomes a required integer on the run schema, and after that the
 * TypeScript type, the Go struct tags and the Rust deserialisation all have to
 * agree with it. Nobody can finish this by editing the file the issue mentions,
 * because the schema is the contract and three suites assert against it.
 *
 * This is the route that justifies the ownership graph. `packages/contracts`
 * sits at `propose` precisely because a change there is never local: it reaches
 * every service built against it, so a person accepts the plan before any code
 * is written.
 *
 * What the spec is really watching for is a gate failing in one language and the
 * run coming back from it. A change that lands green on the first attempt has
 * demonstrated nothing about recovery, so the retry is evidence rather than
 * noise, and its absence is worth saying out loud rather than asserting away.
 */

import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { expect, openBoard, showBoard } from '../lib/factory.ts'
import { LEDGER } from '../lib/ledger.ts'
import { advance, decisionsFor, itemForRoute, settle, stageOf, startRun } from '../lib/drive.ts'
import { shot } from '../lib/shot.ts'

const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

function filesOn(branch: string): string {
	const list = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--json', 'number,headRefName'], { encoding: 'utf8' })
	const pull = (JSON.parse(list) as Array<{ number: number; headRefName: string }>).find((p) => p.headRefName === branch)
	if (pull === undefined) throw new Error(`no open pull request on ${branch}`)
	return execFileSync('gh', ['api', `repos/${REPO}/pulls/${pull.number}/files`, '--jq', '.[].filename'], { encoding: 'utf8' })
}

test('a change to the shared schema reaches every language that asserts it', async ({ page }) => {
	test.setTimeout(60 * 60 * 1000)

	await openBoard(page)
	const item = await itemForRoute(LEDGER, 'cross-stack')
	expect(stageOf(item), 'the cross-stack issue should start in intake').toBe('intake')
	const issue = item.metadata.githubIssueNumber as number

	await startRun(item, 'triage', 'factory-triage')
	const triaged = await settle(item.id)
	expect(triaged.decision?.status, 'triage should succeed').toBe('succeeded')

	// contracts is `propose`, so the plan is the thing a person accepts. This is
	// the gate the ownership graph exists to impose.
	const planned = await advance(item.id, 'planning', 'accepted, a contract change needs a plan first')
	expect(planned.decision?.status, 'planning should succeed').toBe('succeeded')

	const built = await advance(item.id, 'execute', 'plan approved')
	await showBoard(page)
	await shot(page, 'factory-gate-failed')
	expect(built.decision?.status, 'the build should succeed, however many attempts it took').toBe('succeeded')

	// Attempts above one mean a gate went red and the run started again from the
	// reason. That is the recovery this route is here to show; when it lands
	// first time there is nothing to photograph and the run sheet says so.
	const work = (await decisionsFor(item.id)).find((decision) => decision.role === 'work')
	if ((work?.attempts ?? 1) > 1) await shot(page, 'factory-retry')

	const files = filesOn(`factory/issue-${issue}`)
	expect(files, 'the schema is the contract, so it changes first').toContain('packages/contracts/schema/run.schema.json')

	// The point of the route: the schema moved, so everything asserting it moved.
	// Naming all three is what makes a one-language change a failure.
	expect(files, 'the TypeScript type must agree with the schema').toContain('packages/contracts/src/index.ts')
	expect(files, 'the Go struct must agree with the schema').toContain('services/ingest/run.go')
})
