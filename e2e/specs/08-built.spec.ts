/**
 * The layers built by hand, doing the things the sessions claim they do.
 *
 * Every command here runs for real against the example repository, and the
 * screenshots are its actual output. Sessions one to five demonstrate these
 * before showing the same behaviour inside the running Factory, so this spec is
 * what proves the first half of each of those sessions is not a story.
 */

import { expect, test } from '@playwright/test'
import { ROOT, run, shotTerminal } from '../lib/shot.ts'

const REPO = process.env.FACTORY_REPO ?? '../ledger'
const demo = (step: string, args = '') => run(`FACTORY_REPO=${REPO} bun steps/${step}/demo.ts ${args}`, ROOT)

test('the boundary refuses the money path before any file is touched', async ({ page }) => {
	const ran = demo('01-boundary', 'capacity')
	expect(ran.output).toContain('VERDICT: REFUSED')
	expect(ran.output).toMatch(/protected: services\/budget/)
	// The refusal happens before work starts, which is the whole claim.
	expect(ran.output).toContain('awaiting review')
	await shotTerminal(page, 'built-charter-refusal', ran, 'The review queue filling up, and the one path a run will not take.')
})

test('a task gets a workspace and the repository is left alone', async ({ page }) => {
	const ran = demo('02-execution', 'selftest')
	expect(ran.exitCode).toBe(0)
	expect(ran.output).toContain('the repository is unchanged while the task writes')
	expect(ran.output).toContain('the workspace is outside the repository')
	await shotTerminal(page, 'built-worktree', ran, 'A workspace created, written to, and removed, with the repository untouched throughout.')
})

test('two runs claim one item and only the first wins', async ({ page }) => {
	const ran = demo('02-execution', 'race 142')
	expect(ran.exitCode).toBe(0)
	expect(ran.output).toContain('VERDICT: PASS')
	expect(ran.output).toMatch(/rejected/)
	await shotTerminal(page, 'built-claim-race', ran, 'Both runs computed the same branch name. The remote decided which one owns the work.')
})

test('the gate ends in one line, and says so when a check is missing', async ({ page }) => {
	const ran = demo('04-verification', 'gate')
	expect(ran.output).toContain('VERDICT: PASS')
	expect(ran.output).toContain('VERDICT: MISCONFIGURED')
	await shotTerminal(page, 'built-gate-verdict', ran, 'A passing gate, then the same gate with its test command removed: neither a pass nor a failure.')
})

test('a test is shown to fail without the change it covers', async ({ page }) => {
	const good = demo('04-verification', 'negative-proof')
	expect(good.exitCode).toBe(0)
	expect(good.output).toContain('VERDICT: PASS')

	const toothless = demo('04-verification', 'negative-proof --toothless')
	expect(toothless.exitCode).toBe(1)
	expect(toothless.output).toContain('still green without the change')

	await shotTerminal(page, 'built-negative-proof', toothless, 'A test that passes whether or not the fix is present. The suite is green and proves nothing.')
})

test('the reviewer is given the diff and not the story', async ({ page }) => {
	const ran = demo('04-verification', 'verify')
	expect(ran.output).toContain('the account of how the work went')
	expect(ran.output).toContain('VERDICT: FAIL')
	await shotTerminal(page, 'built-cold-review', ran, 'What the reviewer receives, what it is deliberately denied, and what it found anyway.')
})

test('a failure comes back with its reason and the next attempt uses it', async ({ page }) => {
	const ran = demo('05-loop', 'run 1')
	expect(ran.exitCode).toBe(0)
	expect(ran.output).toContain('Do not begin again')
	expect(ran.output).toContain('VERDICT: PASS')
	await shotTerminal(page, 'built-loop-recovery', ran, 'The packet handed back after a failed check, and the second attempt passing because of it.')
})
