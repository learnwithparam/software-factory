/**
 * Reading a repository's `.factory` directory.
 *
 * This is the only thing the factory knows about any codebase. Point it at a
 * different repository and it reads that one's charter, graph and skills, and
 * behaves differently. Nothing in the factory names a service, a language or a
 * directory belonging to any particular project.
 *
 * The split is deliberate: the repository owns the facts, the factory owns the
 * logic. A repository that had to ship its own path matcher would be a
 * repository that can disagree with the factory about who owns a file.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export const FACTORY_DIR = '.factory'

export type Autonomy = 'build' | 'propose' | 'refuse'

export interface Target {
	readonly name: string
	readonly paths: readonly string[]
	readonly dependsOn: readonly string[]
	readonly autonomy: Autonomy
	readonly why: string
	readonly cwd: string
	readonly commands: Readonly<Record<string, string>>
}

export interface ProtectedPath {
	readonly glob: string
	readonly reason: string
}

export interface Charter {
	readonly tier: string
	readonly reviewQueueCap: number
	readonly protectedPaths: readonly ProtectedPath[]
}

export interface Skill {
	readonly name: string
	readonly when: string
	readonly outcome: string
	readonly body: string
	/** Whether it came from the repository or from the factory's defaults. */
	readonly origin: 'repo' | 'default'
}

export interface Repo {
	/** Absolute path to the repository root. */
	readonly root: string
	readonly charter: Charter
	readonly targets: Target[]
	readonly skills: Skill[]
}

export class NotConfigured extends Error {
	constructor(root: string, detail: string) {
		super(`${root} is not configured for a factory: ${detail}`)
		this.name = 'NotConfigured'
	}
}

/** Where the factory should look, unless told otherwise. */
export function repoRoot(given?: string): string {
	const chosen = given ?? process.env.FACTORY_REPO
	if (chosen === undefined || chosen === '') {
		throw new NotConfigured('no repository', 'pass --repo or set FACTORY_REPO')
	}
	return isAbsolute(chosen) ? chosen : resolve(process.cwd(), chosen)
}

export function isConfigured(root: string): boolean {
	return existsSync(join(root, FACTORY_DIR, 'charter.md'))
}

/**
 * Parse a charter.
 *
 * Every failure is loud. A charter that cannot be read refuses every task,
 * because a policy engine that silently permits everything is worse than having
 * no policy at all.
 */
export function readCharter(root: string): Charter {
	const path = join(root, FACTORY_DIR, 'charter.md')
	if (!existsSync(path)) throw new NotConfigured(root, `no ${FACTORY_DIR}/charter.md`)
	const text = readFileSync(path, 'utf8')

	const tier = /^\s*`?TIER:\s*([a-z-]+)`?\s*$/m.exec(text)?.[1]
	if (tier === undefined) throw new NotConfigured(root, 'the charter declares no TIER')

	const cap = /`?STOP_IF:\s*awaiting_review\s*>=\s*(\d+)`?/.exec(text)?.[1]
	if (cap === undefined) throw new NotConfigured(root, 'the charter declares no review queue cap')

	const block = /```protected\n([\s\S]*?)```/.exec(text)?.[1]
	if (block === undefined) throw new NotConfigured(root, 'the charter declares no protected block')

	const protectedPaths = block
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			// A glob and the reason it is protected, separated by a hash. Requiring
			// the reason is what stops the list growing without anyone saying why.
			const at = line.indexOf('#')
			const glob = at === -1 ? '' : line.slice(0, at).trim()
			const reason = at === -1 ? '' : line.slice(at + 1).trim()
			if (!glob || !reason) throw new NotConfigured(root, `protected line needs a glob and a reason: ${line}`)
			return { glob, reason }
		})
	if (protectedPaths.length === 0) throw new NotConfigured(root, 'the charter protects nothing')

	return { tier, reviewQueueCap: Number(cap), protectedPaths }
}

