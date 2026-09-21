/**
 * Phase 1: the gate itself.
 *
 * These tests are the reason a later phase can be trusted. They check that the
 * commands exist, that CI runs them, that every point on the scorecard names a
 * test that exists, and that the freshness stamp distinguishes prose from code.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'bun:test'
import { violations, rulesStale } from '../scripts/check-prose.ts'
import { idOf } from '../scripts/junit.ts'
import { MUTATIONS } from '../scripts/mutations.ts'
import { listTests } from '../scripts/run-tests.ts'
import { TOTAL_POINTS, allChecks, declaredPoints } from '../scripts/rubric.ts'
import { isStamped, makefileSlice, trackedFiles, unclassified } from '../scripts/tree-hash.ts'
import { ROOT, treeHash } from '../scripts/tree-hash.ts'

const makefile = readFileSync(join(ROOT, 'Makefile'), 'utf8')
const workflow = readFileSync(join(ROOT, '.github/workflows/check.yml'), 'utf8')

/**
 * The commands CI actually runs.
 *
 * Reading the whole file and searching for a substring found the flag inside the
 * comment that explains the flag, so removing it from the command changed
 * nothing. A check that reads prose is a check that can be satisfied by prose.
 */
const ciCommands = [...workflow.matchAll(/^\s*-\s*run:\s*(.+)$/gm)].map((m) => (m[1] as string).trim())

function makeTargets(): Set<string> {
	return new Set([...makefile.matchAll(/^([a-z][a-z0-9-]*):/gm)].map((m) => m[1] as string))
}

it('every make target the docs name exists', () => {
	const documented = new Set(
		[...makefile.matchAll(/^([a-z][a-z0-9-]*):.*?## /gm)].map((m) => m[1] as string),
	)
	expect(documented.size).toBeGreaterThan(0)
	expect([...documented].filter((t) => !makeTargets().has(t))).toEqual([])
	// The four the rest of the repository depends on, named so a rename is loud.
	for (const target of ['check', 'e2e', 'score', 'demo']) {
		expect(makeTargets()).toContain(target)
	}
})

it('CI runs make check', () => {
	expect(ciCommands).toContain('make check')
	expect(ciCommands).toContain('make prove')
	expect(ciCommands.some((command) => command.startsWith('make score'))).toBe(true)
})

it('every scored check exists', () => {
	const declared = new Set(listTests(ROOT).map(idOf))
	expect(declared.size, 'bun reported no tests at all').toBeGreaterThan(0)
	const missing = allChecks()
		.filter((check) => check.source === 'unit')
		.map((check) => check.id)
		.filter((id) => !declared.has(id))
	expect(missing, 'the scorecard names unit tests that do not exist').toEqual([])
})

it('every scored check has a proof that it fails', () => {
	// Adding a point to the scorecard forces adding the break that proves it.
	const unproven = allChecks()
		.filter((check) => check.source === 'unit')
		.map((check) => check.id)
		.filter((id) => !(id in MUTATIONS))
	expect(unproven, 'these scored checks have no mutation in scripts/mutations.ts').toEqual([])
})

it('the scorecard never declares more points than the total', () => {
	// Adding a phase without rebalancing quietly makes a score above 100 possible,
	// and a score that can exceed its own maximum is not a score.
	expect(declaredPoints()).toBeLessThanOrEqual(TOTAL_POINTS)
})

it('CI stops tolerating unbound points once every point is bound', () => {
	// A build mid-way through is allowed to score under a hundred, and CI says so
	// with --allow-unbound. The moment the last phase lands that permission is a
	// hole, so the test that removes it is the one that notices.
	const tolerant = ciCommands.some((command) => command.includes('--allow-unbound'))
	if (declaredPoints() < TOTAL_POINTS) {
		expect(tolerant, 'CI should tolerate unbound points while phases remain').toBe(true)
		return
	}
	expect(tolerant, 'every point is bound, so remove --allow-unbound from CI').toBe(false)
})

it('the prose check is wired into make check', () => {
	expect(makefile).toMatch(/^check:[\s\S]*?check-prose\.ts/m)
	// Its word lists are a committed copy of the house rules. Empty lists would pass everything,
	// and where the rules live the copy must match them.
	expect(violations("It is a game-changer. Let's dive in.").length).toBeGreaterThan(0)
	expect(rulesStale()).toBeNull()
})

it('the tree stamp excludes prose and includes code', () => {
	// Two hashes that never differ would silently make every e2e result look fresh.
	expect(treeHash(true)).not.toEqual(treeHash(false))

	// And the split has to be the real one rather than any split at all. Prose out,
	// because editing the guide must not invalidate a fifteen-minute run; the
	// harness in, because editing what the run executes must.
	const stamped = trackedFiles().filter(isStamped)
	expect(stamped.filter((file) => file === 'guide.html' || file === 'workbook.html' || file.startsWith('teach/')), 'prose is inside the stamp').toEqual([])
	expect(stamped.some((file) => file.startsWith('steps/')), 'the harness is outside the stamp').toBe(true)
})

it('every tracked path is on one side of the end-to-end stamp', () => {
	// The stamp used to be "everything except a pattern matching prose", so a file
	// nobody thought about was stamped by default: a new teaching page silently
	// invalidated every recorded run, and an unrelated Makefile target cost a full
	// rerun. Nothing is on either side by default now, and this is what makes
	// somebody choose.
	const orphans = unclassified(trackedFiles())
	expect(
		orphans.slice(0, 3),
		`claimed by neither STAMPED nor NOT_STAMPED in scripts/tree-hash.ts. Say which side, with the reason`,
	).toEqual([])
})

it('the stamp covers what an end-to-end run loads, and not what it cannot reach', () => {
	expect(isStamped('steps/04-verification/gate.ts'), 'a step the harness runs is not stamped').toBe(true)
	expect(isStamped('e2e/specs/01-clean-path.spec.ts'), 'a spec is not stamped').toBe(true)
	expect(isStamped('scripts/run-report.ts'), 'a script the e2e recipe calls is not stamped').toBe(true)
	expect(isStamped('design/book.css'), 'a print stylesheet cannot change what a run proved').toBe(false)
	expect(isStamped('tests/book.test.ts'), 'a unit test is not loaded by a spec').toBe(false)
	expect(isStamped('scripts/build-book.ts'), 'the PDF builder is not loaded by a spec').toBe(false)
})

it('the Makefile is stamped by recipe, and the recipe still exists', () => {
	// If a rename made the extraction return nothing, the stamp would still look
	// healthy while covering less than it claims, so a missing recipe throws.
	const slice = makefileSlice()
	expect(slice).toContain('e2e:')
	expect(slice, 'the slice does not contain the command that runs the specs').toContain('playwright test')
	expect(slice, 'a target that cannot touch the harness is inside the stamp').not.toContain('book:')
})
