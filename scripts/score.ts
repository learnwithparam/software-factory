/**
 * Score the build 0 to 100 from test results. Exits 1 below 100.
 *
 * Results come from artifacts/vitest.json (make check) and artifacts/playwright.json
 * (make e2e). A result file stamped with a different tree than the one on disk
 * counts as missing, so yesterday's green run cannot vouch for today's code.
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { PHASES, TOTAL_POINTS, type Source } from './rubric.ts'
import { ROOT, treeHash } from './tree-hash.ts'

const ARTIFACTS = join(ROOT, 'artifacts')

type Results = Record<Source, Map<string, boolean>>

function stampMatches(stamp: string, includeProse: boolean): boolean {
	const path = join(ARTIFACTS, stamp)
	return existsSync(path) && readFileSync(path, 'utf8').trim() === treeHash(includeProse)
}

function unitResults(): Map<string, boolean> {
	const path = join(ARTIFACTS, 'vitest.json')
	if (!existsSync(path) || !stampMatches('check-tree.txt', true)) return new Map()
	const report = JSON.parse(readFileSync(path, 'utf8'))
	const results = new Map<string, boolean>()
	for (const file of report.testResults ?? []) {
		const rel = relative(ROOT, file.name)
		for (const assertion of file.assertionResults ?? []) {
			results.set(`${rel} > ${assertion.fullName}`, assertion.status === 'passed')
		}
	}
	return results
}

function playwrightResults(): Map<string, boolean> {
	const path = join(ARTIFACTS, 'playwright.json')
	if (!existsSync(path) || !stampMatches('e2e-tree.txt', false)) return new Map()
	const results = new Map<string, boolean>()
	const walk = (suite: any, file: string): void => {
		const current = suite.file ?? file
		for (const spec of suite.specs ?? []) {
			results.set(`${basename(current)} > ${spec.title}`, spec.ok === true)
		}
		for (const child of suite.suites ?? []) walk(child, current)
	}
	for (const suite of JSON.parse(readFileSync(path, 'utf8')).suites ?? []) walk(suite, suite.file ?? '')
	return results
}

function main(): number {
	const results: Results = { unit: unitResults(), pw: playwrightResults() }
	let total = 0
	let declared = 0

	for (const [phase, checks] of Object.entries(PHASES)) {
		const possible = checks.reduce((sum, c) => sum + c.points, 0)
		const earned = checks.reduce((sum, c) => (results[c.source].get(c.id) ? sum + c.points : sum), 0)
		total += earned
		declared += possible
		console.log(`${earned === possible ? '✅' : '❌'} ${phase.padEnd(30)} ${String(earned).padStart(3)} / ${possible}`)
		for (const check of checks) {
			if (results[check.source].get(check.id)) continue
			const state = results[check.source].has(check.id) ? 'failed' : 'not run'
			console.log(`     ${state.padEnd(8)} ${check.id}`)
		}
	}

	for (const [source, stamp] of [['unit', 'check-tree.txt'], ['pw', 'e2e-tree.txt']] as const) {
		if (results[source].size === 0) {
			console.log(`   no fresh ${source} results (${stamp} missing or from other code)`)
		}
	}

	const unclaimed = TOTAL_POINTS - declared
	if (unclaimed > 0) {
		console.log(`\n${unclaimed} points are not yet bound to a test. Phases still to build.`)
	}
	console.log(`\nScore: ${total} / ${TOTAL_POINTS}`)
	return total === TOTAL_POINTS ? 0 : 1
}

process.exit(main())
