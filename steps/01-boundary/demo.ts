/**
 * Step one on stage: what may be attempted, and what stops production.
 *
 * `graph`         who owns which paths, and what happens to a path nobody owns
 * `capacity`      the review queue cap refusing to start more work
 * `lint-charter`  check a charter, yours or this one, for the parts a run reads
 */

import { existsSync } from 'node:fs'
import { EM_DASH, allowed, failed, note, refused, step, table, title, verdict } from '../lib/out.ts'
import { loadGraph, reach, reachAll } from '../lib/graph.ts'
import { CHARTER, decide, loadCharter, mayStart } from './policy.ts'

function showGraph(): number {
	const targets = loadGraph()

	title('Who owns what')
	table(
		['target', 'autonomy', 'depends on', 'paths'],
		targets.map((target) => [
			target.name,
			target.autonomy,
			target.dependsOn.join(', ') || EM_DASH,
			target.paths.join(' '),
		]),
	)

	title('What a change reaches')
	for (const [label, path] of [
		['a console change', 'apps/console/app/page.tsx'],
		['an ingest change', 'services/ingest/http.go'],
		['a shared contract change', 'packages/contracts/schema/run.schema.json'],
	] as const) {
		step(`${label} affects ${reach([path]).targets.map((t) => t.name).join(', ')}`)
	}
	note('One edited definition reaches three services. A file to target mapping would run one suite and ship a break.')

	title('Every path has an owner')
	const everything = reachAll()
	if (everything.unowned.length > 0) {
		for (const orphan of everything.unowned.slice(0, 10)) {
			failed(`${orphan} is owned by no target, so nothing declares its checks or its autonomy`)
		}
		verdict('FAIL', `${everything.unowned.length} of ${everything.paths.length} files have no owner.`)
		return 1
	}
	allowed(`all ${everything.paths.length} files are claimed by a target`)
	verdict('PASS', 'The graph accounts for the whole codebase.')
	return 0
}

function showCapacity(): number {
	const charter = loadCharter()

	title(`Back-pressure: the cap is ${charter.reviewQueueCap}`)
	for (let queue = charter.reviewQueueCap - 2; queue <= charter.reviewQueueCap; queue += 1) {
		const decision = mayStart(queue)
		if (decision.allowed) allowed(`${queue} awaiting review, work may start`)
		else refused(`${queue} awaiting review, ${decision.reason}`)
	}
	note('The binding constraint is how many decisions wait on a person, not how many agents can run.')

	title('And the path that is never touched')
	const decision = decide({
		item: 'tier-discount-rounding',
		paths: ['target/services/budget/src/lib.rs'],
	})
	if (decision.allowed) {
		failed('the money path was permitted, which means the charter is not being read')
		verdict('FAIL', 'A protected path allowed a change.')
		return 1
	}
	refused(decision.rule)
	note(decision.reason)
	verdict('REFUSED', 'Stopping here is the successful outcome.')
	return 0
}

function lintCharter(path: string): number {
	title(`Reading ${path}`)
	if (!existsSync(path)) {
		failed('no file there')
		verdict('MISCONFIGURED', 'A charter that is not present cannot refuse anything.')
		return 2
	}
	try {
		const charter = loadCharter(path)
		allowed(`tier is ${charter.tier}`)
		allowed(`review queue cap is ${charter.reviewQueueCap}`)
		allowed(`${charter.protectedPaths.length} protected paths, each carrying a reason`)
		for (const entry of charter.protectedPaths) note(`${entry.glob}  ${entry.reason}`)
		verdict('PASS', 'Every part a run reads is present.')
		return 0
	} catch (error) {
		failed(error instanceof Error ? error.message : String(error))
		verdict('MISCONFIGURED', 'A charter that cannot be parsed refuses every task.')
		return 2
	}
}

const [command = 'graph', argument] = process.argv.slice(2)

const commands: Record<string, () => number> = {
	graph: showGraph,
	capacity: showCapacity,
	'lint-charter': () => lintCharter(argument ?? CHARTER),
}

const chosen = commands[command]
if (chosen === undefined) {
	console.error(`unknown command: ${command}`)
	console.error('usage: demo.ts [graph|capacity|lint-charter <path>]')
	process.exit(2)
}
process.exit(chosen())
