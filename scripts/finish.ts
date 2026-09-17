/**
 * Close the gap between what the manifest promises and what exists, by running
 * only the part that is missing.
 *
 * `make e2e` runs every route and costs around forty minutes of real model
 * spend. Most of the time what is missing is two screenshots from one spec, and
 * re-running the other eight to get them is how a measured loop turns into a
 * ritual nobody waits for.
 *
 * So this reads the same deliverables `make status` reads, works out which specs
 * produce the missing ones, and runs exactly those. Then it re-measures, and
 * stops the moment a round stops making progress rather than grinding on a
 * thing it cannot fix.
 *
 * What it will not do is author anything. A missing diagram or an unwritten run
 * sheet is work for a person, and a loop that pretends otherwise produces filler
 * to make a number go up. Those are reported and left alone.
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { deliverables, manifest, type Deliverable } from './status.ts'
import { allowed, failed, note, step, table, title, verdict, waiting } from '../steps/lib/out.ts'
import { ROOT } from './tree-hash.ts'
import { runningElsewhere } from './lib/one-run.ts'

const MAX_ROUNDS = Number(process.env.FINISH_ROUNDS ?? 3)

/** Which spec produces a screenshot, from the manifest that names it. */
function specFor(name: string): string | undefined {
	return manifest().screenshots.find((shot) => shot.name === name)?.spec
}

interface Gap {
	readonly runnable: Map<string, string[]>
	readonly authored: Deliverable[]
}

/** Split what is missing into what a run can produce and what a person must write. */
function gap(): Gap {
	const runnable = new Map<string, string[]>()
	const authored: Deliverable[] = []

	for (const entry of deliverables()) {
		if (entry.done) continue
		if (entry.group !== 'screenshot') {
			authored.push(entry)
			continue
		}
		const spec = specFor(entry.name)
		if (spec === undefined) {
			authored.push(entry)
			continue
		}
		runnable.set(spec, [...(runnable.get(spec) ?? []), entry.name])
	}
	return { runnable, authored }
}

function run(command: string, args: string[], cwd = ROOT): boolean {
	const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
	return result.status === 0
}

const delivered = (): number => deliverables().filter((entry) => entry.done).length
const total = (): number => deliverables().length

title('Finishing what the manifest still promises')

const others = runningElsewhere()
if (others.length > 0) {
	failed(`a Playwright run is already going, as ${others.join(', ')}`)
	verdict('MISCONFIGURED', 'Two at once delete each other\'s traces. Wait for it to finish.')
	process.exit(1)
}

let before = delivered()
step(`delivered ${before} of ${total()}`)

for (let round = 1; round <= MAX_ROUNDS; round += 1) {
	const { runnable, authored } = gap()

	if (runnable.size === 0) {
		if (authored.length === 0) break
		waiting(`${authored.length} deliverable(s) need writing rather than running`)
		break
	}

	title(`Round ${round}`)
	table(
		['spec', 'missing'],
		[...runnable].map(([spec, names]) => [spec, names.join(', ')]),
	)

	// One reset for the round, not one per spec: the routes share a board and
	// resetting between them throws away the work the last one just did.
	if (!run('make', ['lab-reset'])) {
		failed('lab-reset did not finish')
		verdict('FAIL', 'The board is not in a known state, so nothing below would mean anything.')
		process.exit(1)
	}

	const specs = [...runnable.keys()].sort().map((spec) => `specs/${spec}.spec.ts`)
	run('bun', ['x', 'playwright', 'test', ...specs, '--reporter=list'], join(ROOT, 'e2e'))

	// Evidence is worth regenerating even when a spec failed, because a run that
	// got halfway still produced half the pictures.
	run('bun', ['scripts/run-report.ts'])
	run('bun', ['scripts/waterfall.ts'])
	run('bun', ['scripts/review-page.ts'])

	const after = delivered()
	if (after > before) allowed(`delivered ${before} to ${after} of ${total()}`)
	else {
		waiting(`still ${after} of ${total()}: that round changed nothing`)
		note('Running it again would change nothing either. What is left needs a person.')
		before = after
		break
	}
	before = after
}

const { runnable, authored } = gap()
const done = delivered()
const all = total()

if (done === all) {
	verdict('PASS', `Delivered ${done} of ${all}. make score measures whether it is proven.`)
	process.exit(0)
}

title('What is still missing')
table(
	['group', 'name', 'why'],
	[
		...[...runnable].flatMap(([spec, names]) => names.map((name) => ['screenshot', name, `${spec} ran and did not produce it`])),
		...authored.map((entry) => [entry.group, entry.name, entry.detail]),
	],
)
verdict('NEEDS REVIEW', `Delivered ${done} of ${all}. The rest is named above rather than counted.`)
process.exit(1)
