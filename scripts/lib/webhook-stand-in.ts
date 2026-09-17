/**
 * The deliveries GitHub would have made, signed and posted locally.
 *
 * Mastra Factory builds its board from webhook events: `issues.opened` puts an
 * issue on the work board, `pull_request.opened` puts a pull request on the
 * review board. GitHub refuses to register a webhook it cannot reach, and it
 * cannot reach localhost, so a self-hosted lab receives none of them.
 *
 * Polling does not stand in. The reconcile worker sweeps every sixty seconds and
 * its counts are updated, closed and failed; there is no created. It patches
 * items that already exist and never makes one.
 *
 * An earlier version of this file wrote work-item rows straight through the API
 * instead. They appeared in `/work-items` and the board stayed empty, because
 * the Intake column is drawn from what intake delivered rather than from what is
 * in the table, so the flagship screenshot was a picture of "No intake sources".
 * Posting the real delivery runs the real rules and the board behaves exactly as
 * it does in production, which is the only version worth teaching from.
 *
 * The signature is the contract: sha256 HMAC of the exact bytes sent, with the
 * app's webhook secret. Re-serialising the payload after signing breaks it.
 *
 * Two blocks a hand-built payload forgets and GitHub never does. `installation`
 * is how the server decides which installation, and therefore which
 * organisation, an event belongs to: without it the delivery is accepted, logged
 * with `installationId: undefined`, and dropped. `sender` is who did it, which
 * the rules read to decide whether the author is trusted.
 */

import { createHmac, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'

function secret(): string {
	const path = join(homedir(), '.config', 'lwp-secrets', 'factory.env')
	const value = readFileSync(path, 'utf8')
		.split('\n')
		.map((line) => /^GITHUB_APP_WEBHOOK_SECRET=(.*)$/.exec(line.trim())?.[1])
		.find((found): found is string => found !== undefined)
		?.replace(/^["'](.*)["']$/, '$1')
	if (value === undefined || value === '') throw new Error(`GITHUB_APP_WEBHOOK_SECRET is not in ${path}`)
	return value
}

function gh(args: readonly string[]): string {
	return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
}

/**
 * Post one delivery, signed over the exact bytes.
 *
 * Returns what the server answered so a caller can fail loudly. A 401 here means
 * the secret on disk and the secret the server booted with disagree.
 */
async function deliver(event: 'issues' | 'pull_request', installation: number, payload: Record<string, unknown>): Promise<void> {
	const body = JSON.stringify({ ...payload, installation: { id: installation }, sender: sender() })
	const signature = createHmac('sha256', secret()).update(body).digest('hex')

	const response = await fetch(`${BASE}/web/github/webhook`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-github-event': event,
			'x-github-delivery': randomUUID(),
			'x-hub-signature-256': `sha256=${signature}`,
		},
		body,
	})
	if (!response.ok) {
		throw new Error(`${event} delivery answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
	}
}

let cachedSender: unknown

/** Who the event is from. The rules read this to decide whether to trust the author. */
function sender(): unknown {
	cachedSender ??= JSON.parse(gh(['api', 'user']))
	return cachedSender
}

/** The repository block every delivery carries, straight from the API. */
function repository(repo: string): unknown {
	return JSON.parse(gh(['api', `repos/${repo}`]))
}

/** Every open issue, delivered as `issues.opened`. */
export async function seedIssues(repo: string, installation: number): Promise<number> {
	const repo_ = repository(repo)
	const numbers = gh(['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number', '--jq', '.[].number'])
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map(Number)
		.sort((a, b) => a - b)

	for (const number of numbers) {
		// The issue as GitHub reports it, so nothing here invents a field shape.
		const issue = JSON.parse(gh(['api', `repos/${repo}/issues/${number}`]))
		await deliver('issues', installation, { action: 'opened', issue, repository: repo_ })
	}
	return numbers.length
}

/** One pull request, delivered as `pull_request.opened`. */
export async function announcePullRequest(repo: string, number: number, installation: number): Promise<void> {
	const pull = JSON.parse(gh(['api', `repos/${repo}/pulls/${number}`]))
	await deliver('pull_request', installation, { action: 'opened', number, pull_request: pull, repository: repository(repo) })
}

/** Every open pull request, delivered as `pull_request.opened`. */
export async function seedPullRequests(repo: string, installation: number): Promise<number> {
	const numbers = gh(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number', '--jq', '.[].number'])
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map(Number)
		.sort((a, b) => a - b)

	for (const number of numbers) await announcePullRequest(repo, number, installation)
	return numbers.length
}

/**
 * Which installation the deliveries claim to come from.
 *
 * Asked of the Factory rather than of GitHub: `gh api /app/installations` needs
 * the app's own JWT, which a user token cannot mint, and the server has already
 * done that handshake.
 */
export async function installationFor(cookie: string): Promise<number> {
	const response = await fetch(`${BASE}/web/github/status`, { headers: { cookie, accept: 'application/json' } })
	if (!response.ok) throw new Error(`github status answered ${response.status}`)
	const { installations } = (await response.json()) as { installations?: Array<{ installationId: number }> }
	const first = installations?.[0]
	if (first === undefined) throw new Error('GitHub is connected but no installation is visible')
	return first.installationId
}
