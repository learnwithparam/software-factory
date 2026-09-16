/**
 * Two ways to ask bun about this repository's tests.
 *
 * `runTests` executes them and reports each result. `listTests` uses a name
 * filter that matches nothing, so every test is reported skipped and none of
 * them runs. That is what lets a test assert things about the whole suite,
 * including itself, without calling the suite recursively.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseJunit, type JunitCase } from './junit.ts'
import { ROOT } from './tree-hash.ts'

/**
 * Which example repository a run should read.
 *
 * A sandbox carries its own copy so a proof can break the example's data
 * without touching the real one. Anything else reads the real one beside us.
 */
function example(cwd: string): string {
	const copied = join(cwd, '.example')
	if (cwd !== ROOT && existsSync(copied)) return copied
	return process.env.FACTORY_EXAMPLE ?? join(ROOT, '..', 'ledger')
}

const NOTHING_MATCHES = '__no_test_has_this_name__'

function junit(cwd: string, extra: string[], outfile?: string): JunitCase[] {
	const temporary = outfile === undefined
	const dir = temporary ? mkdtempSync(join(tmpdir(), 'factory-junit-')) : ''
	const path = outfile ?? join(dir, 'report.xml')
	try {
		spawnSync('bun', ['test', ...extra, '--reporter=junit', `--reporter-outfile=${path}`], {
			cwd,
			encoding: 'utf8',
			// A copy of the tree has no sibling repositories beside it, so the tests
			// that read one would skip and prove nothing. They are pointed back at
			// the real example, which is what the mutation is meant to be judged
			// against anyway: the factory changed, the repository did not.
			env: { ...process.env, FACTORY_EXAMPLE: example(cwd), FACTORY_REPO: example(cwd) },
		})
		try {
			return parseJunit(readFileSync(path, 'utf8'))
		} catch {
			// A file that cannot even be loaded writes no report at all. That is a
			// real result for a mutation, so it is returned as "nothing ran" rather
			// than crashing the whole proof run partway through.
			return []
		}
	} finally {
		if (temporary) rmSync(dir, { recursive: true, force: true })
	}
}

/** Every test bun can see, without running any of them. */
export function listTests(cwd: string): JunitCase[] {
	return junit(cwd, ['--test-name-pattern', NOTHING_MATCHES])
}

/** Run the suite, or the given files, and report each result. */
export function runTests(cwd: string, files: string[] = [], outfile?: string): JunitCase[] {
	return junit(cwd, files, outfile)
}
