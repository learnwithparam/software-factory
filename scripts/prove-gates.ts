/**
 * Prove every scored gate fails when the thing it guards is broken.
 *
 * The repository is copied to a scratch directory, one mutation is applied
 * there, and the named test is run. A mutation that leaves its test passing is
 * reported as an unproven gate and fails the run. Nothing under the repository
 * is ever modified, so an interrupted run leaves no half-applied edit behind.
 */

import { execFileSync } from 'node:child_process'
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { MUTATIONS, editsOf, type Edit, type Mutation } from './mutations.ts'
import { runTests } from './run-tests.ts'
import { ROOT, trackedFiles } from './tree-hash.ts'

export const EXAMPLE_COPY = '.example'

/** Directories in a repository that have their own installed dependencies. */
function nodeModulesIn(root: string): string[] {
	const found = Bun.spawnSync(
		['bash', '-lc', "find . -maxdepth 4 -type d -name node_modules -not -path '*/node_modules/*'"],
		{ cwd: root },
	)
	return new TextDecoder()
		.decode(found.stdout)
		.split('\n')
		.filter(Boolean)
		.map((path) => path.replace(/^\.\/?/, '').replace(/\/?node_modules$/, ''))
}

function git(cwd: string, ...args: string[]): void {
	execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function sandbox(withExample: boolean): string {
	const dir = mkdtempSync(join(tmpdir(), 'factory-prove-'))
	for (const file of trackedFiles()) {
		// git lists a file it still tracks even after it is deleted on disk.
		// Copying blind turns that ordinary state into a crash mid-proof.
		if (!existsSync(join(ROOT, file))) continue
		const destination = join(dir, file)
		mkdirSync(dirname(destination), { recursive: true })
		cpSync(join(ROOT, file), destination, { recursive: true, errorOnExist: false })
	}
	symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir')

	// A proof may break the example repository rather than the factory, so a copy
	// of it goes into the sandbox too. Mutating the real one would leave the
	// next session working against a repository this script quietly damaged.
	const example = join(ROOT, '..', 'ledger')
	if (withExample && existsSync(example)) {
		const into = join(dir, EXAMPLE_COPY)
		cpSync(example, into, {
			recursive: true,
			filter: (from) => !from.includes('node_modules') && !from.includes(`${sep}target${sep}`),
		})
		// Its commands are the repository's own, and they need what it installed.
		// Linking rather than copying keeps a proof run to about a second.
		for (const place of nodeModulesIn(example)) {
			const link = join(into, place)
			mkdirSync(dirname(link), { recursive: true })
			symlinkSync(join(example, place, 'node_modules'), join(link, 'node_modules'), 'dir')
		}
	}
	// The copy must be a git repository: tree-hash.ts asks git which files exist,
	// and a plain directory would report none, which quietly equalises both stamps.
	git(dir, 'init', '-q')
	writeFileSync(join(dir, '.git', 'info', 'exclude'), `${EXAMPLE_COPY}\nnode_modules\n`)
	git(dir, 'add', '-A')
	const copied = join(dir, EXAMPLE_COPY)
	if (existsSync(join(copied, '.git'))) {
		writeFileSync(join(copied, '.git', 'info', 'exclude'), 'node_modules\n')
	}
	return dir
}

/** Run one test file in `dir` and report whether the named test passed. */
function testPassed(dir: string, id: string): boolean | undefined {
	const [file, name] = id.split(' > ')
	for (const result of runTests(dir, [file as string])) {
		if (result.name === name) return result.status === 'passed'
	}
	return undefined
}

function apply(dir: string, mutation: Mutation): void {
	for (const edit of editsOf(mutation)) applyEdit(dir, edit)
}

function applyEdit(dir: string, edit: Edit): void {
	const path = edit.file.startsWith('example:')
		? join(dir, EXAMPLE_COPY, edit.file.slice('example:'.length))
		: join(dir, edit.file)
	const before = readFileSync(path, 'utf8')
	if (!before.includes(edit.find)) {
		throw new Error(`${edit.file} no longer contains the text this mutation replaces`)
	}
	writeFileSync(path, before.replace(edit.find, edit.replace))
}

function main(): number {
	const entries = Object.entries(MUTATIONS)
	const unproven: string[] = []

	for (const [id, mutation] of entries) {
		const dir = sandbox(editsOf(mutation).some((edit) => edit.file.startsWith('example:')))
		try {
			const healthy = testPassed(dir, id)
			if (healthy !== true) {
				const state = healthy === false ? 'already fails' : 'never ran'
				console.log(`❌ ${id}\n     ${state} in a clean copy, so nothing is proven`)
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
			// Anything other than a pass is a proof. A mutation that stops the file
			// loading at all has made the test not pass, which is the claim.
			if (broken !== true) {
				console.log(`✅ ${id}\n     fails when ${mutation.because}`)
			} else {
				console.log(`❌ ${id}\n     still passes when ${mutation.because}`)
				unproven.push(id)
			}
		} finally {
			if (process.env.FACTORY_KEEP_SANDBOX === '1') console.log(`     sandbox kept at ${dir}`)
			else rmSync(dir, { recursive: true, force: true })
		}
	}

	console.log(`\n${entries.length - unproven.length} of ${entries.length} gates proven to fail`)
	return unproven.length === 0 ? 0 : 1
}

process.exit(main())
