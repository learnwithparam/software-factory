/**
 * What a task may reach once it is inside its workspace.
 *
 * Isolation answered where the work happens. Limits answer what it can touch
 * from there: which paths may be written, which commands may run, whether
 * anything may leave the machine.
 *
 * Two rules keep this from being theatre. The limits are declared here, where a
 * reviewer reads them, rather than inside instructions to the agent where they
 * are a suggestion. And exceeding one ends the run, because a warning nobody
 * reads is not a limit.
 */

import { relative, resolve } from 'node:path'

export interface Limits {
	/** Globs, relative to the workspace, that may be written. */
	readonly write: readonly string[]
	/** The exact first word of every command that may run. */
	readonly commands: readonly string[]
	/** Whether anything may leave the machine. */
	readonly network: boolean
	readonly why: string
}

/**
 * Limits by kind of task, not one global setting.
 *
 * The task that regenerates a lockfile genuinely needs the network. The task
 * that edits a component does not, and giving it the network anyway is how the
 * rule stops meaning anything.
 */
export const PROFILES: Record<string, Limits> = {
	display: {
		write: ['apps/console/**'],
		commands: ['bun', 'git', 'node'],
		network: false,
		why: 'Display work reads the ledger and renders it. It needs no network and no other service.',
	},
	service: {
		write: ['services/ingest/**'],
		commands: ['go', 'gofmt', 'git'],
		network: false,
		why: 'Ledger work compiles and tests in place. Modules are already vendored in the image.',
	},
	contract: {
		write: ['packages/contracts/**', 'services/ingest/**', 'apps/console/**'],
		commands: ['bun', 'go', 'gofmt', 'cargo', 'git'],
		network: false,
		why: 'A contract change has to update every side of it, so its write set spans three targets on purpose.',
	},
	dependencies: {
		write: ['**/bun.lock', '**/package.json', '**/Cargo.lock', '**/go.sum'],
		commands: ['bun', 'cargo', 'go', 'git'],
		network: true,
		why: 'The one task that needs the network. Naming it here is what keeps the network off everything else.',
	},
}

export class LimitExceeded extends Error {
	constructor(
		readonly rule: string,
		readonly detail: string,
	) {
		super(`${rule}: ${detail}`)
		this.name = 'LimitExceeded'
	}
}

function matches(glob: string, path: string): boolean {
	const source = glob
		.split('**')
		.map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '[^/]*'))
		.join('.*')
	return new RegExp(`^${source}$`).test(path)
}

/**
 * May this task write this file?
 *
 * The path is resolved before it is checked. A write expressed with enough
 * parent segments to climb out of the workspace is the first thing anyone tries,
 * and comparing the string as given would let it through.
 */
export function checkWrite(limits: Limits, workspace: string, path: string): void {
	const absolute = resolve(workspace, path)
	const inside = relative(workspace, absolute)
	if (inside.startsWith('..') || inside === '') {
		throw new LimitExceeded('outside the workspace', path)
	}
	if (!limits.write.some((glob) => matches(glob, inside))) {
		throw new LimitExceeded('not in the write set', inside)
	}
}

/** May this task run this command? */
export function checkCommand(limits: Limits, command: string): void {
	const program = command.trim().split(/\s+/)[0] ?? ''
	if (!limits.commands.includes(program)) {
		throw new LimitExceeded('command not allowed', program === '' ? '(empty)' : program)
	}
}

/** May this task reach the network? */
export function checkNetwork(limits: Limits, host: string): void {
	if (!limits.network) throw new LimitExceeded('network not allowed', host)
}

/** The profile for a task, refusing rather than guessing at an unknown one. */
export function profileFor(name: string): Limits {
	const limits = PROFILES[name]
	if (limits === undefined) {
		throw new LimitExceeded('unknown profile', `${name}. Declare it in limits.ts before using it.`)
	}
	return limits
}
