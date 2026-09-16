/**
 * The ownership graph, read by the codebase it describes.
 *
 * This lives in the target repository on purpose. The factory does not
 * reimplement path matching; it runs this tool and reads the answer, the same
 * way it runs the test commands declared here rather than guessing them. One
 * implementation, so the gate and the factory can never disagree about who owns
 * a file.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = join(import.meta.dir, '..')

export type Autonomy = 'build' | 'propose' | 'refuse'

export interface Target {
	readonly name: string
	readonly paths: readonly string[]
	readonly dependsOn: readonly string[]
	readonly autonomy: Autonomy
	readonly why: string
	readonly commands: Readonly<Record<string, string>>
	readonly cwd: string
}

export function loadGraph(root: string = ROOT): Target[] {
	const path = join(root, 'project-graph.json')
	const file = JSON.parse(readFileSync(path, 'utf8')) as {
		targets: Record<string, Omit<Target, 'name'>>
	}
	const targets = Object.entries(file.targets).map(([name, rest]) => ({ name, ...rest }))
	if (targets.length === 0) throw new Error(`${path} declares no targets`)
	return targets
}

/** Turn a glob such as `services/ingest/**` into a matcher. */
export function matcher(pattern: string): (path: string) => boolean {
	const source = pattern
		.split('**')
		.map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '[^/]*'))
		.join('.*')
	const expression = new RegExp(`^${source}$`)
	return (path) => expression.test(path)
}

/**
 * The target that owns a path.
 *
 * Returns undefined rather than guessing. A directory nobody claims has no
 * checks and no autonomy rule, and a wrong guess is silent where a refusal is not.
 */
export function ownerOf(path: string, targets: Target[]): Target | undefined {
	let best: { target: Target; specificity: number } | undefined
	for (const target of targets) {
		for (const pattern of target.paths) {
			if (!matcher(pattern)(path)) continue
			// The longest literal prefix wins, so a nested target beats its parent.
			const specificity = (pattern.split('**')[0] as string).length
			if (best === undefined || specificity > best.specificity) best = { target, specificity }
		}
	}
	return best?.target
}

/** Every target that must be rechecked when these paths change, dependants included. */
export function affected(paths: string[], targets: Target[]): Target[] {
	const reached = new Set<string>()
	for (const path of paths) {
		const owner = ownerOf(path, targets)
		if (owner) reached.add(owner.name)
	}
	let growing = true
	while (growing) {
		growing = false
		for (const target of targets) {
			if (reached.has(target.name)) continue
			if (target.dependsOn.some((name) => reached.has(name))) {
				reached.add(target.name)
				growing = true
			}
		}
	}
	return targets.filter((target) => reached.has(target.name))
}

export function unowned(files: string[], targets: Target[]): string[] {
	return files.filter((file) => ownerOf(file, targets) === undefined)
}

/**
 * Every file in this repository, relative to it.
 *
 * Untracked files count. A directory somebody created this morning is exactly
 * the case the ownership check exists for, and listing only tracked files would
 * let it pass until the moment it was committed.
 */
export function files(root: string = ROOT): string[] {
	const listing = Bun.spawnSync(['git', 'ls-files', '-co', '--exclude-standard'], { cwd: root })
	return new TextDecoder()
		.decode(listing.stdout)
		.split('\n')
		.filter(Boolean)
		.filter((file) => existsSync(join(root, file)))
}

/** Paths changed since a git ref, relative to this repository. */
export function changedSince(ref: string, root: string = ROOT): string[] {
	const diff = Bun.spawnSync(['git', 'diff', '--name-only', ref, '--', '.'], { cwd: root })
	const prefix = 'target/'
	return new TextDecoder()
		.decode(diff.stdout)
		.split('\n')
		.filter(Boolean)
		.map((path) => (path.startsWith(prefix) ? path.slice(prefix.length) : path))
}
