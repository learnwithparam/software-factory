/**
 * Asking the target repository who owns what.
 *
 * The factory does not match paths itself. It runs `tools/affected.ts` inside
 * the target and reads the answer, the same way it runs the test commands the
 * target declares rather than guessing them. One implementation of ownership,
 * living with the code it describes, so the gate and the factory cannot come to
 * different conclusions about the same file.
 *
 * Reading `project-graph.json` directly is fine and happens below: it is a
 * declaration, not logic. Reimplementing the matching would be the duplication.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = join(import.meta.dir, '..', '..')
export const TARGET = join(ROOT, 'target')

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

export interface Reach {
	readonly paths: string[]
	readonly unowned: string[]
	readonly targets: Array<{
		readonly name: string
		readonly autonomy: Autonomy
		readonly why: string
		readonly cwd: string
		readonly commands: Readonly<Record<string, string>>
	}>
}

export function loadGraph(root: string = TARGET): Target[] {
	const path = join(root, 'project-graph.json')
	const file = JSON.parse(readFileSync(path, 'utf8')) as {
		targets: Record<string, Omit<Target, 'name'>>
	}
	const targets = Object.entries(file.targets).map(([name, rest]) => ({ name, ...rest }))
	if (targets.length === 0) throw new Error(`${path} declares no targets`)
	return targets
}

function ask(args: string[], root: string = TARGET): Reach {
	const result = Bun.spawnSync(['bun', 'tools/affected.ts', ...args, '--json'], { cwd: root })
	const stdout = new TextDecoder().decode(result.stdout).trim()
	if (stdout === '') {
		const stderr = new TextDecoder().decode(result.stderr).trim()
		throw new Error(`the ownership tool in ${root} answered nothing: ${stderr}`)
	}
	return JSON.parse(stdout) as Reach
}

/** Which targets these paths reach, with the commands that check them. */
export function reach(paths: string[], root: string = TARGET): Reach {
	return ask(['--paths', paths.join(',')], root)
}

/** Which targets a change since this ref reaches. */
export function reachSince(ref: string, root: string = TARGET): Reach {
	return ask(['--since', ref], root)
}

/** Every target, with every command, for a full run. */
export function reachAll(root: string = TARGET): Reach {
	return ask(['--all'], root)
}

/** The target owning one path, or undefined when nothing claims it. */
export function ownerOf(path: string, root: string = TARGET): string | undefined {
	const result = Bun.spawnSync(['bun', 'tools/affected.ts', '--owner', path, '--json'], { cwd: root })
	const stdout = new TextDecoder().decode(result.stdout).trim()
	if (stdout === '') return undefined
	return (JSON.parse(stdout) as { owner: string | null }).owner ?? undefined
}
