/**
 * Execution: a place for one task to work that is not your checkout.
 *
 * Git already solves this. A worktree is a second checkout of the same
 * repository at a different commit, sharing one object store, created in about a
 * second and removed as easily. Each task gets one and it is thrown away when
 * the task ends.
 *
 * What this buys: your branch is never touched, two tasks cannot interfere, a
 * failed run leaves a directory you can look inside, and cleanup is one command
 * rather than a careful sequence.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../lib/graph.ts'

export const WORKTREES = join(ROOT, '.worktrees')

export interface Workspace {
	readonly item: string
	readonly branch: string
	readonly path: string
}

export class GitError extends Error {
	constructor(
		readonly command: string,
		readonly stderr: string,
	) {
		super(`git ${command} failed: ${stderr.trim()}`)
		this.name = 'GitError'
	}
}

export function git(args: string[], cwd: string = ROOT): string {
	const result = Bun.spawnSync(['git', ...args], { cwd })
	const stderr = new TextDecoder().decode(result.stderr)
	if (result.exitCode !== 0) throw new GitError(args.join(' '), stderr)
	return new TextDecoder().decode(result.stdout).trim()
}

/**
 * The branch name for an item.
 *
 * Derived, never random. Two runs that both wake up for item 142 compute the
 * same name, which is what lets the remote decide which of them owns the work.
 */
export function branchFor(item: string | number): string {
	const slug = String(item)
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-|-$/g, '')
	if (slug === '') throw new Error('an item needs a name a branch can be derived from')
	return `fq-${slug}`
}

export function workspaceFor(item: string | number): Workspace {
	const branch = branchFor(item)
	return { item: String(item), branch, path: join(WORKTREES, branch) }
}

export function exists(item: string | number): boolean {
	return existsSync(workspaceFor(item).path)
}

/**
 * Create a workspace for one task.
 *
 * Creating one that already exists is not an error. A retried delivery must be
 * able to resume rather than refuse, which is the same reason the branch name is
 * derived rather than generated.
 */
export function create(item: string | number, from = 'HEAD'): Workspace {
	const workspace = workspaceFor(item)
	if (existsSync(workspace.path)) return workspace
	mkdirSync(WORKTREES, { recursive: true })

	const branches = git(['branch', '--list', workspace.branch])
	if (branches.trim() === '') {
		git(['worktree', 'add', '-b', workspace.branch, workspace.path, from])
	} else {
		git(['worktree', 'add', workspace.path, workspace.branch])
	}
	return workspace
}

/** Remove a workspace and its branch, leaving nothing behind. */
export function remove(item: string | number, { keepBranch = false } = {}): void {
	const workspace = workspaceFor(item)
	if (existsSync(workspace.path)) {
		git(['worktree', 'remove', '--force', workspace.path])
	}
	git(['worktree', 'prune'])
	if (!keepBranch) {
		try {
			git(['branch', '-D', workspace.branch])
		} catch {
			// A branch that was never created, or is already gone, is the state we want.
		}
	}
	rmSync(workspace.path, { recursive: true, force: true })
}

/** Every workspace this harness currently holds. */
export function list(): Workspace[] {
	const output = git(['worktree', 'list', '--porcelain'])
	const workspaces: Workspace[] = []
	for (const block of output.split('\n\n')) {
		const path = /^worktree (.+)$/m.exec(block)?.[1]
		const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
		if (path === undefined || branch === undefined) continue
		if (!path.startsWith(WORKTREES)) continue
		workspaces.push({ item: branch.replace(/^fq-/, ''), branch, path })
	}
	return workspaces
}

/** Is the main checkout exactly as the person left it? */
export function mainCheckoutIsClean(): boolean {
	return git(['status', '--porcelain', '--untracked-files=no']) === ''
}
