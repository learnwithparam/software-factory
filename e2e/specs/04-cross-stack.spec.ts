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
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, openBoard, showBoard } from '../lib/factory.ts'
import { LEDGER } from '../lib/ledger.ts'
import { advance, announcePull, announcePush, itemForRoute, settle, stageOf, startRun, waitForVerdict } from '../lib/drive.ts'
import { shot } from '../lib/shot.ts'

const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

const git = (args: string[]): string => {
	try {
		return execFileSync('git', args, { cwd: LEDGER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
	} catch (error) {
		const said = error as { stderr?: Buffer | string; stdout?: Buffer | string }
		throw new Error(`git ${args.join(' ')} failed: ${String(said.stderr ?? '')}${String(said.stdout ?? '')}`.trim())
	}
}

function pullForIssue(issue: number): { number: number } {
	const out = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--json', 'number,headRefName'], { encoding: 'utf8' })
	const found = (JSON.parse(out) as Array<{ number: number; headRefName: string }>).find((p) => p.headRefName === `factory/issue-${issue}`)
	if (found === undefined) throw new Error(`no open pull request on factory/issue-${issue}`)
	return found
}

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
	expect(built.decision?.status, 'the build should succeed, however many attempts it took').toBe('succeeded')

	// The loop where a check fails and the reason goes back with it, staged the
	// way make prove stages every other gate in this repository: by breaking it on
	// purpose.
	//
	// Hoping the model stumbles does not work, and finding that out is the useful
	// part. The schema carries a checksum precisely so a cross-stack change cannot
	// pass quietly, and the run updated it correctly on its first attempt along
	// with the schema, the TypeScript field list, the Go struct and the console.
	// A competent agent does not fail a check it can discover, so a demonstration
	// that waits for one to fail is a demonstration that does not happen.
	//
	// So the checksum is staled deliberately, on the branch, and the reviewer is
	// asked to look again. The failure is real, its reason is real, and the cause
	// is ours. That is worth saying out loud in the room rather than implying the
	// model tripped.
	const pull = pullForIssue(issue)
	const branch = `factory/issue-${issue}`

	// The pull request has to be on the review board before anyone can ask it to
	// look again, and only a webhook puts it there.
	const review = await announcePull(pull.number, REPO)
	await advance(review.id, 'review', 'read the change across all three languages')

	git(['fetch', '-q', 'origin', branch])
	git(['checkout', '-q', branch])
	writeFileSync(join(LEDGER, 'packages', 'contracts', 'schema', 'run.checksum'), 'staleonpurpose\n')
	git(['commit', '-qam', 'Stale the schema checksum, to watch the gate catch it'])
	git(['push', '-q'])
	git(['checkout', '-q', 'main'])

	const brokenAt = Date.now()
	await announcePush(pull.number, REPO)
	const red = await waitForVerdict(REPO, pull.number, brokenAt, review.id)
	expect(red, 'the reviewer should name the check that failed and what fixes it').toMatch(/checksum/i)
	await showBoard(page)
	await shot(page, 'factory-gate-failed')

	// Second attempt, starting from the reason the gate gave.
	git(['checkout', '-q', branch])
	execFileSync('bun', ['run', 'checksum'], { cwd: join(LEDGER, 'packages', 'contracts') })
	git(['commit', '-qam', 'Rewrite the checksum the way the gate said to'])
	git(['push', '-q'])
	git(['checkout', '-q', 'main'])

	const fixedAt = Date.now()
	await announcePush(pull.number, REPO)
	await waitForVerdict(REPO, pull.number, fixedAt, review.id)
	await showBoard(page)
	await shot(page, 'factory-retry')

	const files = filesOn(branch)
	expect(files, 'the schema is the contract, so it changes first').toContain('packages/contracts/schema/run.schema.json')

	// The point of the route: the schema moved, so everything asserting it moved.
	// Naming all three is what makes a one-language change a failure.
	expect(files, 'the TypeScript type must agree with the schema').toContain('packages/contracts/src/index.ts')
	expect(files, 'the Go struct must agree with the schema').toContain('services/ingest/run.go')
})
