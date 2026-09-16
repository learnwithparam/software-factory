/**
 * The checks, behind one command, ending in one line.
 *
 * The commands come from the repository's own `.factory/targets.json`. The
 * factory never guesses how to test a codebase, and never hard-codes a runner:
 * it runs what the repository declares, for the targets a change reaches.
 *
 * The behaviour that earns its keep is what happens when a required check is
 * missing. A repository with no test command must not produce a green run: it
 * produces MISCONFIGURED, because absence and success are indistinguishable from
 * the outside and only one of them is safe to act on.
 */

import { affected, unowned, type Repo } from '../lib/repo.ts'

export type State = 'PASS' | 'FAIL' | 'MISCONFIGURED'

export interface CheckRun {
	readonly target: string
	readonly name: string
	readonly command: string
	readonly passed: boolean
	readonly output: string
	readonly skipped?: boolean
}

export interface GateResult {
	readonly state: State
	/** The one line. Nothing downstream may paraphrase it. */
	readonly line: string
	readonly runs: CheckRun[]
	readonly exitCode: number
}

export interface GateOptions {
	/** Drop the test commands, to show the gate failing closed. */
	readonly withoutTests?: boolean
	readonly onCheck?: (target: string, name: string) => void
}

function result(state: State, detail: string, runs: CheckRun[]): GateResult {
	return {
		state,
		line: `VERDICT: ${state} ${detail}`,
		runs,
		exitCode: state === 'PASS' ? 0 : state === 'FAIL' ? 1 : 2,
	}
}

export function runGate(repo: Repo, paths: readonly string[], options: GateOptions = {}): GateResult {
	const orphan = unowned(paths, repo.targets)[0]
	if (orphan !== undefined) {
		return result('MISCONFIGURED', `${orphan} is owned by no target, so nothing declares its checks`, [])
	}

	const targets = affected(paths, repo.targets)
	if (targets.length === 0) {
		return result('MISCONFIGURED', 'no target was selected, so this run checked nothing', [])
	}

	const runs: CheckRun[] = []
	let ranATest = false

	for (const target of targets) {
		for (const [name, command] of Object.entries(target.commands)) {
			if (name === 'test' && options.withoutTests === true) {
				runs.push({ target: target.name, name, command, passed: true, output: '', skipped: true })
				continue
			}
			options.onCheck?.(target.name, name)
			const spawned = Bun.spawnSync(['bash', '-lc', command], {
				cwd: `${repo.root}/${target.cwd}`,
			})
			const output =
				new TextDecoder().decode(spawned.stdout) + new TextDecoder().decode(spawned.stderr)
			const passed = spawned.exitCode === 0
			if (passed && name === 'test') ranATest = true
			runs.push({ target: target.name, name, command, passed, output })
		}
	}

	if (!ranATest) {
		return result('MISCONFIGURED', 'no test command ran, so this run proves nothing about behaviour', runs)
	}

	const failed = runs.filter((run) => !run.passed)
	if (failed.length > 0) {
		const named = failed.map((run) => `${run.target} ${run.name}`).join(', ')
		return result('FAIL', `${failed.length} check(s) failed: ${named}`, runs)
	}

	return result('PASS', 'every selected check passed', runs)
}
