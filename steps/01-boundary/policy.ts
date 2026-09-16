/**
 * Boundary: deciding what a task may attempt, in whichever repository this
 * factory has been pointed at.
 *
 * Nothing here names a service, a language or a directory. The rules come from
 * that repository's `.factory/charter.md` and `.factory/targets.json`, and are
 * read on every decision rather than cached, because a policy loaded once is a
 * policy that stops describing the team the moment somebody edits it.
 */

import { affected, matcher, ownerOf, unowned, type Autonomy, type Repo, type Target } from '../lib/repo.ts'

export interface Task {
	readonly id: string
	/** Paths the task expects to touch, relative to the repository root. */
	readonly paths: readonly string[]
}

export type Decision =
	| { allowed: true; autonomy: Autonomy; targets: string[]; affected: string[] }
	| { allowed: false; reason: string; rule: string }

const STRICTNESS: Record<Autonomy, number> = { build: 0, propose: 1, refuse: 2 }

/**
 * May this task proceed, and how far.
 *
 * A protected path refuses outright. Otherwise the strictest autonomy among the
 * targets the task writes to wins, because a task spanning display code and the
 * money path is a money-path task. A target that merely has to be rechecked does
 * not make the task its kind of task.
 */
export function decide(repo: Repo, task: Task): Decision {
	for (const path of task.paths) {
		for (const entry of repo.charter.protectedPaths) {
			if (matcher(entry.glob)(path)) {
				return { allowed: false, reason: entry.reason, rule: `protected: ${entry.glob}` }
			}
		}
	}

	if (task.paths.length === 0) {
		return {
			allowed: false,
			reason: 'The task names no path, so nothing decides which rules or checks apply to it.',
			rule: 'no declared paths',
		}
	}

	const orphan = unowned(task.paths, repo.targets)[0]
	if (orphan !== undefined) {
		return {
			allowed: false,
			reason: 'No target owns this path, so nothing declares its checks or its autonomy.',
			rule: `unowned: ${orphan}`,
		}
	}

	const written: Target[] = []
	for (const path of task.paths) {
		const owner = ownerOf(path, repo.targets)
		if (owner !== undefined && !written.includes(owner)) written.push(owner)
	}

	const strictest = written.reduce((worst, target) =>
		STRICTNESS[target.autonomy] > STRICTNESS[worst.autonomy] ? target : worst,
	)

	if (strictest.autonomy === 'refuse') {
		return {
			allowed: false,
			reason: strictest.why,
			rule: `autonomy: ${strictest.name} is refuse`,
		}
	}

	return {
		allowed: true,
		autonomy: strictest.autonomy,
		targets: written.map((target) => target.name).sort(),
		affected: affected(task.paths, repo.targets).map((target) => target.name),
	}
}

/** Whether more work may start, given how many items already wait on a person. */
export function mayStart(repo: Repo, awaitingReview: number): Decision {
	const cap = repo.charter.reviewQueueCap
	if (awaitingReview >= cap) {
		return {
			allowed: false,
			reason: `${awaitingReview} items already wait on a person, and the cap is ${cap}. The limit is review attention, not generation.`,
			rule: `STOP_IF: awaiting_review >= ${cap}`,
		}
	}
	return { allowed: true, autonomy: 'build', targets: [], affected: [] }
}
