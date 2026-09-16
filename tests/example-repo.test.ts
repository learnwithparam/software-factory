/**
 * Phase 11: the example repository is a well-formed factory repository.
 *
 * These assertions are about shape, never about content. Nothing here names a
 * service, a language or a directory in the example, because the moment the
 * factory's own suite knows those things it stops being a factory and becomes a
 * script for one codebase.
 *
 * The example lives beside this repository rather than inside it, so a clone of
 * the factory alone skips this file rather than failing.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runGate } from '../steps/04-verification/gate.ts'
import { decide } from '../steps/01-boundary/policy.ts'
import { route } from '../steps/03-context/router.ts'
import { issuesIn } from '../steps/lib/issues.ts'
import { filesIn, isConfigured, loadRepo, unowned } from '../steps/lib/repo.ts'

const EXAMPLE = process.env.FACTORY_EXAMPLE ?? join(import.meta.dir, '..', '..', 'ledger')
const present = existsSync(EXAMPLE) && isConfigured(EXAMPLE)

describe.if(present)('the example repository', () => {
	const repo = loadRepo(EXAMPLE)

	it('declares a charter the factory can read', () => {
		expect(repo.charter.tier.length).toBeGreaterThan(0)
		expect(repo.charter.reviewQueueCap).toBeGreaterThan(0)
		expect(repo.charter.protectedPaths.length).toBeGreaterThan(0)
	})

	it('claims every file it contains', () => {
		expect(unowned(filesIn(repo.root), repo.targets)).toEqual([])
	})

	it('gives every target a test command and a reason for its autonomy', () => {
		const incomplete = repo.targets.filter(
			(target) => target.commands.test === undefined || target.why.trim().length < 20,
		)
		expect(incomplete.map((target) => target.name)).toEqual([])
	})

	it('protects the files that decide what every other rule means', () => {
		// The charter and the ownership graph protect themselves, deliberately.
		// The reason is checked, not only the refusal: a file nobody owns is also
		// refused, and that would hide the protection quietly disappearing.
		for (const path of ['.factory/charter.md', '.factory/targets.json']) {
			const decision = decide(repo, { id: 'x', paths: [path] })
			expect(decision.allowed).toBe(false)
			if (decision.allowed) return
			expect(decision.rule).toStartWith('protected:')
		}
	})

	it('carries a work item of every shape a session needs', () => {
		const decisions = issuesIn(repo.root).map((item) =>
			decide(repo, { id: item.id, paths: item.paths }),
		)
		expect(decisions.some((decision) => decision.allowed && decision.autonomy === 'build')).toBe(true)
		expect(decisions.some((decision) => decision.allowed && decision.autonomy === 'propose')).toBe(true)
		expect(decisions.some((decision) => !decision.allowed)).toBe(true)
	})

	it('has at least one item whose change reaches more than one target', () => {
		// The cross-stack demonstration needs an item that cannot be checked by
		// running a single suite.
		const spans = issuesIn(repo.root).map(
			(item) => new Set(route(repo, item).commands.map((entry) => entry.target)).size,
		)
		expect(Math.max(...spans)).toBeGreaterThan(1)
	})

	it('passes its own gate for a change to a target the factory may build', () => {
		const buildable = issuesIn(repo.root).find((item) => {
			const decision = decide(repo, { id: item.id, paths: item.paths })
			return decision.allowed && decision.autonomy === 'build'
		})
		expect(buildable).toBeDefined()
		if (buildable === undefined) return
		expect(runGate(repo, buildable.paths).state).toBe('PASS')
	}, 180_000)
})

it.if(!present)('is skipped when the example repository is not cloned beside this one', () => {
	expect(present).toBe(false)
})
