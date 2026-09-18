/**
 * Phase 5: boundary decides, using the repository's rules and no others.
 */

import { expect, it } from 'bun:test'
import { join } from 'node:path'
import { decide, mayStart } from '../steps/01-boundary/policy.ts'
import { issue, issuesIn } from '../steps/lib/issues.ts'
import { loadRepo } from '../steps/lib/repo.ts'

const SAMPLE = join(import.meta.dirname, 'fixtures', 'sample')
const repo = loadRepo(SAMPLE)

it('a task on a protected path is refused before any file is touched', () => {
	const decision = decide(repo, { id: '3', paths: ['secrets/token.txt'] })
	expect(decision.allowed).toBe(false)
	if (decision.allowed) return
	expect(decision.rule).toStartWith('protected:')
	expect(decision.reason.length).toBeGreaterThan(20)
})

it('a task in an unrestricted area may be finished unattended', () => {
	const decision = decide(repo, { id: '1', paths: ['app/page.txt'] })
	expect(decision.allowed).toBe(true)
	if (!decision.allowed) return
	expect(decision.autonomy).toBe('build')
})

it('a task spanning two targets takes the stricter autonomy', () => {
	// Touching display code and a shared library makes it a shared library task.
	const decision = decide(repo, { id: '2', paths: ['app/page.txt', 'lib/core.txt'] })
	expect(decision.allowed).toBe(true)
	if (!decision.allowed) return
	expect(decision.autonomy).toBe('propose')
})

it('a target that only has to be rechecked does not change the task kind', () => {
	// `app` depends on `lib`, but writing only to `lib` is still a lib task.
	const decision = decide(repo, { id: '2', paths: ['lib/core.txt'] })
	expect(decision.allowed).toBe(true)
	if (!decision.allowed) return
	expect(decision.targets).toEqual(['lib'])
	expect(decision.affected).toContain('app')
})

it('a path no target owns is refused rather than guessed at', () => {
	const decision = decide(repo, { id: 'x', paths: ['nowhere/thing.txt'] })
	expect(decision.allowed).toBe(false)
	if (decision.allowed) return
	expect(decision.rule).toStartWith('unowned:')
})

it('a task that names no path is refused, because nothing can assess it', () => {
	expect(decide(repo, { id: 'x', paths: [] }).allowed).toBe(false)
})

it('the review queue cap stops production when it is full', () => {
	const cap = repo.charter.reviewQueueCap
	expect(mayStart(repo, cap - 1).allowed).toBe(true)
	expect(mayStart(repo, cap).allowed).toBe(false)
})

it('every issue names the paths it expects to touch', () => {
	// A task with no declared paths cannot be assessed by any rule.
	for (const item of issuesIn(SAMPLE)) expect(item.paths.length).toBeGreaterThan(0)
})

it('an issue that does not exist is an error, not an empty task', () => {
	expect(() => issue(SAMPLE, 'no-such-issue')).toThrow()
})
