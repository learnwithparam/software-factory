/**
 * Phase 10: the architecture survives a change of substrate.
 *
 * Step seven is read, not run, so what is checked is that it stays honest: every
 * layer accounted for, and the rules that never transfer stated the same way in
 * both places.
 */

import { expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { filesIn } from '../steps/lib/repo.ts'

const ROOT = join(import.meta.dirname, '..')
const readme = readFileSync(join(ROOT, 'steps/07-mastra/README.md'), 'utf8')
const board = readFileSync(join(ROOT, 'steps/07-mastra/src/mastra/boards.ts'), 'utf8')

it('every layer built by hand is mapped onto the platform', () => {
	for (const layer of ['Boundary', 'Context', 'Skills', 'Execution', 'Verification', 'Delivery']) {
		expect(readme).toContain(`| ${layer} |`)
	}
})

it('every file the mapping cites still exists', () => {
	// A table pointing at files that moved is worse than no table.
	const cited = [...readme.matchAll(/`(steps\/[^`]+?)`/g)].map((match) => match[1] as string)
	expect(cited.length).toBeGreaterThan(4)
	const missing = cited
		.map((path) => path.replace(/\*.*$/, ''))
		.filter((path) => !existsSync(join(ROOT, path)))
	expect(missing).toEqual([])
})

it('the board declares a phase for every stage the hand-built loop runs', () => {
	for (const phase of ['intake', 'context', 'building', 'checking', 'review']) {
		expect(board).toContain(`${phase}: {`)
	}
})

it('the rule that nothing merges itself is stated on both substrates', () => {
	// The charter lives in whichever repository is being worked on, so what is
	// checked here is that the board states the rule, not where a charter says it.
	expect(board).toContain('Merging is never automated')
	expect(board).toContain('approval_required')
})

it('the mapping says what does not transfer', () => {
	expect(readme).toContain('What does not transfer')
	expect(readme).toContain('What it costs')
})

/**
 * Nothing may use Bun's `import.meta.dir`.
 *
 * It resolves under `bun test` and is undefined under Node, which is what runs
 * the Playwright suite. A spec importing `steps/lib/repo.ts` therefore called
 * `join(undefined, ...)` and failed with a TypeError about a path argument,
 * nowhere near the line responsible, after a six minute model run.
 *
 * `import.meta.dirname` is the standard spelling and works in both, so the rule
 * is simply that the Bun-only one is never used.
 */
it('uses no runtime-specific path helper that breaks under Node', () => {
	// The call, not the name. This file has to say `import.meta.dir` in its own
	// comment and its own failure message to be readable, so matching the bare
	// name makes the gate report itself for ever. In code the property is always
	// followed by a comma or a closing bracket; in prose it never is.
	const bunOnly = new RegExp(`import\\.meta\\.${'d' + 'ir'}\\s*[,)\\]]`)
	// mutations.ts is the catalogue of deliberate breakages, so it holds the
	// broken form of this very rule on purpose. It is data rather than anything
	// that runs, and prove-gates is what reads it.
	const offenders = filesIn(ROOT)
		.filter((file) => file.endsWith('.ts') && !file.startsWith('e2e/node_modules'))
		.filter((file) => file !== 'scripts/mutations.ts')
		.filter((file) => bunOnly.test(readFileSync(join(ROOT, file), 'utf8')))
	expect(offenders, 'import.meta.dir is undefined under Node: use import.meta.dirname').toEqual([])
})
