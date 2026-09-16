/**
 * A stable hash of the tracked tree, used to stamp test results.
 *
 * `make score` treats a result file whose stamp differs from the tree on disk as
 * missing, so a passing run cannot be claimed for code that has since changed.
 * Prose is excluded by default, because editing a run sheet must not invalidate
 * a fifteen-minute end-to-end run. `--all` includes it, for the check stamp.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = join(import.meta.dirname, '..')

const PROSE = /\.(md|html)$/

export function trackedFiles(): string[] {
	const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
		cwd: ROOT,
		encoding: 'utf8',
	})
	return out.split('\n').filter(Boolean).sort()
}

export function treeHash(includeProse: boolean): string {
	const hash = createHash('sha256')
	for (const file of trackedFiles()) {
		if (!includeProse && PROSE.test(file)) continue
		hash.update(file)
		hash.update('\0')
		try {
			hash.update(readFileSync(join(ROOT, file)))
		} catch {
			// A file listed by git but gone from disk still changes the hash,
			// which is the behaviour we want.
			hash.update('<missing>')
		}
		hash.update('\0')
	}
	return hash.digest('hex')
}

if (process.argv[1] === import.meta.filename) {
	process.stdout.write(treeHash(process.argv.includes('--all')))
}
