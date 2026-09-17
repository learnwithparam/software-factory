/**
 * Switch the repository between four company shapes.
 *
 * The factory does not change. What changes is the contract the repository hands
 * it: the charter, the ownership graph, and the two switches on the board. That
 * is the whole argument, so it has to be one command rather than a checklist.
 *
 * The demonstration is the money-path issue, which takes a different route under
 * each shape: a pull request under `solo`, a plan waiting under `startup`,
 * refused and routed under `scaleup`, refused at the boundary under
 * `enterprise`. None of them is the correct answer. They are four defensible
 * positions about who carries the cost of being wrong.
 */

import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { allowed, failed, note, step, table, title, verdict } from '../steps/lib/out.ts'
import { session } from './factory-connect.ts'
import { loadRepo, repoRoot } from '../steps/lib/repo.ts'

const BASE = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'
const HERE = join(import.meta.dir, '..')
const SHAPES = ['solo', 'startup', 'scaleup', 'enterprise'] as const

interface Board {
	readonly autoRunEnabled: boolean
	readonly autoApprovePlans: boolean
	readonly reviewQueueCap: number
}

const name = process.argv[2] ?? process.env.NAME ?? ''
const repo = loadRepo(repoRoot())

/** With no name, say which shape is applied rather than changing anything. */
if (name === '') {
	title('Which shape this repository is in')
	const current = readFileSync(join(repo.root, '.factory', 'charter.md'), 'utf8')
	const matched = SHAPES.filter((shape) => current === readFileSync(join(HERE, 'profiles', shape, 'charter.md'), 'utf8'))

	table(
		['shape', 'money path', 'applied'],
		SHAPES.map((shape) => {
			const targets = JSON.parse(readFileSync(join(HERE, 'profiles', shape, 'targets.json'), 'utf8')) as {
				targets: Record<string, { autonomy: string }>
			}
			return [shape, targets.targets.budget?.autonomy ?? '?', matched.includes(shape) ? 'yes' : '']
		}),
	)
	if (matched.length === 0) note('none of them: the charter in the repository is its own')
	verdict('PASS', 'make profile NAME=solo, or startup, scaleup, enterprise.')
	process.exit(0)
}

if (!SHAPES.includes(name as (typeof SHAPES)[number])) {
	failed(`${name} is not a shape`)
	note(`one of: ${SHAPES.join(', ')}`)
	process.exit(2)
}

const from = join(HERE, 'profiles', name)
if (!existsSync(join(from, 'charter.md'))) {
	failed(`profiles/${name} has no charter`)
	process.exit(2)
}

title(`Putting the repository in the ${name} shape`)

// The charter and the graph are files the repository owns, so they are copied
// in rather than patched: a shape is a whole position, not a diff.
copyFileSync(join(from, 'charter.md'), join(repo.root, '.factory', 'charter.md'))
copyFileSync(join(from, 'targets.json'), join(repo.root, '.factory', 'targets.json'))

// Committed and pushed, not left in the working tree. Two reasons, and the
// second one is the one that bites: a run clones the repository from GitHub, so
// a shape that is only on this disk is a shape no agent will ever read. The
// first is that the charter says it is owned by a person and changed
// deliberately, and a governance change that leaves no record is neither.
const changed = command('git', '-C', repo.root, 'status', '--porcelain', '.factory')
if (changed.out !== '') {
	command('git', '-C', repo.root, 'add', '.factory/charter.md', '.factory/targets.json')
	const committed = command('git', '-C', repo.root, 'commit', '-q', '-m', `Operate in the ${name} shape`)
	if (!committed.ok) {
		failed('the shape could not be committed')
		note(committed.out)
		verdict('FAIL', 'A shape only on this disk is a shape no run will read.')
		process.exit(1)
	}
	const pushed = command('git', '-C', repo.root, 'push', '-q', 'origin', 'HEAD')
	if (!pushed.ok) {
		failed('the shape was committed and not pushed')
		note(pushed.out)
		verdict('FAIL', 'Runs clone from the remote, so an unpushed shape changes nothing.')
		process.exit(1)
	}
	allowed('charter and ownership graph committed and pushed')
} else {
	allowed('charter and ownership graph already match this shape')
}

const board = JSON.parse(readFileSync(join(from, 'board.json'), 'utf8')) as Board

const cookie = await session()
const listed = await fetch(`${BASE}/web/factory/projects`, { headers: { cookie, accept: 'application/json' } })
if (!listed.ok) {
	failed(`listing projects answered ${listed.status}`)
	verdict('FAIL', 'The board switches were not changed.')
	process.exit(1)
}
const { projects } = (await listed.json()) as { projects: Array<{ id: string; name: string }> }
const project = projects[0]
if (project === undefined) {
	failed('no factory project exists yet')
	verdict('NEEDS REVIEW', 'Run make factory-connect first.')
	process.exit(1)
}

const patched = await fetch(`${BASE}/web/factory/projects/${project.id}`, {
	method: 'PATCH',
	headers: { 'content-type': 'application/json', origin: BASE, cookie },
	body: JSON.stringify({ autoRunEnabled: board.autoRunEnabled, autoApprovePlans: board.autoApprovePlans }),
})
if (!patched.ok) {
	failed(`the server answered ${patched.status} setting the switches`)
	verdict('FAIL', 'The charter changed and the board did not, which is worse than neither.')
	process.exit(1)
}

// Read back. A 200 is the server's claim and this is the fact.
const confirm = await fetch(`${BASE}/web/factory/projects/${project.id}`, { headers: { cookie, accept: 'application/json' } })
const { project: saved } = (await confirm.json()) as { project: { autoRunEnabled: boolean; autoApprovePlans: boolean } }
if (saved.autoRunEnabled !== board.autoRunEnabled || saved.autoApprovePlans !== board.autoApprovePlans) {
	failed('the board did not keep the switches')
	verdict('FAIL', 'The charter changed and the board did not.')
	process.exit(1)
}

const targets = JSON.parse(readFileSync(join(from, 'targets.json'), 'utf8')) as {
	targets: Record<string, { autonomy: string }>
}
step(`money path: ${targets.targets.budget?.autonomy}`)
table(
	['auto-start runs', 'auto-approve plans', 'review queue cap'],
	[[String(saved.autoRunEnabled), String(saved.autoApprovePlans), String(board.reviewQueueCap)]],
)
verdict('PASS', `The repository is in the ${name} shape. make lab-reset to start a run under it.`)


/** Run a command and keep what it said, so a failure can explain itself. */
function command(bin: string, ...args: string[]): { ok: boolean; out: string } {
	const result = spawnSync(bin, args, { encoding: 'utf8' })
	return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}
