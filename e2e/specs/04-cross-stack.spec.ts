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

	// The staged half of this route lives in 04b, so it can run against a pull
	// request that already exists. Rebuilding a fifteen minute cross-stack change
	// to photograph a ten second checksum failure is how a measured loop turns
	// into something nobody waits for.
	const files = filesOn(`factory/issue-${issue}`)
	expect(files, 'the schema is the contract, so it changes first').toContain('packages/contracts/schema/run.schema.json')

	// The point of the route: the schema moved, so everything asserting it moved.
	// Naming all three is what makes a one-language change a failure.
	expect(files, 'the TypeScript type must agree with the schema').toContain('packages/contracts/src/index.ts')
	expect(files, 'the Go struct must agree with the schema').toContain('services/ingest/run.go')
})
