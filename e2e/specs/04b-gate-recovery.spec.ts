/**
 * A check fails, the reason goes back with it, and the second attempt uses it.
 *
 * This is the second of the three feedback loops the lifecycle diagram declares,
 * and the only one that cannot be produced by waiting. The schema carries a
 * checksum precisely so a cross-stack change cannot pass quietly, and a
 * competent run updates it on the first attempt along with everything else. Five
 * runs did exactly that. A demonstration that waits for a good agent to trip is
 * a demonstration that does not happen.
 *
 * So the gate is broken deliberately, the way `make prove` breaks every other
 * gate in this repository. The failure is real, the reason it gives is real, and
 * the cause is ours. The guide says so rather than implying the model
 * stumbled, because teaching that agents are unreliable when the evidence says
 * otherwise is the wrong lesson.
 *
 * It runs against whichever pull request is open rather than building one.
 * Rebuilding a fifteen minute change to photograph a ten second checksum failure
 * is how a measured loop turns into something nobody waits for.
 */

import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, openBoard } from '../lib/factory.ts'
import { LEDGER } from '../lib/ledger.ts'
import { advance, announcePull, announcePush, latestVerdict, waitForVerdict } from '../lib/drive.ts'
import { shotAt } from '../lib/shot.ts'

const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'
const MONEY = join(LEDGER, 'services', 'budget', 'src', 'lib.rs')

function git(args: string[]): string {
	try {
		return execFileSync('git', args, { cwd: LEDGER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
	} catch (error) {
		const said = error as { stderr?: Buffer | string; stdout?: Buffer | string }
		throw new Error(`git ${args.join(' ')} failed: ${String(said.stderr ?? '')}${String(said.stdout ?? '')}`.trim())
	}
}

const BRANCH = 'gate/remaining-clamped'

/**
 * A small pull request of its own, rather than the cross-stack one.
 *
 * Borrowing the factory's pull request meant waiting on a review of nine changed
 * files and a conversation several verdicts deep, which took longer than twenty
 * minutes and timed out twice. A review is as slow as the thing it is reading,
 * and this loop is about the reason a gate gives rather than the size of the
 * diff it gave it about.
 *
 * The break has to be one the reviewer cannot repair. A stale checksum was the
 * obvious choice and the wrong one: the review found it, ran `bun run checksum`,
 * committed the fix and approved, because the skill treats a mechanical fix as
 * its own work rather than homework for the author. That is good behaviour and
 * it makes a mechanically fixable break useless for demonstrating a rejection.
 *
 * So the break is on the money path. `services/budget/**` is in the charter's
 * protected block, the reviewer may not edit it, and the failing test can only
 * go back to a person. The ownership graph decides what a reviewer may repair,
 * not only what an agent may build, and that is worth a slide of its own.
 *
 * The second wrong break was moving the warning threshold, and the pull request
 * body explained that the tests asserting eighty would fail. The review read
 * that, matched it to the issue which asks for exactly that change, and approved
 * with the failures marked expected. It was right to. A break that announces
 * itself as intentional is authorised, not broken.
 *
 * So this one looks like a tidy-up and quietly violates the invariant the money
 * path exists to hold: spent plus remaining equals the limit. Nobody authorises
 * that, no issue asks for it, and the reviewer may not repair it.
 */
function openTheBreak(): number {
	git(['fetch', '-q', 'origin', 'main'])
	git(['checkout', '-q', '-B', BRANCH, 'origin/main'])

	// Break the invariant the money path exists to hold, in the shape of a tidy
	// up. Remaining is no longer what is left.
	writeFileSync(MONEY, readFileSync(MONEY, 'utf8').replace(
		'remaining_minor: limit_minor - spent_minor,',
		'remaining_minor: (limit_minor - spent_minor).max(0),',
	))

	git(['commit', '-qam', 'Never report a negative remaining balance'])
	git(['push', '-qf', '-u', 'origin', BRANCH])
	git(['checkout', '-q', 'main'])

	const existing = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--head', BRANCH, '--json', 'number', '--jq', '.[0].number'], { encoding: 'utf8' }).trim()
	if (existing !== '') return Number(existing)

	const url = execFileSync('gh', [
		'pr', 'create', '--repo', REPO, '--head', BRANCH, '--base', 'main',
		'--title', 'Never report a negative remaining balance',
		'--body', 'A run that overspends currently reports a negative remaining figure, which reads badly in the console. Clamps it at zero.',
	], { encoding: 'utf8' }).trim()
	return Number(url.split('/').pop())
}

test('a broken invariant sends the change back, and the second attempt clears it', async ({ page }) => {
	test.setTimeout(45 * 60 * 1000)

	await openBoard(page)
	const number = openTheBreak()

	const item = await announcePull(number, REPO)
	const openedAt = Date.now()
	await advance(item.id, 'review', 'read a change that forgot its checksum')

	const red = await waitForVerdict(REPO, number, openedAt, item.id)
	expect(latestVerdict(red), 'a broken money invariant should send the change back').toBe('changes')
	expect(red, 'the reason should name the invariant that broke').toMatch(/invariant|remaining|spent|budget/i)

	// The pull request, not the board, and scrolled to the verdict. A board shows
	// an item in a column whatever its checks did.
	await page.goto(`https://github.com/${REPO}/pull/${number}`, { waitUntil: 'domcontentloaded' })
	await shotAt(page, 'request changes', 'factory-gate-failed')

	// The second attempt does what the reason said, and keeps the thing the change
	// was for. Reverting to nothing is not a fix: the first go at this left an
	// empty pull request, and the re-review rightly answered that there was no
	// longer any code change to evaluate.
	//
	// So the invariant goes back into the money path and the clamp moves to the
	// console, which is where a display concern belongs. That is the answer a
	// person gives when a reviewer says the layer is wrong.
	git(['checkout', '-q', BRANCH])
	writeFileSync(MONEY, readFileSync(MONEY, 'utf8').replace(
		'remaining_minor: (limit_minor - spent_minor).max(0),',
		'remaining_minor: limit_minor - spent_minor,',
	))
	const console_ = join(LEDGER, 'apps', 'console', 'app', 'page.tsx')
	writeFileSync(console_, readFileSync(console_, 'utf8').replace(
		'? `${formatMinor(budget.budget.remainingMinor, budget.budget.currency)} remaining`',
		'? `${formatMinor(Math.max(0, budget.budget.remainingMinor), budget.budget.currency)} remaining`',
	))
	git(['commit', '-qam', 'Clamp the remaining figure where it is displayed, not where it is computed'])
	git(['push', '-q'])
	git(['checkout', '-q', 'main'])

	const fixedAt = Date.now()
	await announcePush(number, REPO)
	const green = await waitForVerdict(REPO, number, fixedAt, item.id)
	expect(latestVerdict(green), 'the fixed change should clear the gate it failed').toBe('approve')

	await page.goto(`https://github.com/${REPO}/pull/${number}`, { waitUntil: 'domcontentloaded' })
	await shotAt(page, 'approve', 'factory-retry')
})
