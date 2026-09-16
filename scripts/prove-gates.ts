/**
 * Prove every scored gate fails when the thing it guards is broken.
 *
 * The repository is copied to a scratch directory, one mutation is applied
 * there, and the named test is run. A mutation that leaves its test passing is
 * reported as an unproven gate and fails the run. Nothing under the repository
 * is ever modified, so an interrupted run leaves no half-applied edit behind.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MUTATIONS, type Mutation } from './mutations.ts'
import { ROOT, trackedFiles } from './tree-hash.ts'

function git(cwd: string, ...args: string[]): void {
	execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function sandbox(): string {
	const dir = mkdtempSync(join(tmpdir(), 'factory-prove-'))
	for (const file of trackedFiles()) {
		cpSync(join(ROOT, file), join(dir, file), { recursive: true, errorOnExist: false })
	}
	symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')
	// The copy must be a git repository: tree-hash.ts asks git which files exist,
	// and a plain directory would report none, which quietly equalises both stamps.
	git(dir, 'init', '-q')
	git(dir, 'add', '-A')
	return dir
}

/** Run one test file in `dir` and report whether the named test passed. */
function testPassed(dir: string, id: string): boolean | undefined {
	const [file, name] = id.split(' > ')
	const out = join(dir, 'prove.json')
	try {
		execFileSync(
			join(ROOT, 'node_modules/.bin/vitest'),
			['run', file as string, '--reporter=json', `--outputFile=${out}`],
			{ cwd: dir, stdio: 'ignore' },
		)
	} catch {
		// A failing suite exits non-zero. The report still tells us which test failed.
	}
	let report: any
	try {
		report = JSON.parse(readFileSync(out, 'utf8'))
	} catch {
		return undefined
	}
	for (const suite of report.testResults ?? []) {
		for (const assertion of suite.assertionResults ?? []) {
			if (assertion.fullName === name) return assertion.status === 'passed'
		}
	}
	return undefined
}

function apply(dir: string, mutation: Mutation): void {
	const path = join(dir, mutation.file)
	const before = readFileSync(path, 'utf8')
	if (!before.includes(mutation.find)) {
		throw new Error(`${mutation.file} no longer contains the text this mutation replaces`)
	}
	writeFileSync(path, before.replace(mutation.find, mutation.replace))
}

function main(): number {
	const entries = Object.entries(MUTATIONS)
	const unproven: string[] = []

	for (const [id, mutation] of entries) {
		const dir = sandbox()
		try {
			const healthy = testPassed(dir, id)
			if (healthy !== true) {
				console.log(`❌ ${id}\n     does not pass before the mutation, so nothing is proven`)
				unproven.push(id)
				continue
			}
			try {
				apply(dir, mutation)
			} catch (error) {
				console.log(`\u274c ${id}\n     ${(error as Error).message}`)
				unproven.push(id)
				continue
			}
			const broken = testPassed(dir, id)
			if (broken === false) {
				console.log(`✅ ${id}\n     fails when ${mutation.because}`)
			} else {
				console.log(`❌ ${id}\n     still passes when ${mutation.because}`)
				unproven.push(id)
			}
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	}

	console.log(`\n${entries.length - unproven.length} of ${entries.length} gates proven to fail`)
	return unproven.length === 0 ? 0 : 1
}

process.exit(main())
