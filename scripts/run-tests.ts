/**
 * Two ways to ask bun about this repository's tests.
 *
 * `runTests` executes them and reports each result. `listTests` uses a name
 * filter that matches nothing, so every test is reported skipped and none of
 * them runs. That is what lets a test assert things about the whole suite,
 * including itself, without calling the suite recursively.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseJunit, type JunitCase } from './junit.ts'

const NOTHING_MATCHES = '__no_test_has_this_name__'

function junit(cwd: string, extra: string[], outfile?: string): JunitCase[] {
	const temporary = outfile === undefined
	const dir = temporary ? mkdtempSync(join(tmpdir(), 'factory-junit-')) : ''
	const path = outfile ?? join(dir, 'report.xml')
	try {
		spawnSync('bun', ['test', ...extra, '--reporter=junit', `--reporter-outfile=${path}`], {
			cwd,
			stdio: 'ignore',
		})
		return parseJunit(readFileSync(path, 'utf8'))
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
