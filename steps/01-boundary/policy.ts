/**
 * Boundary: deciding what a task may attempt before anything runs.
 *
 * The charter is the only source. It is read on every decision rather than
 * cached, because a policy that is loaded once is a policy that stops describing
 * the team the moment somebody edits it.
 *
 * Every failure here is loud. A charter that cannot be parsed refuses every
 * task, because a policy engine that silently permits everything is worse than
 * having no policy at all.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, loadGraph, reach, type Autonomy, type Target } from '../lib/graph.ts'

export const CHARTER = join(ROOT, 'steps/01-boundary/CHARTER.md')

export interface ProtectedPath {
	readonly glob: string
	readonly reason: string
}

export interface Charter {
	readonly tier: string
	readonly reviewQueueCap: number
	readonly protectedPaths: readonly ProtectedPath[]
}

export function loadCharter(path: string = CHARTER): Charter {
	const text = readFileSync(path, 'utf8')

	const tier = /^\s*`?TIER:\s*([a-z-]+)`?\s*$/m.exec(text)?.[1]
	if (tier === undefined) throw new Error(`${path} declares no TIER`)

	const cap = /`?STOP_IF:\s*awaiting_review\s*>=\s*(\d+)`?/.exec(text)?.[1]
	if (cap === undefined) throw new Error(`${path} declares no review queue cap`)

	const block = /```protected\n([\s\S]*?)```/.exec(text)?.[1]
	if (block === undefined) throw new Error(`${path} declares no protected block`)

	const protectedPaths = block
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			// Every line is a glob and the reason it is protected, separated by a
			// hash. Requiring the reason is what stops the list growing silently.
			const at = line.indexOf('#')
			const glob = at === -1 ? '' : line.slice(0, at).trim()
			const reason = at === -1 ? '' : line.slice(at + 1).trim()
			if (!glob || !reason) throw new Error(`protected line needs a glob and a reason: ${line}`)
			return { glob, reason }
		})
	if (protectedPaths.length === 0) throw new Error(`${path} protects nothing`)

	return { tier, reviewQueueCap: Number(cap), protectedPaths }
}

function matches(glob: string, path: string): boolean {
	const source = glob
		.split('**')
		.map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '[^/]*'))
		.join('.*')
	return new RegExp(`^${source}$`).test(path)
}

export type Decision =
	| { allowed: true; autonomy: Autonomy; targets: string[] }
	| { allowed: false; reason: string; rule: string }

export interface Task {
	readonly item: string
	/** Paths the task expects to touch, relative to the repository root. */
	readonly paths: readonly string[]
}

/**
 * May this task proceed, and how far.
 *
 * A protected path refuses outright. Otherwise the strictest autonomy among the
 * targets the task touches wins, because a task spanning display code and the
 * money path is a money-path task.
 */
export function decide(task: Task, targets: Target[] = loadGraph(), charter: Charter = loadCharter()): Decision {
	for (const path of task.paths) {
		for (const entry of charter.protectedPaths) {
			if (matches(entry.glob, path)) {
				return { allowed: false, reason: entry.reason, rule: `protected: ${entry.glob}` }
			}
		}
	}

	// Ask the target repository which of its own targets these paths reach. Paths
	// outside it are factory code, which is protected or nothing.
	const inside = task.paths
		.filter((path) => path.startsWith('target/'))
		.map((path) => path.slice('target/'.length))

	const answer = inside.length > 0 ? reach(inside) : { paths: [], unowned: [], targets: [] }
	const orphan = answer.unowned[0]
	if (orphan !== undefined) {
		return {
			allowed: false,
			reason: 'No target owns this path, so nothing declares its checks or its autonomy.',
			rule: `unowned: target/${orphan}`,
		}
	}

	const strictness: Record<Autonomy, number> = { build: 0, propose: 1, refuse: 2 }
	let strictest: Autonomy = 'build'
	let strictestTarget: { name: string; why: string } | undefined
	const touched = new Set<string>()

	// Only the targets a path lands in directly govern autonomy. A dependant that
	// merely has to be rechecked does not make the task its kind of task.
	for (const path of inside) {
		const owner = answer.targets.find((candidate) =>
			path.startsWith(candidate.cwd === '.' ? '' : `${candidate.cwd}/`),
		)
		if (owner === undefined) continue
		touched.add(owner.name)
		if (strictness[owner.autonomy] > strictness[strictest]) {
			strictest = owner.autonomy
			strictestTarget = owner
		}
	}

	if (touched.size === 0) {
		return {
			allowed: false,
			reason: 'The task names no path inside the codebase the factory is allowed to change.',
			rule: 'no owned path',
		}
	}

	if (strictest === 'refuse') {
		return {
			allowed: false,
			reason: strictestTarget?.why ?? 'This target is marked refuse.',
			rule: `autonomy: ${strictestTarget?.name} is refuse`,
		}
	}

	return { allowed: true, autonomy: strictest, targets: [...touched].sort() }
}

/** Whether more work may start, given how many items already wait on a person. */
export function mayStart(awaitingReview: number, charter: Charter = loadCharter()): Decision {
	if (awaitingReview >= charter.reviewQueueCap) {
		return {
			allowed: false,
			reason: `${awaitingReview} items already wait on a person, and the cap is ${charter.reviewQueueCap}. The limit is review attention, not generation.`,
			rule: `STOP_IF: awaiting_review >= ${charter.reviewQueueCap}`,
		}
	}
	return { allowed: true, autonomy: 'build', targets: [] }
}
