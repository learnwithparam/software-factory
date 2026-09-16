/**
 * Step two on stage: where the work happens, and what it can reach.
 *
 * `create <item>`  make a workspace for one task
 * `remove <item>`  throw it away
 * `race <item>`    two runs wake up for the same item; one of them stops
 * `limits`         what a task may write, run and reach
 * `selftest`       the checks a cohort member runs against their own harness
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowed, failed, note, refused, step, table, title, verdict } from '../lib/out.ts'
import { loadRepo } from '../lib/repo.ts'
import { claim } from './claim.ts'
import { LimitExceeded, PROFILES, checkCommand, checkNetwork, checkWrite, profileFor } from './limits.ts'
import { create, git, list, remove, status, workspaceFor } from './worktree.ts'

const repo = loadRepo()

function short(path: string): string {
	return path.replace(`${process.env.HOME}/`, '~/')
}

function doCreate(item: string): number {
	title(`A workspace for ${item}`)
	const before = list(repo.root).length
	const workspace = create(repo.root, item)
	step(`branch ${workspace.branch}`)
	step(`at ${short(workspace.path)}`)
	allowed(`workspaces went from ${before} to ${list(repo.root).length}`)
	note(`the repository itself is at ${short(repo.root)} and was not touched`)
	verdict('PASS', 'The task has somewhere to work that is not your branch.')
	return 0
}

function doRemove(item: string): number {
	title(`Throwing away the workspace for ${item}`)
	remove(repo.root, item)
	allowed(`${list(repo.root).length} workspaces remain`)
	verdict('PASS', 'Cleanup is one command, which is why it actually happens.')
	return 0
}

/**
 * Two runs, one item.
 *
 * A throwaway bare repository stands in for the shared remote, so the race is
 * real rather than narrated. The mechanism is the same one a hosted remote uses.
 */
function doRace(item: string): number {
	const remote = mkdtempSync(join(tmpdir(), 'factory-remote-'))
	const runs = [mkdtempSync(join(tmpdir(), 'factory-run-a-')), mkdtempSync(join(tmpdir(), 'factory-run-b-'))]
	try {
		title(`Two runs wake up for item ${item}`)
		git(['init', '--bare', '-q', remote], tmpdir())

		const seed = mkdtempSync(join(tmpdir(), 'factory-seed-'))
		git(['init', '-q', seed], tmpdir())
		writeFileSync(join(seed, 'README.md'), '# lab\n')
		git(['add', '-A'], seed)
		git(['-c', 'user.email=lab@example.com', '-c', 'user.name=Lab', 'commit', '-qm', 'seed'], seed)
		git(['push', '-q', remote, 'HEAD:refs/heads/main'], seed)
		rmSync(seed, { recursive: true, force: true })

		for (const run of runs) {
			git(['clone', '-q', remote, run], tmpdir())
			git(['checkout', '-qb', workspaceFor(repo.root, item).branch], run)
			writeFileSync(join(run, 'work.txt'), `${run}\n`)
			git(['add', '-A'], run)
			git(['-c', 'user.email=lab@example.com', '-c', 'user.name=Lab', 'commit', '-qm', 'work'], run)
		}
		note('Both computed the same branch name, because the name comes from the item.')

		const results = runs.map((run, index) => ({ index, ...claim(item, remote, run) }))
		for (const result of results) {
			if (result.owned) allowed(`run ${result.index + 1} owns ${result.branch} and continues`)
			else refused(`run ${result.index + 1} stops: ${result.reason}`)
		}

		const owners = results.filter((result) => result.owned).length
		if (owners !== 1) {
			verdict('FAIL', `${owners} runs believe they own the item.`)
			return 1
		}
		verdict('PASS', 'Exactly one run owns the work, and nothing new is running to make that true.')
		return 0
	} finally {
		for (const path of [remote, ...runs]) rmSync(path, { recursive: true, force: true })
	}
}

function tryLimit(what: string, action: () => void): boolean {
	try {
		action()
		allowed(what)
		return true
	} catch (error) {
		if (error instanceof LimitExceeded) {
			refused(`${what} — ${error.message}`)
			return false
		}
		throw error
	}
}

function doLimits(violate: boolean): number {
	const workspace = '/workspace'
	title('Limits, declared per task')
	table(
		['profile', 'network', 'commands', 'why'],
		Object.entries(PROFILES).map(([name, limits]) => [
			name,
			limits.network ? 'yes' : 'no',
			limits.commands.join(' '),
			limits.why,
		]),
	)

	const display = profileFor('display')
	title('A display task, inside its limits')
	tryLimit('write apps/console/app/page.tsx', () => checkWrite(display, workspace, 'apps/console/app/page.tsx'))
	tryLimit('run bun test', () => checkCommand(display, 'bun test'))

	title('And outside them')
	const refusals = [
		!tryLimit('write services/budget/src/lib.rs', () => checkWrite(display, workspace, 'services/budget/src/lib.rs')),
		!tryLimit('write ../../etc/hosts', () => checkWrite(display, workspace, '../../etc/hosts')),
		!tryLimit('run curl', () => checkCommand(display, 'curl https://example.com')),
		!tryLimit('reach the network', () => checkNetwork(display, 'api.example.com')),
	]
	note('Each of those ends the run. A warning in a log is not a limit.')

	if (violate) {
		title('What a task that needs more reach looks like')
		const deps = profileFor('dependencies')
		tryLimit('the dependency task reaches the network', () => checkNetwork(deps, 'registry.npmjs.org'))
		note('Naming the one task that needs it is what keeps the network off every other task.')
	}

	const all = refusals.every(Boolean)
	verdict(all ? 'PASS' : 'FAIL', all ? 'Every limit refused what it should.' : 'A limit let something through.')
	return all ? 0 : 1
}

function doSelftest(): number {
	title('Harness self-check')
	const item = 'selftest'
	let ok = true

	remove(repo.root, item)
	const before = status(repo.root)
	const workspace = create(repo.root, item)
	ok = check('a workspace is created', list(repo.root).some((entry) => entry.branch === workspace.branch)) && ok
	writeFileSync(join(workspace.path, 'scratch.txt'), 'written by the task\n')
	ok = check('the repository is unchanged while the task writes', status(repo.root) === before) && ok
	ok = check('the workspace is outside the repository', !workspace.path.startsWith(repo.root)) && ok
	ok = check('creating the same workspace twice resumes rather than failing', create(repo.root, item).path === workspace.path) && ok
	remove(repo.root, item)
	ok = check('removing it leaves nothing behind', !list(repo.root).some((entry) => entry.branch === workspace.branch)) && ok

	verdict(ok ? 'PASS' : 'FAIL', ok ? 'The harness holds.' : 'Read the failing line above before running a task.')
	return ok ? 0 : 1
}

function check(what: string, held: boolean): boolean {
	if (held) allowed(what)
	else failed(what)
	return held
}

const argv = process.argv.slice(2)
const [command = 'create', argument] = argv

const commands: Record<string, () => number> = {
	create: () => doCreate(argument ?? '1'),
	remove: () => doRemove(argument ?? '1'),
	race: () => doRace(argument ?? '142'),
	limits: () => doLimits(argv.includes('--violate')),
	selftest: doSelftest,
}

const chosen = commands[command]
if (chosen === undefined) {
	console.error(`unknown command: ${command}`)
	console.error('usage: demo.ts [create <item>|remove <item>|race <item>|limits|selftest]')
	process.exit(2)
}
process.exit(chosen())
