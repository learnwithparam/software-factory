/**
 * Which targets a change reaches, and the exact commands to run for them.
 *
 * Running every check in a repository of any size is slow enough that people
 * stop doing it. Deriving the set from the diff and the dependency edges keeps
 * the loop fast, and it is the same calculation that tells a context router
 * which rules a task needs. One graph, two uses.
 *
 *   bun tools/affected.ts --since HEAD~1
 *   bun tools/affected.ts --paths packages/contracts/src/index.ts
 *   bun tools/affected.ts --all --json
 */

import { affected, changedSince, files, loadGraph, ownerOf, unowned } from './graph.ts'

const argv = process.argv.slice(2)

function flag(name: string): string | undefined {
	const at = argv.indexOf(`--${name}`)
	return at === -1 ? undefined : argv[at + 1]
}

const targets = loadGraph()
const wantsJson = argv.includes('--json')
const owner = flag('owner')

if (owner !== undefined) {
	const found = ownerOf(owner, targets)
	if (wantsJson) console.log(JSON.stringify({ path: owner, owner: found?.name ?? null }))
	else console.log(found?.name ?? 'no target owns this path')
	process.exit(found === undefined ? 1 : 0)
}

const paths = argv.includes('--all')
	? files()
	: flag('paths') !== undefined
		? (flag('paths') as string).split(',').filter(Boolean)
		: changedSince(flag('since') ?? 'HEAD~1')

const selected = affected(paths, targets)
const orphans = unowned(paths, targets)

if (wantsJson) {
	console.log(
		JSON.stringify({
			paths,
			unowned: orphans,
			targets: selected.map((target) => ({
				name: target.name,
				autonomy: target.autonomy,
				why: target.why,
				cwd: target.cwd,
				commands: target.commands,
			})),
		}),
	)
} else {
	if (paths.length === 0) console.log('nothing changed')
	for (const path of orphans) console.log(`unowned  ${path}`)
	for (const target of selected) {
		for (const [name, command] of Object.entries(target.commands)) {
			console.log(`${target.name}\t${name}\t(cd ${target.cwd} && ${command})`)
		}
	}
}

process.exit(orphans.length > 0 ? 1 : 0)
