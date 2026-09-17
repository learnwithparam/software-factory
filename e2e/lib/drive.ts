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
import { reach } from '../../scripts/lib/reach.ts'

export type Role = 'triage' | 'plan' | 'work' | 'review'
export type DecisionStatus = 'pending' | 'proposed' | 'leased' | 'succeeded' | 'failed' | 'dismissed' | 'superseded' | 'retry'

export interface Decision {
	readonly id: string
	readonly workItemId: string
	readonly role: Role | null
	readonly type: string
	readonly status: DecisionStatus
	readonly attempts: number
	/** When the board raised it. settleAfter reads this to tell new work from old. */
	readonly createdAt: string
	/**
	 * The last error text, which is retained after a retry succeeds. A decision
	 * can read succeeded and still carry one, so nothing here treats its presence
	 * as failure.
	 */
	readonly lastError?: string
}

export interface WorkItem {
	readonly id: string
	readonly sessions?: Readonly<Record<string, { readonly threadId: string }>>
	readonly stageHistory?: ReadonlyArray<{ readonly stage: string; readonly by: string; readonly enteredAt: string }>
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
		const response = await reach(`${BASE}/auth/api/sign-in/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({ email: EMAIL, password: secret('FACTORY_USER_PASSWORD') }),
		})
		if (!response.ok) throw new Error(`sign-in answered ${response.status}`)
		return (response.headers.getSetCookie?.() ?? []).map((part) => part.split(';')[0]).join('; ')
	})()
	return signedIn
}

async function api<T>(path: string, init: RequestInit = {}, tolerate: readonly number[] = []): Promise<T | undefined> {
	const response = await reach(`${BASE}${path}`, {
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

/**
 * Set the two automation switches, and read the server back.
 *
 * The profiles spec leaves them wherever the last shape put them, because its
 * cleanup restores the charter files and the switches live on the board rather
 * than in the repository. Solo is the only shape that turns auto-start on and
 * it happens to run first, so the suite landed correctly by accident of
 * ordering. Reordering SHAPES would have broken the two specs that follow.
 */
export async function setAutomation(autoRunEnabled: boolean, autoApprovePlans: boolean): Promise<void> {
	await need(`/web/factory/projects/${await projectId()}`, {
		method: 'PATCH',
		body: JSON.stringify({ autoRunEnabled, autoApprovePlans }),
	})

	// A 200 is the server's claim. This is the fact.
	const { project } = await need<{ project: { autoRunEnabled: boolean; autoApprovePlans: boolean } }>(
		`/web/factory/projects/${await projectId()}`,
	)
	if (project.autoRunEnabled !== autoRunEnabled || project.autoApprovePlans !== autoApprovePlans) {
		throw new Error(`the board did not keep the switches: asked for ${autoRunEnabled}/${autoApprovePlans}, it holds ${project.autoRunEnabled}/${project.autoApprovePlans}`)
	}
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

/**
 * Move an item to a stage, which is what a person does when they approve.
 *
 * Refuses to be handed the stage the item is already in. The server accepts that
 * request and then silently returns unless `reenter` is set, which is one line
 * of rules/transition-service.js:
 *
 *   if (result.status === "accepted" && result.stage === from && !request.reenter) return
 *
 * Accepted, and nothing happens. Three runs of this suite were spent waiting for
 * work that request had quietly declined to start, so asking for it is an error
 * here rather than a shrug.
 */
export async function transition(item: WorkItem, stage: string, cause: string): Promise<void> {
	if (stageOf(item) === stage) {
		throw new Error(
			`${item.title} is already in ${stage}. A stage repeats because something happened, not because it was asked twice: ` +
				'deliver the event a person would have caused, or call redo() if you mean to run it again deliberately.',
		)
	}
	await send(item, stage, cause, false)
}

/**
 * Run a stage again, deliberately.
 *
 * The operator's "do that again", as opposed to a push or a comment causing it.
 * Production reaches this through events; a rehearsal sometimes needs to ask.
 */
export async function redo(item: WorkItem, stage: string, cause: string): Promise<void> {
	await send(item, stage, cause, true)
}

async function send(item: WorkItem, stage: string, cause: string, reenter: boolean): Promise<void> {
	await need(`/web/factory/projects/${await projectId()}/work-items/${item.id}/transition`, {
		method: 'POST',
		body: JSON.stringify({
			board: item.board ?? 'work',
			stage,
			expectedRevision: item.revision,
			requestId: randomUUID(),
			cause,
			...(reenter ? { reenter: true } : {}),
		}),
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
	return settleAfter(itemId, 0, timeoutMs)
}

/**
 * Wait for work that starts *after* a moment, then settle.
 *
 * settle() alone cannot tell a stage that has finished from one that has not
 * begun: both look like "no decision is busy". That is harmless when a
 * transition creates the decision synchronously, and wrong the moment work is
 * started by an event, because the poll lands in the gap before the event has
 * been turned into a decision and reports the previous stage's success as this
 * one's.
 *
 * It cost the re-review. The push was announced, settle returned in five
 * seconds on decisions from the review before it, and the rejection was still
 * the only verdict on the pull request.
 */
export async function settleAfter(itemId: string, since: number, timeoutMs = 15 * 60 * 1000): Promise<Settled> {
	const deadline = Date.now() + timeoutMs
	if (since > 0) {
		while (Date.now() < deadline) {
			const fresh = (await decisionsFor(itemId)).some((d) => Date.parse(d.createdAt) >= since)
			if (fresh) break
			await new Promise((resolve) => setTimeout(resolve, 5_000))
		}
	}
	return settleNow(itemId, deadline)
}

async function settleNow(itemId: string, deadline: number): Promise<Settled> {
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
	throw new Error(`work item ${itemId} did not settle before its deadline`)
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
const VERDICT = /(?:verdict|re-?review|review)\s*:\s*\**\s*(request changes|changes requested|approve)/gi

export function verdictOf(text: string): 'approve' | 'changes' | undefined {
	// Four spellings seen in practice: "Verdict: approve", "Verdict: request
	// changes", "## Review: APPROVE" and "## Re-review: request changes". Which
	// one a pass reaches for is not a property worth failing a run over; whether
	// it approved or sent the work back is.
	const first = [...text.matchAll(VERDICT)][0]?.[1]?.toLowerCase()
	if (first === undefined) return undefined
	return first === 'approve' ? 'approve' : 'changes'
}

/**
 * The verdict a review reached most recently.
 *
 * A rejection stays on a pull request for ever, so asking whether a verdict
 * exists answers the wrong question after a re-review: the first one found is
 * always the rejection, and the re-review can never be seen to have changed
 * anything.
 */
export function latestVerdict(text: string): 'approve' | 'changes' | undefined {
	const last = [...text.matchAll(VERDICT)].at(-1)?.[1]?.toLowerCase()
	if (last === undefined) return undefined
	return last === 'approve' ? 'approve' : 'changes'
}

/**
 * Tell the board a pull request has been pushed to, so it reviews it again.
 *
 * The review board has no review-to-review transition, so the only way back
 * through review is the event a push would have produced.
 */
export async function announcePush(number: number, repo: string): Promise<void> {
	const { announcePush: push, installationFor } = await import('../../scripts/lib/webhook-stand-in.ts')
	await push(repo, number, await installationFor(await cookie()))
}

/**
 * The verdict as the review recorded it on the pull request itself.
 *
 * The skill reconciles a label after publishing: approve adds
 * `status:auto-approved` and removes `status:changes-requested`, and a rejection
 * does the reverse. That is a single current value, where comments are an
 * append-only history in which the first rejection stays for ever, so this is
 * the honest question to ask after a re-review.
 */
export function labelledVerdict(repo: string, pull: number): 'approve' | 'changes' | undefined {
	const out = execFileSync('gh', ['pr', 'view', String(pull), '--repo', repo, '--json', 'labels', '--jq', '.labels[].name'], { encoding: 'utf8' })
	const labels = out.split('\n').map((line) => line.trim())
	if (labels.includes('status:auto-approved')) return 'approve'
	if (labels.includes('status:changes-requested')) return 'changes'
	return undefined
}

/**
 * Wait for a review to publish something new on a pull request.
 *
 * Not for a decision. A decision here is a dispatch record: the pair created
 * when a review starts succeeds within about six seconds, and the agent then
 * works for eight minutes before publishing. Waiting on decisions therefore
 * reports a review as finished before it has read a line, which is what made
 * three runs of the rejection route insist the re-review had approved nothing.
 *
 * So this waits for the artefact the route is actually about: a verdict on the
 * pull request that was not there before.
 */
export async function waitForVerdict(repo: string, pull: number, since: number, itemId: string, timeoutMs = 20 * 60 * 1000): Promise<string> {
	const deadline = Date.now() + timeoutMs
	const newer = (): string => {
		const out = execFileSync(
			'gh',
			['api', `repos/${repo}/issues/${pull}/comments`, '--jq', `[.[] | select((.created_at | fromdateiso8601) > ${Math.floor(since / 1000)}) | .body] | join("\n")`],
			{ encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
		)
		return out.trim()
	}

	while (Date.now() < deadline) {
		// Approve while waiting. A push raises the re-review as a decision in
		// `proposed`, because this project runs with auto-start off, so waiting for
		// the verdict without approving the gate waits for an operator who is this
		// loop. Twenty minutes of polling for a review nobody had let start.
		await approveWaiting(itemId)

		const said = newer()
		if (verdictOf(said) !== undefined) return said
		await new Promise((resolve) => setTimeout(resolve, 15_000))
	}
	throw new Error(`no new verdict on pull request #${pull} within ${Math.round(timeoutMs / 60000)} minutes`)
}

/** Tell the board a person commented, which is how a plan gets reconsidered. */
export async function announceComment(repo: string, issue: number, commentId: number): Promise<void> {
	const { announceComment: say, installationFor } = await import('../../scripts/lib/webhook-stand-in.ts')
	await say(repo, issue, commentId, await installationFor(await cookie()))
}

/**
 * Run a stage again and wait for what it produces.
 *
 * advance() for the same stage, with the flag that stops the server accepting
 * the request and doing nothing.
 */
export async function again(itemId: string, stage: string, cause: string): Promise<Settled> {
	const current = (await items()).find((candidate) => candidate.id === itemId)
	if (current === undefined) throw new Error(`work item ${itemId} vanished`)
	const at = Date.now()
	await redo(current, stage, cause)
	return settleAfter(itemId, at)
}

/**
 * The address of a session, built rather than clicked.
 *
 * Which button opens a session depends on the stage: a resting card offers
 * Investigate, one in planning offers Build, and Open session comes and goes.
 * Four runs were spent waiting for a button whose label changes underneath the
 * run sheet, when the work item has carried the thread id all along.
 */
export async function sessionUrl(item: WorkItem, role: string): Promise<string> {
	const thread = item.sessions?.[role]?.threadId
	if (thread === undefined) throw new Error(`${item.title} has no ${role} session`)
	return `${BASE}/factories/${await projectId()}/workspaces/${thread}/threads/${thread}`
}
