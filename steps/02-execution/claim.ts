/**
 * Claiming an item, with nothing new to operate.
 *
 * When two runs can start for the same item, something has to decide which one
 * owns it. A lock table is a service to keep alive, with an availability story
 * and a question about what happens when a holder dies.
 *
 * A deterministic branch name pushed to the shared remote needs none of that.
 * Both runs compute the same name, the first push creates the ref, and the
 * second is rejected because it is not a fast-forward. The loser stops.
 */

import { GitError, branchFor, git } from './worktree.ts'

export type ClaimResult =
	| { owned: true; branch: string }
	| { owned: false; branch: string; reason: string }

/**
 * Try to own an item.
 *
 * The push is never forced. Forcing would make both runs think they own the
 * work, which is the exact failure this exists to prevent, so there is no flag
 * to pass.
 */
export function claim(item: string | number, remote = 'origin', cwd?: string): ClaimResult {
	const branch = branchFor(item)
	try {
		git(['push', remote, `refs/heads/${branch}:refs/heads/${branch}`], cwd)
		return { owned: true, branch }
	} catch (error) {
		if (error instanceof GitError) {
			return { owned: false, branch, reason: firstLine(error.stderr) }
		}
		throw error
	}
}

/** Who holds an item now, if anyone. */
export function heldBy(item: string | number, remote = 'origin', cwd?: string): string | undefined {
	const branch = branchFor(item)
	const output = git(['ls-remote', '--heads', remote, branch], cwd)
	return output === '' ? undefined : (output.split(/\s+/)[0] as string)
}

/** Give up an item, so a later run may take it. */
export function release(item: string | number, remote = 'origin', cwd?: string): void {
	const branch = branchFor(item)
	try {
		git(['push', remote, `:refs/heads/${branch}`], cwd)
	} catch {
		// Already gone is the state we want.
	}
}

function firstLine(text: string): string {
	return (
		text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line !== '' && !line.startsWith('To '))
			.at(0) ?? 'the remote rejected the push'
	)
}
