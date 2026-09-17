/**
 * Every Factory action, in one file, the way factory.ts holds every selector.
 *
 * Driving goes through the API rather than the interface. Clicking is what the
 * screenshots are for; a fifteen minute run that fails because a button moved
 * teaches nobody anything, and the run is the expensive part. The specs drive
 * with these and photograph with Playwright.
 *
 * The shape of a run, learned by doing it: a stage transition emits the next
 * skill's decision, that decision waits for a person when the project has
 * autoRunEnabled off, and the skill runs once approved. So advancing is always
 * the same two beats, transition then approve, and a stage is finished when its
 * decision succeeds.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { BASE, EMAIL } from './factory.ts'

export type Role = 'triage' | 'plan' | 'work' | 'review'
export type DecisionStatus = 'pending' | 'proposed' | 'leased' | 'succeeded' | 'failed' | 'dismissed' | 'superseded' | 'retry'

export interface Decision {
	readonly id: string
	readonly workItemId: string
	readonly role: Role | null
	readonly type: string
	readonly status: DecisionStatus
	readonly attempts: number
	/**
	 * The last error text, which is retained after a retry succeeds. A decision
	 * can read succeeded and still carry one, so nothing here treats its presence
	 * as failure.
	 */
	readonly lastError?: string
}

export interface WorkItem {
	readonly id: string
	readonly title: string
	readonly board: string | null
	readonly stages: readonly string[]
	readonly revision: number
	readonly triageType: string | null
	readonly externalSource: { readonly externalId: string } | null
	readonly metadata: Record<string, unknown>
}

