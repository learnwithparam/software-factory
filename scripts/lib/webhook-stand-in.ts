/**
 * What GitHub would have posted, written locally instead.
 *
 * Mastra Factory creates work items from webhook events: `issues.opened` puts an
 * issue on the work board, `pull_request.opened` puts a pull request on the
 * review board. GitHub will not deliver a webhook to localhost and refuses to
 * register one it cannot reach, so a self-hosted lab receives none of them.
 *
 * Polling is not a substitute. The reconcile worker sweeps every sixty seconds
 * and its counts are updated, closed and failed; there is no created. It patches
 * items that exist and never makes one, so a log line saying it started is not
 * evidence that anything will arrive.
 *
 * This writes the same records those two events would have written, which keeps
 * the lab self-hosted with no tunnel and no third party, and leaves reconcile
 * still recognising the items as its own. The `type` strings are load-bearing:
 * the transition service reads `pull-request`, with a hyphen, to decide which
 * board an item belongs to, and rejects the item outright when it disagrees.
 */

import { execFileSync } from 'node:child_process'

export interface Seeded {
	readonly issues: number
	readonly pullRequests: number
}

function gh(repo: string, args: readonly string[]): string {
	return execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8' }).trim()
}

async function create(base: string, cookie: string, projectId: string, body: unknown, what: string): Promise<void> {
	const response = await fetch(`${base}/web/factory/projects/${projectId}/work-items`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: base, cookie },
		body: JSON.stringify(body),
	})
	if (!response.ok) throw new Error(`putting ${what} on the board answered ${response.status}: ${(await response.text()).slice(0, 200)}`)
}

interface Issue {
	number: number
	title: string
	url: string
	createdAt: string
	author: { login: string }
	labels: Array<{ name: string }>
	assignees: Array<{ login: string }>
}

interface PullRequest extends Issue {
	headRefName: string
	baseRefName: string
	isDraft: boolean
}

/** Every open issue, as `issues.opened` would have delivered it. */
export async function seedIssues(base: string, cookie: string, projectId: string, repo: string): Promise<number> {
	const repositoryId = Number(gh(repo, ['api', `repos/${repo}`, '--jq', '.id']))
	const open = JSON.parse(
		gh(repo, ['issue', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,author,labels,assignees,createdAt,url']),
	) as Issue[]

	for (const issue of open.sort((a, b) => a.number - b.number)) {
		await create(base, cookie, projectId, {
			title: issue.title,
			board: 'work',
			externalSource: { url: issue.url, type: 'issue', externalId: `github-issue:${issue.number}`, integrationId: 'github' },
			stages: ['intake'],
			metadata: {
				state: 'open',
				author: issue.author.login,
				labels: issue.labels.map((label) => label.name),
				assignees: issue.assignees.map((assignee) => assignee.login),
				authorTrusted: true,
				sourceCreatedAt: issue.createdAt,
				githubIssueNumber: issue.number,
				autoStartCandidate: false,
				githubRepositoryId: repositoryId,
			},
		}, `issue #${issue.number}`)
	}
	return open.length
}

/** Every open pull request, as `pull_request.opened` would have delivered it. */
export async function seedPullRequests(base: string, cookie: string, projectId: string, repo: string): Promise<number> {
	const repositoryId = Number(gh(repo, ['api', `repos/${repo}`, '--jq', '.id']))
	const open = JSON.parse(
		gh(repo, ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,author,labels,assignees,createdAt,url,headRefName,baseRefName,isDraft']),
	) as PullRequest[]

	for (const pull of open.sort((a, b) => a.number - b.number)) {
		await create(base, cookie, projectId, {
			title: pull.title,
			board: 'review',
			// "pull-request", hyphenated. The transition service maps this string to
			// the review board, and "pull_request" is rejected as the wrong board.
			externalSource: { url: pull.url, type: 'pull-request', externalId: `github-pr:${pull.number}`, integrationId: 'github' },
			stages: ['intake'],
			metadata: {
				state: 'open',
				author: pull.author.login,
				labels: pull.labels.map((label) => label.name),
				assignees: pull.assignees.map((assignee) => assignee.login),
				requestedReviewers: [],
				authorTrusted: true,
				factoryAuthored: true,
				sourceCreatedAt: pull.createdAt,
				githubPullRequestNumber: pull.number,
				autoStartCandidate: true,
				githubRepositoryId: repositoryId,
				draft: pull.isDraft,
				merged: false,
				headBranch: pull.headRefName,
				baseBranch: pull.baseRefName,
			},
		}, `pull request #${pull.number}`)
	}
	return open.length
}
