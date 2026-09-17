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
const CHECKSUM = join(LEDGER, 'packages', 'contracts', 'schema', 'run.checksum')

function git(args: string[]): string {
	try {
		return execFileSync('git', args, { cwd: LEDGER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
	} catch (error) {
		const said = error as { stderr?: Buffer | string; stdout?: Buffer | string }
		throw new Error(`git ${args.join(' ')} failed: ${String(said.stderr ?? '')}${String(said.stdout ?? '')}`.trim())
	}
}

const BRANCH = 'gate/stale-checksum'

/**
 * A small pull request of its own, rather than the cross-stack one.
 *
 * Borrowing the factory's pull request meant waiting on a review of nine changed
 * files and a conversation several verdicts deep, which took longer than twenty
 * minutes and timed out twice. A review is as slow as the thing it is reading,
 * and this loop is about the reason a gate gives rather than the size of the
 * diff it gave it about.
 *
 * One line of schema and a checksum nobody recomputed. The gate has exactly one
 * thing to say.
 */
function openTheBreak(): number {
	git(['fetch', '-q', 'origin', 'main'])
	git(['checkout', '-q', '-B', BRANCH, 'origin/main'])

	const schema = join(LEDGER, 'packages', 'contracts', 'schema', 'run.schema.json')
	const parsed = JSON.parse(readFileSync(schema, 'utf8')) as { description?: string }
	parsed.description = `A run, as the ingest service records it. Touched at ${new Date().toISOString()}.`
	writeFileSync(schema, `${JSON.stringify(parsed, null, 2)}\n`)

	// Left stale on purpose. This is the break.
	git(['commit', '-qam', 'Describe the run schema, and forget the checksum'])
	git(['push', '-qf', '-u', 'origin', BRANCH])
	git(['checkout', '-q', 'main'])

	const existing = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--head', BRANCH, '--json', 'number', '--jq', '.[0].number'], { encoding: 'utf8' }).trim()
	if (existing !== '') return Number(existing)

	const url = execFileSync('gh', [
		'pr', 'create', '--repo', REPO, '--head', BRANCH, '--base', 'main',
		'--title', 'Describe the run schema',
		'--body', 'One line of documentation on the shared schema. The checksum beside it was not recomputed, which is the point.',
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
	expect(red, 'the reason should name the check that failed').toMatch(/checksum/i)

	// The pull request, not the board, and scrolled to the verdict. A board shows
	// an item in a column whatever its checks did.
	await page.goto(`https://github.com/${REPO}/pull/${number}`, { waitUntil: 'domcontentloaded' })
	await shotAt(page, 'request changes', 'factory-gate-failed')

	// The second attempt does what the reason said.
	git(['checkout', '-q', BRANCH])
	execFileSync('bun', ['run', 'checksum'], { cwd: join(LEDGER, 'packages', 'contracts') })
	git(['commit', '-qam', 'Recompute the checksum the way the gate said to'])
	git(['push', '-q'])
	git(['checkout', '-q', 'main'])

	const fixedAt = Date.now()
	await announcePush(number, REPO)
	const green = await waitForVerdict(REPO, number, fixedAt, item.id)
	expect(latestVerdict(green), 'the fixed change should clear the gate it failed').toBe('approve')

	await page.goto(`https://github.com/${REPO}/pull/${number}`, { waitUntil: 'domcontentloaded' })
	await shotAt(page, 'approve', 'factory-retry')
})