function secret(name: string): string {
	const path = join(homedir(), '.config', 'lwp-secrets', 'factory.env')
	const value = readFileSync(path, 'utf8')
		.split('\n')
		.map((line) => new RegExp(`^${name}=(.*)$`).exec(line.trim())?.[1])
		.find((found): found is string => found !== undefined)
		?.replace(/^["'](.*)["']$/, '$1')
	if (value === undefined) throw new Error(`${name} is not in ${path}`)
	return value
}

let signedIn: Promise<string> | undefined

/** One sign-in per process. Better Auth rate-limits it, and localhost shares one bucket. */
async function cookie(): Promise<string> {
	signedIn ??= (async () => {
		const response = await fetch(`${BASE}/auth/api/sign-in/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({ email: EMAIL, password: secret('FACTORY_USER_PASSWORD') }),
		})
		if (!response.ok) throw new Error(`sign-in answered ${response.status}`)
		return (response.headers.getSetCookie?.() ?? []).map((part) => part.split(';')[0]).join('; ')
	})()
	return signedIn
}

/**
 * Ask the server, and try again when the connection drops rather than the
 * server answering.
 *
 * A local Factory running sandboxes beside a browser occasionally stops
 * answering for a second, and Node reports that as a bare "TypeError: fetch
 * failed". Twice that ended a run six minutes in, with the work itself fine.
 *
 * Only the connection is retried. An HTTP status is the server's answer and
 * gets reported, because retrying a 422 just asks the same wrong question again.
 */
async function reach(path: string, init: RequestInit): Promise<Response> {
	let last: unknown
	for (let attempt = 0; attempt < 4; attempt += 1) {
		try {
			return await fetch(`${BASE}${path}`, init)
		} catch (error) {
			last = error
			await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
		}
	}
	throw new Error(`${init.method ?? 'GET'} ${path} never reached the server: ${(last as Error).message}`)
}

async function api<T>(path: string, init: RequestInit = {}, tolerate: readonly number[] = []): Promise<T | undefined> {
	const response = await reach(path, {
		...init,
		headers: { 'content-type': 'application/json', origin: BASE, cookie: await cookie(), ...init.headers },
	})
	const text = await response.text()
	if (tolerate.includes(response.status)) return undefined
	if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} answered ${response.status}: ${text.slice(0, 200)}`)
	return JSON.parse(text) as T
}

/** api for the calls whose answer is required. */
async function need<T>(path: string, init: RequestInit = {}): Promise<T> {
	const body = await api<T>(path, init)
	if (body === undefined) throw new Error(`${init.method ?? 'GET'} ${path} returned no body`)
	return body
}

let cached: string | undefined

export async function projectId(): Promise<string> {
	if (cached === undefined) {
		const { projects } = await need<{ projects: Array<{ id: string }> }>('/web/factory/projects')
		if (projects[0] === undefined) throw new Error('no factory project exists')
		cached = projects[0].id
	}
	return cached
}

export async function items(): Promise<WorkItem[]> {
	const { workItems } = await need<{ workItems: WorkItem[] }>(`/web/factory/projects/${await projectId()}/work-items`)
	return workItems
}

/** The work item for a GitHub issue number, on the work board. */
export async function itemForIssue(issue: number): Promise<WorkItem> {
	const found = (await items()).find((item) => item.externalSource?.externalId === `github-issue:${issue}`)
	if (found === undefined) throw new Error(`no work item for issue #${issue}`)
	return found
}

/** The work item for a GitHub pull request number, on the review board. */
export async function itemForPull(pull: number): Promise<WorkItem> {
	const found = (await items()).find((item) => item.externalSource?.externalId === `github-pr:${pull}`)
	if (found === undefined) throw new Error(`no work item for pull request #${pull}`)
	return found
}

export function stageOf(item: WorkItem): string {
	return item.stages.at(-1) ?? 'intake'
}

export async function decisionsFor(itemId: string): Promise<Decision[]> {
	const { decisions } = await need<{ decisions: Decision[] }>(`/web/factory/projects/${await projectId()}/decisions`)
	return decisions.filter((decision) => decision.workItemId === itemId)
}

/** Approve everything waiting on a person, and say how many there were. */
export async function approveWaiting(itemId: string): Promise<number> {
	const waiting = (await decisionsFor(itemId)).filter((d) => d.status === 'proposed' || d.status === 'pending')
	for (const decision of waiting) {
		// 409 decision_not_proposed means the dispatcher picked it up between the
		// read and this call. The gate is passed either way, which is all this
		// wanted, so approving is idempotent rather than a race worth failing on.
		await api(`/web/factory/projects/${await projectId()}/decisions/${decision.id}/approve`, { method: 'POST', body: '{}' }, [409])
	}
	return waiting.length
}

/** Ask the board to run a skill on an item that is resting. */
export async function startRun(item: WorkItem, role: Role, skillName: string): Promise<void> {
	await need(`/web/factory/projects/${await projectId()}/work-items/${item.id}/automation-runs`, {
		method: 'POST',
		body: JSON.stringify({ requestId: randomUUID(), expectedRevision: item.revision, role, skillName }),
	})
}

/** Move an item to a stage, which is what a person does when they approve. */
export async function transition(item: WorkItem, stage: string, cause: string): Promise<void> {
	await need(`/web/factory/projects/${await projectId()}/work-items/${item.id}/transition`, {
		method: 'POST',
		body: JSON.stringify({ board: item.board ?? 'work', stage, expectedRevision: item.revision, requestId: randomUUID(), cause }),
	})
}

export interface Settled {
	readonly item: WorkItem
	readonly decision: Decision | undefined
}

/**
 * Approve what is waiting and wait for the item to stop moving.
 *
 * Settled means no decision is pending, proposed or leased. Approving inside the
 * loop is deliberate: a stage can raise a second gate part way through, and a
 * poll that only watched would sit there until the timeout.
 */
export async function settle(itemId: string, timeoutMs = 15 * 60 * 1000): Promise<Settled> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		await approveWaiting(itemId)
		const decisions = await decisionsFor(itemId)
		const busy = decisions.some((d) => d.status === 'pending' || d.status === 'proposed' || d.status === 'leased' || d.status === 'retry')

		// Settled needs a finished decision, not merely an absence of busy ones.
		// A poll landing in the gap between approving a decision and the
		// dispatcher leasing it sees neither, and would call that done.
		const finished = decisions.some((d) => d.status === 'succeeded' || d.status === 'failed')
		if (!busy && finished) {
			const item = (await items()).find((candidate) => candidate.id === itemId)
			if (item === undefined) throw new Error(`work item ${itemId} vanished`)
			return { item, decision: decisions[0] }
		}
		await new Promise((resolve) => setTimeout(resolve, 5_000))
	}
	throw new Error(`work item ${itemId} did not settle within ${Math.round(timeoutMs / 1000)}s`)
}

/**
 * Advance one stage: transition, approve, wait.
 *
 * Re-reads the item first because a transition needs the current revision, and
 * the previous stage will have moved it.
 */
export async function advance(itemId: string, stage: string, cause: string): Promise<Settled> {
	const current = (await items()).find((candidate) => candidate.id === itemId)
	if (current === undefined) throw new Error(`work item ${itemId} vanished`)
	await transition(current, stage, cause)
	return settle(itemId)
}

/**
 * The work item for a declared route, such as `clean` or `refused`.
 *
 * Issue numbers change every time the lab is reset, so nothing addresses one.
 * The route lives in the repository's own `.factory/issues/*.md` frontmatter,
 * which is the same file the issue text comes from, so a spec and its issue
 * cannot drift apart.
 */
export async function itemForRoute(repoRoot: string, route: string): Promise<WorkItem> {
	const { issuesIn } = await import('../../steps/lib/issues.ts')
	const declared = issuesIn(repoRoot).filter((issue) => issue.route === route)
	if (declared.length !== 1) throw new Error(`${declared.length} issues declare route "${route}", expected exactly one`)

	const title = (declared[0] as { title: string }).title
	const found = (await items()).find((item) => item.title === title && item.board !== 'review')
	if (found === undefined) throw new Error(`no work item titled "${title}" on the work board`)
	return found
}

/**
 * Put a pull request on the review board, the way its webhook would have.
 *
 * A run opens one part way through, long after any reset, so nothing else will.
 * The same module lab-reset uses, called at the moment the event would have
 * arrived, which is the only difference between this lab and a public one.
 */
export async function announcePull(number: number, repo: string): Promise<WorkItem> {
	const { announcePullRequest, installationFor } = await import('../../scripts/lib/webhook-stand-in.ts')
	await announcePullRequest(repo, number, await installationFor(await cookie()))

	// The delivery is handled asynchronously, so the item is not there the moment
	// the post returns.
	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		const found = (await items()).find((item) => item.externalSource?.externalId === `github-pr:${number}`)
		if (found !== undefined) return found
		await new Promise((resolve) => setTimeout(resolve, 2_000))
	}
	throw new Error(`pull request #${number} never reached the review board`)
}

/**
 * Everything a review wrote about a pull request, wherever it put it.
 *
 * Two runs of the same review posted to two different places: once as an issue
 * comment on the pull request, once as a pull-request review with state
 * COMMENTED. A spec that reads one of those reports a review that plainly
 * happened as missing, so this reads both and the inline threads as well.
 */
export function reviewText(repo: string, pull: number): string {
	const read = (path: string): string => {
		try {
			return execFileSync('gh', ['api', path, '--jq', '.[].body'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
		} catch {
			return ''
		}
	}
	return [
		read(`repos/${repo}/issues/${pull}/comments`),
		read(`repos/${repo}/pulls/${pull}/reviews`),
		read(`repos/${repo}/pulls/${pull}/comments`),
	].join('\n')
}

/**
 * The verdict a review reached, in whichever words it used.
 *
 * "request changes" and "CHANGES REQUESTED" are the same answer, and which one
 * appears is not a property worth failing a fifteen minute run over.
 */
export function verdictOf(text: string): 'approve' | 'changes' | undefined {
	if (/verdict:\s*\**\s*(request changes|changes requested)/i.test(text)) return 'changes'
	if (/verdict:\s*\**\s*approve/i.test(text)) return 'approve'
	return undefined
}
