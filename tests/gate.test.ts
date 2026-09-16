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
import { idOf } from '../scripts/junit.ts'
import { MUTATIONS } from '../scripts/mutations.ts'
import { listTests } from '../scripts/run-tests.ts'
import { TOTAL_POINTS, allChecks, declaredPoints } from '../scripts/rubric.ts'
import { ROOT, treeHash } from '../scripts/tree-hash.ts'

const makefile = readFileSync(join(ROOT, 'Makefile'), 'utf8')
const workflow = readFileSync(join(ROOT, '.github/workflows/check.yml'), 'utf8')

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
	expect(workflow).toMatch(/run:\s*make check/)
	expect(workflow).toMatch(/run:\s*make score/)
	expect(workflow).toMatch(/run:\s*make prove/)
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
	if (declaredPoints() < TOTAL_POINTS) {
		expect(workflow, 'CI should tolerate unbound points while phases remain').toContain('--allow-unbound')
		return
	}
	expect(workflow, 'every point is bound, so remove --allow-unbound from CI').not.toContain(
		'--allow-unbound',
	)
})

it('the prose check is wired into make check', () => {
	expect(makefile).toMatch(/^check:[\s\S]*?check-prose\.ts/m)
})

it('the tree stamp excludes prose and includes code', () => {
	// Two hashes that never differ would silently make every e2e result look fresh.
	expect(treeHash(true)).not.toEqual(treeHash(false))
})
