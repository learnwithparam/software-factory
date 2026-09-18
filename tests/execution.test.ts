/**
 * Phase 8: the harness isolates, claims, and limits.
 *
 * Real worktrees on a throwaway repository, and a real push race. Nothing here
 * is simulated, because the failures this layer prevents only show up when it is.
 */

import { afterAll, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { claim } from '../steps/02-execution/claim.ts'
import {
	LimitExceeded,
	checkCommand,
	checkNetwork,
	checkWrite,
	profileFor,
} from '../steps/02-execution/limits.ts'
import { WORKTREES, branchFor, create, git, list, remove, status } from '../steps/02-execution/worktree.ts'

const throwaway: string[] = []

function scratch(prefix: string): string {
	const path = mkdtempSync(join(tmpdir(), prefix))
	throwaway.push(path)
	return path
}

/** A small git repository with one commit, standing in for any codebase. */
function repository(): string {
	const root = scratch('factory-repo-')
	git(['init', '-q', '-b', 'main', root], tmpdir())
	writeFileSync(join(root, 'README.md'), '# scratch\n')
	git(['add', '-A'], root)
	git(['-c', 'user.email=lab@example.com', '-c', 'user.name=Lab', 'commit', '-qm', 'seed'], root)
	return root
}

afterAll(() => {
	// create() puts worktrees under WORKTREES, outside the scratch repo, so they go too.
	for (const path of throwaway) {
		rmSync(path, { recursive: true, force: true })
		rmSync(join(WORKTREES, basename(path)), { recursive: true, force: true })
	}
})

it('a branch name is derived from the item, never generated', () => {
	// Two runs must compute the same name, or the remote cannot settle ownership.
	expect(branchFor(142)).toBe('fq-142')
	expect(branchFor(142)).toBe(branchFor('142'))
	expect(branchFor('Console empty state')).toBe('fq-console-empty-state')
})

it('an item with no usable name is refused rather than given a random branch', () => {
	expect(() => branchFor('   ')).toThrow()
})

it('a task gets a workspace and the repository is left exactly as it was', () => {
	const root = repository()
	const before = status(root)
	const workspace = create(root, 'one')
	writeFileSync(join(workspace.path, 'scratch.txt'), 'written by the task\n')
	expect(list(root).some((entry) => entry.branch === workspace.branch)).toBe(true)
	expect(status(root)).toBe(before)
})

it('the workspace lives outside the repository being changed', () => {
	// A factory that scatters directories through your project is one whose own
	// droppings show up in your git status.
	const root = repository()
	const workspace = create(root, 'two')
	expect(workspace.path.startsWith(root)).toBe(false)
})

it('creating the same workspace twice resumes instead of failing', () => {
	const root = repository()
	expect(create(root, 'three').path).toBe(create(root, 'three').path)
})

it('removing a workspace leaves nothing behind', () => {
	const root = repository()
	create(root, 'four')
	remove(root, 'four')
	expect(list(root).some((entry) => entry.branch === branchFor('four'))).toBe(false)
})

it('two runs on one item, and only the first push wins', () => {
	const remote = scratch('factory-remote-')
	git(['init', '--bare', '-q', remote], tmpdir())
	const seed = repository()
	git(['push', '-q', remote, 'HEAD:refs/heads/main'], seed)

	const runs = [scratch('factory-run-a-'), scratch('factory-run-b-')]
	for (const run of runs) {
		git(['clone', '-q', remote, run], tmpdir())
		git(['checkout', '-qb', branchFor(99)], run)
		writeFileSync(join(run, 'work.txt'), `${run}\n`)
		git(['add', '-A'], run)
		git(['-c', 'user.email=lab@example.com', '-c', 'user.name=Lab', 'commit', '-qm', 'work'], run)
	}

	const results = runs.map((run) => claim(99, remote, run))
	expect(results.filter((result) => result.owned)).toHaveLength(1)
	const loser = results.find((result) => !result.owned)
	if (loser && !loser.owned) expect(loser.reason.length).toBeGreaterThan(0)
})

it('a write outside the task write set is refused', () => {
	expect(() => checkWrite(profileFor('display'), '/workspace', 'services/budget/src/lib.rs')).toThrow(
		LimitExceeded,
	)
})

it('a write that climbs out of the workspace is refused on the resolved path', () => {
	// Checking the string as written would let this through.
	// Not a leading '..': a path that walks out from inside is the one a string
	// check waves through, and the resolved path is what catches it.
	expect(() => checkWrite(profileFor('display'), '/workspace', 'apps/../../../etc/hosts')).toThrow(
		/outside the workspace/,
	)
})

it('a command that is not on the list is refused before it runs', () => {
	expect(() => checkCommand(profileFor('display'), 'curl https://example.com')).toThrow(/not allowed/)
})

it('the network is off unless the task is the one that needs it', () => {
	expect(() => checkNetwork(profileFor('display'), 'api.example.com')).toThrow(/network not allowed/)
	expect(() => checkNetwork(profileFor('dependencies'), 'registry.npmjs.org')).not.toThrow()
})

it('an undeclared profile is refused rather than defaulted to something permissive', () => {
	expect(() => profileFor('whatever')).toThrow(/unknown profile/)
})
