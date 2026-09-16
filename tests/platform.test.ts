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

const ROOT = join(import.meta.dir, '..')
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
