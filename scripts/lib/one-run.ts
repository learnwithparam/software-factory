/**
 * One end-to-end run at a time, on this machine.
 *
 * Playwright clears `test-results/` when it starts. A second run started beside
 * a first one deletes the trace the first is still writing, and the first fails
 * at teardown with ENOENT on a file it created itself: fourteen minutes of real
 * model work reported as a failure, with every screenshot it took sitting
 * correctly on disk.
 *
 * It asks whether a run is happening rather than keeping a lock file, because a
 * lock is a claim about the world that goes stale the moment a run is killed,
 * and the first version of this wrote its own process id and then exited, which
 * made it a lock that never held anything.
 *
 * Scoped to this repository. The first version asked whether any Playwright was
 * running anywhere and blocked on somebody else's visual suite in another
 * project, which shares nothing with this one: Playwright clears test-results
 * inside its own directory, so a run elsewhere cannot touch these artefacts. A
 * guard that stops work it has no reason to stop is a guard people learn to
 * bypass.
 */

import { execFileSync } from 'node:child_process'
import { ROOT } from '../tree-hash.ts'

/** Process ids of any Playwright run other than this one's own tree. */
export function runningElsewhere(): number[] {
	let out = ''
	try {
		// The repository path, so another project's suite is not this one's problem.
		out = execFileSync('pgrep', ['-lf', `${ROOT}.*playwright.*test`], { encoding: 'utf8' })
	} catch {
		// pgrep exits non-zero when nothing matches, which is the common case.
		return []
	}
	const mine = new Set([process.pid, process.ppid])
	return out
		.split('\n')
		.map((line) => Number(line.trim().split(/\s+/)[0]))
		.filter((pid) => Number.isFinite(pid) && pid > 0 && !mine.has(pid))
}

if (import.meta.main) {
	const others = runningElsewhere()
	if (others.length > 0) {
		console.error(`a Playwright run is already going, as ${others.join(', ')}.`)
		console.error("Two at once delete each other's traces, and both report failures they did not have.")
		console.error('Wait for it to finish, or stop it first.')
		process.exit(1)
	}
}
