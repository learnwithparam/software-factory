/**
 * Phase 4: the factory reads a repository and knows nothing else about it.
 *
 * Everything here runs against tests/fixtures/sample, a repository invented for
 * this file. If these tests ran against the demo codebase they would prove the
 * factory works on one repository. Run against something it was not written for,
 * they prove it reads whatever it is pointed at.
 */

import { expect, it } from 'bun:test'
import { join } from 'node:path'
import {
	NotConfigured,
	affected,
	filesIn,
	loadRepo,
	matcher,
	ownerOf,
	readCharter,
	unowned,
} from '../steps/lib/repo.ts'

const SAMPLE = join(import.meta.dirname, 'fixtures', 'sample')
const repo = loadRepo(SAMPLE)

it('a repository is described entirely by its own .factory directory', () => {
	expect(repo.charter.tier).toBe('supervised')
	expect(repo.charter.reviewQueueCap).toBeGreaterThan(0)
	expect(repo.targets.length).toBeGreaterThan(1)
})

it('a repository with no .factory is refused rather than given defaults', () => {
	// Guessing a policy is worse than having none, because nobody chose it.
	expect(() => loadRepo(join(import.meta.dirname, 'fixtures'))).toThrow(NotConfigured)
})

it('a charter that cannot be parsed refuses everything rather than permitting it', () => {
	// Half a policy is not a policy. A charter missing its protected block must
	// refuse, not proceed on the part it managed to read.
	expect(() => readCharter(join(import.meta.dirname, 'fixtures', 'broken'))).toThrow(NotConfigured)
	expect(() => readCharter('/nonexistent')).toThrow(NotConfigured)
})

it('every protected path carries the reason it is protected', () => {
	const silent = repo.charter.protectedPaths.filter((entry) => entry.reason.trim().length < 15)
	expect(silent.map((entry) => entry.glob)).toEqual([])
})

it('the owner of a path is the target that claims it', () => {
	expect(ownerOf('lib/core.txt', repo.targets)?.name).toBe('lib')
	expect(ownerOf('app/page.txt', repo.targets)?.name).toBe('app')
})

it('a path no target claims has no owner, rather than a guessed one', () => {
	expect(ownerOf('nowhere/thing.txt', repo.targets)).toBeUndefined()
	expect(unowned(['nowhere/thing.txt'], repo.targets)).toEqual(['nowhere/thing.txt'])
})

it('every file in the repository is claimed by exactly one target', () => {
	expect(unowned(filesIn(repo.root), repo.targets)).toEqual([])
})

it('a change to a shared target reaches everything built on it', () => {
	// The failure this prevents: one suite runs, passes, and the break ships.
	const names = affected(['lib/core.txt'], repo.targets).map((target) => target.name)
	expect(names).toContain('lib')
	expect(names).toContain('app')
})

it('a change local to one target reaches only that target', () => {
	expect(affected(['app/page.txt'], repo.targets).map((target) => target.name)).toEqual(['app'])
})

it('a glob matches a tree but not a sibling sharing its prefix', () => {
	const match = matcher('lib/**')
	expect(match('lib/core.txt')).toBe(true)
	expect(match('lib/deep/nested.txt')).toBe(true)
	expect(match('library/core.txt')).toBe(false)
})

it('a repository skill replaces a shipped one of the same name', () => {
	// The people who own the codebase get the last word on how work is done in it.
	const byName = new Map(repo.skills.map((skill) => [skill.name, skill]))
	expect(byName.get('local-convention')?.origin).toBe('repo')
	expect(byName.get('review-an-agent-diff')?.origin).toBe('default')
})
