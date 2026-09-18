/**
 * Execution: a place for one task to work that is not your checkout.
 *
 * Git already solves this. A worktree is a second checkout of the same
 * repository at a different commit, sharing one object store, created in about a
 * second and removed as easily.
 *
 * The workspaces live under the factory, never inside the repository being
 * changed. A factory that scatters directories through your project is one you
 * have to clean up after, and one whose own droppings show up in `git status`.
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'

export const WORKTREES =
	process.env.FACTORY_WORKTREES ?? join(import.meta.dirname, '..', '..', '.worktrees')

export interface Workspace {
	readonly item: string
	readonly branch: string
	readonly path: string
	readonly repo: string
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

export function git(args: string[], cwd: string): string {
	const result = Bun.spawnSync(['git', ...args], { cwd })
	if (result.exitCode !== 0) {
		throw new GitError(args.join(' '), new TextDecoder().decode(result.stderr))
	}
	return new TextDecoder().decode(result.stdout).trim()
}

/**
 * The branch name for an item.
 *
 * Derived, never random. Two runs that both wake up for the same item compute
 * the same name, which is what lets the remote decide which of them owns it.
 */
export function branchFor(item: string | number): string {
	const slug = String(item)
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-|-$/g, '')
	if (slug === '') throw new Error('an item needs a name a branch can be derived from')
	return `fq-${slug}`
}

export function workspaceFor(repo: string, item: string | number): Workspace {
	const branch = branchFor(item)
	return { item: String(item), branch, repo, path: join(WORKTREES, basename(repo), branch) }
}

/**
 * Create a workspace for one task.
 *
 * Creating one that already exists is not an error. A retried delivery has to
 * resume rather than refuse, which is the same reason the branch name is derived.
 */
export function create(repo: string, item: string | number, from = 'HEAD'): Workspace {
	const workspace = workspaceFor(repo, item)
	if (existsSync(workspace.path)) return workspace
	mkdirSync(join(WORKTREES, basename(repo)), { recursive: true })

	const existing = git(['branch', '--list', workspace.branch], repo)
	if (existing.trim() === '') {
		git(['worktree', 'add', '-b', workspace.branch, workspace.path, from], repo)
	} else {
		git(['worktree', 'add', workspace.path, workspace.branch], repo)
	}
	return workspace
}

/** Remove a workspace and its branch, leaving nothing behind. */
export function remove(repo: string, item: string | number, { keepBranch = false } = {}): void {
	const workspace = workspaceFor(repo, item)
	if (existsSync(workspace.path)) git(['worktree', 'remove', '--force', workspace.path], repo)
	git(['worktree', 'prune'], repo)
	if (!keepBranch) {
		try {
			git(['branch', '-D', workspace.branch], repo)
		} catch {
			// A branch that was never created, or is already gone, is the state we want.
		}
	}
	rmSync(workspace.path, { recursive: true, force: true })
}

/** Every workspace this factory currently holds for a repository. */
export function list(repo: string): Workspace[] {
	const output = git(['worktree', 'list', '--porcelain'], repo)
	const workspaces: Workspace[] = []
	for (const block of output.split('\n\n')) {
		const path = /^worktree (.+)$/m.exec(block)?.[1]
		const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
		if (path === undefined || branch === undefined) continue
		if (!path.startsWith(WORKTREES)) continue
		workspaces.push({ item: branch.replace(/^fq-/, ''), branch, path, repo })
	}
	return workspaces
}

/** The repository's working tree, as git reports it. */
export function status(repo: string): string {
	return git(['status', '--porcelain'], repo)
}