export function readTargets(root: string): Target[] {
	const path = join(root, FACTORY_DIR, 'targets.json')
	if (!existsSync(path)) throw new NotConfigured(root, `no ${FACTORY_DIR}/targets.json`)
	const file = JSON.parse(readFileSync(path, 'utf8')) as {
		targets?: Record<string, Omit<Target, 'name'>>
	}
	const entries = Object.entries(file.targets ?? {})
	if (entries.length === 0) throw new NotConfigured(root, 'targets.json declares no targets')
	return entries.map(([name, rest]) => ({ name, ...rest }))
}

function parseSkill(text: string, file: string, origin: Skill['origin']): Skill {
	const front = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
	if (front === null) throw new Error(`${file} has no frontmatter, so nothing can route it`)
	const fields = Object.fromEntries(
		(front[1] as string)
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const at = line.indexOf(':')
				return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
			}),
	)
	for (const required of ['name', 'when', 'outcome']) {
		if (!fields[required]) throw new Error(`${file} declares no ${required}`)
	}
	return {
		name: fields.name as string,
		when: fields.when as string,
		outcome: fields.outcome as string,
		body: (front[2] as string).trim(),
		origin,
	}
}

function readSkillsFrom(dir: string, origin: Skill['origin']): Skill[] {
	if (!existsSync(dir)) return []
	return readdirSync(dir)
		.filter((name) => name.endsWith('.md'))
		.map((name) => parseSkill(readFileSync(join(dir, name), 'utf8'), join(dir, name), origin))
}

/**
 * Skills available to a repository.
 *
 * The factory ships defaults that apply anywhere. A repository adds its own, and
 * a repository skill with the same name replaces the default, because the people
 * who own the codebase get the last word about how work is done in it.
 */
export function readSkills(root: string, defaults: string): Skill[] {
	const repo = readSkillsFrom(join(root, FACTORY_DIR, 'skills'), 'repo')
	const names = new Set(repo.map((skill) => skill.name))
	const shipped = readSkillsFrom(defaults, 'default').filter((skill) => !names.has(skill.name))
	return [...repo, ...shipped].sort((a, b) => a.name.localeCompare(b.name))
}

export function loadRepo(given?: string, defaults = defaultSkillsDir()): Repo {
	const root = repoRoot(given)
	return {
		root,
		charter: readCharter(root),
		targets: readTargets(root),
		skills: readSkills(root, defaults),
	}
}

export function defaultSkillsDir(): string {
	return join(import.meta.dir, '..', '..', 'skills')
}

/** Turn a glob such as `services/ingest/**` into a matcher. */
export function matcher(pattern: string): (path: string) => boolean {
	if (pattern === '**') return () => true
	const source = pattern
		.split('**')
		.map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '[^/]*'))
		.join('.*')
	const expression = new RegExp(`^${source}$`)
	return (path) => expression.test(path)
}

/**
 * The target owning a path.
 *
 * Returns undefined rather than guessing. A directory nobody claims has no
 * checks and no autonomy rule, and a wrong guess is silent where a refusal is not.
 */
export function ownerOf(path: string, targets: readonly Target[]): Target | undefined {
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
export function affected(paths: readonly string[], targets: readonly Target[]): Target[] {
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

export function unowned(paths: readonly string[], targets: readonly Target[]): string[] {
	return paths.filter((path) => ownerOf(path, targets) === undefined)
}

/**
 * Every file in a repository, relative to it.
 *
 * Untracked files count. A directory somebody created this morning is exactly
 * the case the ownership check exists for, and listing only tracked files would
 * let it pass until the moment it was committed.
 */
export function filesIn(root: string): string[] {
	const listing = Bun.spawnSync(['git', 'ls-files', '-co', '--exclude-standard'], { cwd: root })
	return new TextDecoder()
		.decode(listing.stdout)
		.split('\n')
		.filter(Boolean)
		.filter((file) => existsSync(join(root, file)))
}

/** Paths changed since a git ref, relative to the repository. */
export function changedSince(root: string, ref: string): string[] {
	const diff = Bun.spawnSync(['git', 'diff', '--name-only', ref], { cwd: root })
	return new TextDecoder().decode(diff.stdout).split('\n').filter(Boolean)
}
