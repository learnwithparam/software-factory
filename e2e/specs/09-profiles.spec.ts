/**
 * One issue, four company shapes, four different answers.
 *
 * This is the session that makes the case for the whole approach. The factory
 * does not change, the model does not change, the issue does not change. What
 * changes is the contract the repository hands it: the charter, the ownership
 * graph, and the two switches on the board.
 *
 * The issue is the one that asks for the spend warning threshold to move, which
 * is one line of Rust on the money path. Under `solo` the money path is `build`,
 * because one person holds every consequence already and reads the diff before
 * merging anyway. Under `enterprise` it is `refuse` and protected as well, so
 * the run stops at the boundary. Neither is the correct answer, and a factory
 * that cannot express both has an opinion about your company.
 *
 * The spec asserts the difference rather than four exact outcomes, because the
 * outcome under a given shape is the model's to decide within the rules. What
 * must hold is that the rules differ and that the permissive shape gets further
 * than the strict one.
 *
 * It puts the repository back in the shape it found it in. Applying a shape is a
 * commit that gets pushed, so without that this spec leaves the ledger in
 * whichever column ran last, and every route after it runs under a contract
 * nobody chose. That happened: the cross-stack route triaged to "await approval"
 * and opened no pull request, because it was running under enterprise, where the
 * contracts target is refuse.
 */

import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, openBoard, showBoard } from '../lib/factory.ts'
import { LEDGER } from '../lib/ledger.ts'
import { itemForRoute, settle, stageOf, startRun } from '../lib/drive.ts'
import { ROOT, shot } from '../lib/shot.ts'

const SHAPES = ['solo', 'startup', 'scaleup', 'enterprise'] as const

/**
 * The picture each shape produces, spelled out.
 *
 * Written as literals so somebody grepping for profile-scaleup finds the line
 * that takes it, and so make status can see the claim before any run has
 * happened rather than only afterwards.
 */
const SHOT = {
	solo: 'profile-solo',
	startup: 'profile-startup',
	scaleup: 'profile-scaleup',
	enterprise: 'profile-enterprise',
} as const

/** The ledger's governance files as this spec found them. */
let found: string | undefined

test.beforeAll(() => {
	found = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: LEDGER, encoding: 'utf8' }).trim()
})

test.afterAll(() => {
	if (found === undefined) return
	const git = (args: string[]) => execFileSync('git', args, { cwd: LEDGER, encoding: 'utf8' })
	git(['checkout', found, '--', '.factory/charter.md', '.factory/targets.json'])
	if (execFileSync('git', ['status', '--porcelain', '.factory'], { cwd: LEDGER, encoding: 'utf8' }).trim() === '') return
	git(['add', '.factory/charter.md', '.factory/targets.json'])
	git(['commit', '-q', '-m', 'Put the shape back the way the profiles spec found it'])
	git(['push', '-q', 'origin', 'HEAD'])
})
const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

function autoStarts(shape: string): boolean {
	const file = join(ROOT, 'profiles', shape, 'board.json')
	return (JSON.parse(readFileSync(file, 'utf8')) as { autoRunEnabled: boolean }).autoRunEnabled
}

function autonomyFor(shape: string, target: string): string {
	const file = join(ROOT, 'profiles', shape, 'targets.json')
	const graph = JSON.parse(readFileSync(file, 'utf8')) as { targets: Record<string, { autonomy: string }> }
	const found = graph.targets[target]?.autonomy
	if (found === undefined) throw new Error(`${shape} does not claim ${target}`)
	return found
}

function run(command: string, args: string[]): string {
	return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
}

test('the four shapes disagree about the money path, and say so in writing', async () => {
	// Cheap and offline, and it is the claim the session opens on. If these four
	// agree there is nothing to demonstrate.
	const levels = SHAPES.map((shape) => autonomyFor(shape, 'budget'))
	expect(levels, 'the four shapes should not all treat the money path alike').toEqual([
		'build',
		'propose',
		'refuse',
		'refuse',
	])

	// enterprise differs from scaleup by protecting the path as well, so its run
	// stops before a plan exists rather than after one.
	const enterprise = readFileSync(join(ROOT, 'profiles', 'enterprise', 'charter.md'), 'utf8')
	const scaleup = readFileSync(join(ROOT, 'profiles', 'scaleup', 'charter.md'), 'utf8')
	expect(enterprise, 'enterprise protects the money path outright').toContain('services/budget/**')
	expect(scaleup, 'scaleup refuses it without protecting it').not.toContain('services/budget/**')
})

for (const shape of SHAPES) {
	test(`the money item under a ${shape} shape`, async ({ page }) => {
		test.setTimeout(25 * 60 * 1000)

		run('make', ['profile', `NAME=${shape}`])
		run('make', ['lab-reset'])

		await openBoard(page)
		let item = await itemForRoute(LEDGER, 'refused')

		// Under solo the run has already begun by the time anybody looks, because
		// that shape turns auto-start on. Asserting every shape starts in intake
		// failed on exactly the behaviour this session exists to demonstrate, which
		// is a test disagreeing with the thing it is testing.
		if (autoStarts(shape)) {
			const deadline = Date.now() + 3 * 60 * 1000
			while (stageOf(item) === 'intake' && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 5_000))
				item = await itemForRoute(LEDGER, 'refused')
			}
			expect(stageOf(item), `${shape} turns auto-start on, so nobody should have to start this`).not.toBe('intake')
		} else {
			expect(stageOf(item), `${shape} leaves auto-start off, so the item waits for a person`).toBe('intake')
			await startRun(item, 'triage', 'factory-triage')
		}

		const triaged = await settle(item.id)
		expect(triaged.decision?.status, 'triage should complete under every shape').toBe('succeeded')

		await showBoard(page)
		await shot(page, SHOT[shape])

		// The money path is never written by an agent under any shape, because
		// nothing merges unattended on any tier. What differs is how far the run
		// gets before a person is needed, and that is what the screenshots show.
		//
		// This issue's branch, not any factory branch. The first version asked
		// whether the repository contained one at all and failed on factory/issue-70,
		// left behind by a run whose pull request was never opened, weeks of issue
		// numbers ago.
		const issue = item.metadata.githubIssueNumber as number
		const branches = run('gh', ['api', `repos/${REPO}/branches`, '--jq', '.[].name'])
		expect(branches, `${shape} should not have landed a branch for issue ${issue} during triage`)
			.not.toContain(`factory/issue-${issue}`)
	})
}
