/**
 * Step one on stage: what may be attempted, and what stops production.
 *
 * `graph`         who owns which paths, and what happens to a path nobody owns
 * `capacity`      the review queue cap refusing to start more work
 * `lint-charter`  check a charter, yours or the example's
 */

import { EM_DASH, allowed, failed, note, refused, step, table, title, verdict } from '../lib/out.ts'
import { affected, filesIn, loadRepo, readCharter, unowned } from '../lib/repo.ts'
import { decide, mayStart } from './policy.ts'

const repo = loadRepo()

function showGraph(): number {
	title(`Who owns what in ${repo.root}`)
	table(
		['target', 'autonomy', 'depends on', 'paths'],
		repo.targets.map((target) => [
			target.name,
			target.autonomy,
			target.dependsOn.join(', ') || EM_DASH,
			target.paths.join(' '),
		]),
	)
	note('None of this is in the factory. It is the repository describing itself.')

	title('What a change reaches')
	const shared = repo.targets.find((target) => target.dependsOn.length === 0 && repo.targets.some((other) => other.dependsOn.includes(target.name)))
	const leaf = repo.targets.find((target) => target.dependsOn.length > 0)
	for (const target of [leaf, shared]) {
		if (target === undefined) continue
		const example = target.paths[0]?.replace('/**', '/example') ?? target.cwd
		const reached = affected([example], repo.targets).map((entry) => entry.name)
		step(`a change under ${target.name} affects ${reached.join(', ')}`)
	}
	note('One edited definition reaches everything built on it. A file to target mapping would run one suite and ship a break.')

	title('Every path has an owner')
	const files = filesIn(repo.root)
	const orphans = unowned(files, repo.targets)
	if (orphans.length > 0) {
		for (const orphan of orphans.slice(0, 10)) {
			failed(`${orphan} is owned by no target, so nothing declares its checks or its autonomy`)
		}
		verdict('FAIL', `${orphans.length} of ${files.length} files have no owner.`)
		return 1
	}
	allowed(`all ${files.length} files are claimed by a target`)
	verdict('PASS', 'The graph accounts for the whole codebase.')
	return 0
}

function showCapacity(): number {
	const cap = repo.charter.reviewQueueCap
	title(`Back-pressure: the cap is ${cap}`)
	for (let queue = Math.max(0, cap - 2); queue <= cap; queue += 1) {
		const decision = mayStart(repo, queue)
		if (decision.allowed) allowed(`${queue} awaiting review, work may start`)
		else refused(`${queue} awaiting review, ${decision.reason}`)
	}
	note('The binding constraint is how many decisions wait on a person, not how many agents can run.')

	title('And the path that is never touched')
	const guarded = repo.charter.protectedPaths[0]
	if (guarded === undefined) {
		failed('this repository protects nothing at all')
		verdict('FAIL', 'A charter that protects nothing is a charter in name only.')
		return 1
	}
	const decision = decide(repo, { id: 'demo', paths: [guarded.glob.replace('/**', '/anything.txt')] })
	if (decision.allowed) {
		failed('a protected path was permitted, which means the charter is not being read')
		verdict('FAIL', 'A protected path allowed a change.')
		return 1
	}
	refused(decision.rule)
	note(decision.reason)
	verdict('REFUSED', 'Stopping here is the successful outcome.')
	return 0
}

function lintCharter(path: string): number {
	title(`Reading the charter in ${path}`)
	try {
		const charter = readCharter(path)
		allowed(`tier is ${charter.tier}`)
		allowed(`review queue cap is ${charter.reviewQueueCap}`)
		allowed(`${charter.protectedPaths.length} protected paths, each carrying a reason`)
		for (const entry of charter.protectedPaths) note(`${entry.glob}  ${entry.reason}`)
		verdict('PASS', 'Every part a run reads is present.')
		return 0
	} catch (error) {
		failed(error instanceof Error ? error.message : String(error))
		verdict('MISCONFIGURED', 'A charter that cannot be read refuses every task.')
		return 2
	}
}

const [command = 'graph', argument] = process.argv.slice(2)

const commands: Record<string, () => number> = {
	graph: showGraph,
	capacity: showCapacity,
	'lint-charter': () => lintCharter(argument ?? repo.root),
}

const chosen = commands[command]
if (chosen === undefined) {
	console.error(`unknown command: ${command}`)
	console.error('usage: demo.ts [graph|capacity|lint-charter <repo>]')
	process.exit(2)
}
process.exit(chosen())
