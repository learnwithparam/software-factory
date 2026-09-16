/**
 * The executor is an interface.
 *
 * Nothing in the factory knows which agent runs the work. An executor is any
 * command that accepts a prompt on standard input, does something to a working
 * directory, and exits.
 *
 * That indirection buys three things. The loop can be exercised against a
 * recorded run with no model and no network, which is why `make check` costs
 * nothing. A different agent can be swapped in without touching policy. And the
 * same task can be replayed to compare two agents on identical input.
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export const RECORDINGS = join(import.meta.dir, '..', '..', 'recordings')

export interface Request {
	readonly repo: string
	readonly issueId: string
	readonly role: 'doer' | 'tester'
	readonly prompt: string
	readonly cwd: string
}

export interface Response {
	readonly text: string
	readonly toolCalls: number
	readonly tokensIn: number
	readonly tokensOut: number
	readonly costMinor: number
	/** Files the run changed, relative to the repository root. */
	readonly changedFiles: string[]
}

export interface Executor {
	readonly name: string
	run(request: Request): Promise<Response>
}

export function recordingPath(repo: string, issueId: string, role: string): string {
	return join(RECORDINGS, basename(repo), `${issueId}.${role}.json`)
}

/**
 * Replays what an agent did, so the loop can be exercised for free.
 *
 * A missing recording is an error rather than an empty answer. An executor that
 * silently returns nothing turns every test below it into a test of nothing.
 */
export function replayExecutor(): Executor {
	return {
		name: 'replay',
		async run(request) {
			const path = recordingPath(request.repo, request.issueId, request.role)
			if (!existsSync(path)) {
				throw new Error(`no recording at ${path}. Record one with make record, or the loop tests nothing.`)
			}
			return JSON.parse(readFileSync(path, 'utf8')) as Response
		},
	}
}

/**
 * Runs a real coding agent.
 *
 * The prompt goes in on standard input, which is the only thing the factory
 * assumes. Anything honouring that contract drops in here unchanged.
 */
export function commandExecutor(command: string[]): Executor {
	return {
		name: command[0] ?? 'command',
		async run(request) {
			const child = Bun.spawn(command, {
				cwd: request.cwd,
				stdin: new TextEncoder().encode(request.prompt),
				stdout: 'pipe',
				stderr: 'pipe',
			})
			const text = await new globalThis.Response(child.stdout).text()
			const code = await child.exited
			if (code !== 0) {
				const stderr = await new globalThis.Response(child.stderr).text()
				throw new Error(`${this.name} exited ${code}: ${stderr.trim().slice(0, 400)}`)
			}
			return {
				text,
				toolCalls: 0,
				tokensIn: 0,
				tokensOut: 0,
				costMinor: 0,
				changedFiles: changedIn(request.cwd),
				...usageFooter(text),
			}
		},
	}
}

/** What the agent actually changed, read from git rather than from its account. */
function changedIn(cwd: string): string[] {
	const result = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd })
	return new TextDecoder()
		.decode(result.stdout)
		.split('\n')
		.filter(Boolean)
		.map((line) => line.slice(3).trim())
}

/**
 * An agent may report usage in a final JSON line. Absence is recorded as zero
 * rather than guessed at, because an invented token count is worse than none.
 */
function usageFooter(text: string): Partial<Response> {
	const last = text.trim().split('\n').at(-1) ?? ''
	if (!last.startsWith('{')) return {}
	try {
		return JSON.parse(last) as Partial<Response>
	} catch {
		return {}
	}
}

export function executorFromEnv(): Executor {
	const configured = process.env.FACTORY_EXECUTOR
	if (configured === undefined || configured === '' || configured === 'replay') return replayExecutor()
	return commandExecutor(configured.split(' '))
}
