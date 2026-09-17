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
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, openBoard, showBoard } from '../lib/factory.ts'
import { LEDGER } from '../lib/ledger.ts'
import { advance, announcePull, announcePush, itemForPull, latestVerdict, reviewText, stageOf, waitForVerdict } from '../lib/drive.ts'
import { shot } from '../lib/shot.ts'

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

/** The factory's own pull request, which is the one carrying a schema change. */
function factoryPull(): { number: number; headRefName: string } {
	const out = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'open', '--json', 'number,headRefName'], { encoding: 'utf8' })
	const found = (JSON.parse(out) as Array<{ number: number; headRefName: string }>).find((p) => p.headRefName.startsWith('factory/issue-'))
	if (found === undefined) throw new Error('no factory pull request is open; run 04-cross-stack first')
	return found
}

test('a stale check sends the change back, and the second attempt clears it', async ({ page }) => {
	test.setTimeout(45 * 60 * 1000)

	await openBoard(page)
	const pull = factoryPull()

	// On the review board, because that is where a pull request is judged.
	let item = await itemForPull(pull.number).catch(() => announcePull(pull.number, REPO))
	if (stageOf(item) !== 'review') item = (await advance(item.id, 'review', 'read it once before anything is broken')).item

	git(['fetch', '-q', 'origin', pull.headRefName])
	git(['checkout', '-q', pull.headRefName])

	// Idempotent, because a run that staled the checksum and then failed to read
	// the verdict leaves the branch already broken, and git answers "nothing to
	// commit" to a second identical break. The value carries the moment so there
	// is always something to push, and a branch that is already stale is a state
	// to continue from rather than an error.
	const alreadyRed = latestVerdict(reviewText(REPO, pull.number)) === 'changes'
	writeFileSync(CHECKSUM, `stale-${Date.now()}\n`)
	git(['commit', '-qam', 'Stale the schema checksum, to watch the gate catch it'])
	git(['push', '-q'])
	git(['checkout', '-q', 'main'])

	const brokenAt = Date.now()
	await announcePush(pull.number, REPO)
	const red = alreadyRed
		? reviewText(REPO, pull.number)
		: await waitForVerdict(REPO, pull.number, brokenAt, item.id)

	// The claim of this loop: the failure travels with its reason. A verdict that
	// says no without naming the check leaves the next attempt guessing.
	expect(latestVerdict(red), 'a stale checksum should send the change back').toBe('changes')
	expect(red, 'the reason should name the check that failed').toMatch(/checksum/i)
	await showBoard(page)
	await shot(page, 'factory-gate-failed')

	// The second attempt does what the reason said.
	git(['checkout', '-q', pull.headRefName])
	execFileSync('bun', ['run', 'checksum'], { cwd: join(LEDGER, 'packages', 'contracts') })
	git(['commit', '-qam', 'Rewrite the checksum the way the gate said to'])
	git(['push', '-q'])
	git(['checkout', '-q', 'main'])

	const fixedAt = Date.now()
	await announcePush(pull.number, REPO)
	const green = await waitForVerdict(REPO, pull.number, fixedAt, item.id)
	expect(latestVerdict(green), 'the fixed change should clear the gate it failed').toBe('approve')

	await showBoard(page)
	await shot(page, 'factory-retry')

	expect(reviewText(REPO, pull.number), 'both passes stay on the record').toMatch(/checksum/i)
})
