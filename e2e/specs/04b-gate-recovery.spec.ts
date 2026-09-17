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
 * the cause is ours. The run sheet says so rather than implying the model
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

const BRANCH = 'gate/threshold-moved'

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
 */
function openTheBreak(): number {
	git(['fetch', '-q', 'origin', 'main'])
	git(['checkout', '-q', '-B', BRANCH, 'origin/main'])

	// Move the warning threshold, which the budget tests assert exactly. The path
	// is protected, so the reviewer can read the failure and not repair it.
	const money = MONEY
	writeFileSync(money, readFileSync(money, 'utf8').replace('const WARNING_PERCENT: i64 = 80;', 'const WARNING_PERCENT: i64 = 70;'))

	git(['commit', '-qam', 'Warn at seventy percent instead of eighty'])
	git(['push', '-qf', '-u', 'origin', BRANCH])
	git(['checkout', '-q', 'main'])

	const existing = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--head', BRANCH, '--json', 'number', '--jq', '.[0].number'], { encoding: 'utf8' }).trim()
	if (existing !== '') return Number(existing)

	const url = execFileSync('gh', [
		'pr', 'create', '--repo', REPO, '--head', BRANCH, '--base', 'main',
		'--title', 'Warn earlier when spend is heading for the limit',
		'--body', 'Moves the warning threshold from eighty percent to seventy. The budget tests assert eighty exactly, so this fails them, and the money path is protected so nobody but a person may fix it.',
	], { encoding: 'utf8' }).trim()
	return Number(url.split('/').pop())
}

test('a stale check sends the change back, and the second attempt clears it', async ({ page }) => {
	test.setTimeout(45 * 60 * 1000)

	await openBoard(page)
	const number = openTheBreak()

	const item = await announcePull(number, REPO)
	const openedAt = Date.now()
	await advance(item.id, 'review', 'read a change that forgot its checksum')

	const red = await waitForVerdict(REPO, number, openedAt, item.id)
	expect(latestVerdict(red), 'a stale checksum should send the change back').toBe('changes')
	expect(red, 'the reason should name the suite that failed').toMatch(/budget|cargo|warning|threshold/i)

	// The pull request, not the board, and scrolled to the verdict. A board shows
	// an item in a column whatever its checks did.
	await page.goto(`https://github.com/${REPO}/pull/${number}`, { waitUntil: 'domcontentloaded' })
	await shotAt(page, 'request changes', 'factory-gate-failed')

	// The second attempt does what the reason said: a person, who may touch the
	// money path, puts the threshold back.
	git(['checkout', '-q', BRANCH])
	writeFileSync(MONEY, readFileSync(MONEY, 'utf8').replace('const WARNING_PERCENT: i64 = 70;', 'const WARNING_PERCENT: i64 = 80;'))
	git(['commit', '-qam', 'Put the threshold back, the way the review asked'])
	git(['push', '-q'])
	git(['checkout', '-q', 'main'])

	const fixedAt = Date.now()
	await announcePush(number, REPO)
	const green = await waitForVerdict(REPO, number, fixedAt, item.id)
	expect(latestVerdict(green), 'the fixed change should clear the gate it failed').toBe('approve')

	await page.goto(`https://github.com/${REPO}/pull/${number}`, { waitUntil: 'domcontentloaded' })
	await shotAt(page, 'approve', 'factory-retry')
})
