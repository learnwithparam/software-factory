/**
 * Starting the example repository's own services for a spec.
 *
 * The console is the product the factory works on, so screenshots of it are
 * screenshots of the thing being changed rather than of the tool doing the
 * changing. Both matter, and a session shows them next to each other.
 *
 * Everything started here is stopped again, because a stale listener on a port
 * is the failure that makes the next run look broken for no reason.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { ROOT } from './shot.ts'

export const LEDGER = process.env.FACTORY_REPO
	? join(ROOT, process.env.FACTORY_REPO)
	: join(ROOT, '..', 'ledger')

export const INGEST = 'http://127.0.0.1:8081'
export const CONSOLE = 'http://127.0.0.1:3070'

const started: ChildProcess[] = []

async function waitFor(url: string, seconds = 90): Promise<void> {
	for (let i = 0; i < seconds * 2; i += 1) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
			if (response.status < 500) return
		} catch {
			// Not up yet. The loop is the wait.
		}
		await new Promise((resolve) => setTimeout(resolve, 500))
	}
	throw new Error(`${url} did not answer within ${seconds}s`)
}

function free(port: number): void {
	const result = spawnSync('bash', ['-lc', `lsof -t -nP -iTCP:${port} -sTCP:LISTEN || true`], {
		encoding: 'utf8',
	})
	for (const pid of (result.stdout ?? '').split('\n').filter(Boolean)) {
		spawnSync('kill', ['-9', pid])
	}
}

/** The ledger's own services, on the ports its README documents. */
export async function startLedger(): Promise<void> {
	free(8081)
	free(3070)

	started.push(
		spawn('bash', ['-lc', 'go run ./cmd/server'], {
			cwd: join(LEDGER, 'services', 'ingest'),
			stdio: 'ignore',
			detached: false,
		}),
	)
	await waitFor(`${INGEST}/healthz`)

	// The console shells out to the budget binary for anything in money, so it
	// has to exist before the page that shows a budget renders.
	spawnSync('bash', ['-lc', 'cargo build --quiet'], { cwd: join(LEDGER, 'services', 'budget') })

	started.push(
		spawn('bash', ['-lc', 'bun run dev'], {
			cwd: join(LEDGER, 'apps', 'console'),
			stdio: 'ignore',
			detached: false,
		}),
	)
	await waitFor(CONSOLE)
}

export function stopLedger(): void {
	for (const child of started) child.kill('SIGTERM')
	started.length = 0
	free(8081)
	free(3070)
}
