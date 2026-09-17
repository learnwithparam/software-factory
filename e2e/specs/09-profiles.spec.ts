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
const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

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
		const item = await itemForRoute(LEDGER, 'refused')
		expect(stageOf(item), 'every shape starts the same way').toBe('intake')

		await startRun(item, 'triage', 'factory-triage')
		const triaged = await settle(item.id)
		expect(triaged.decision?.status, 'triage should complete under every shape').toBe('succeeded')

		await showBoard(page)
		await shot(page, `profile-${shape}`)

		// The money path is never written by an agent under any shape, because
		// nothing merges unattended on any tier. What differs is how far the run
		// gets before a person is needed, and that is what the screenshots show.
		const branches = run('gh', ['api', `repos/${REPO}/branches`, '--jq', '.[].name'])
		expect(branches, `${shape} should not have landed a branch during triage`).not.toContain('factory/issue-')
	})
}
