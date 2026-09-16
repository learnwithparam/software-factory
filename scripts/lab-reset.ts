/**
 * Put the repository the factory works on back the way a session starts.
 *
 * Closes every open issue and pull request, deletes the branches a run left
 * behind, and recreates the issues from `.factory/issues/*.md`, which are the
 * source of truth for their text. A rehearsal and a live run then start from
 * exactly the same board.
 *
 * It clears the Factory's board and puts the new issues back on it. Closing the
 * issues is not enough: a work item holds the session it started, a session is
 * pinned to the model it was created with, and a board left holding yesterday's
 * items replays yesterday's run.
 *
 * It seeds the board itself rather than waiting for intake. Work items are
 * created by the `issues.opened` webhook, and GitHub will not deliver a webhook
 * to localhost. The reconcile worker that does poll only patches and closes
 * items that already exist, which is why a log line saying it started was never
 * evidence that issues would arrive. Writing the same records the webhook would
 * have written keeps the lab self-hosted, with no tunnel and no third party.
 *
 * It refuses to touch a repository with uncommitted work unless told to,
 * because the one thing worse than a failed demonstration is destroying
 * somebody's afternoon to fix it.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { WORKTREES, git, list, remove } from '../steps/02-execution/worktree.ts'
import { issuesIn, type Issue } from '../steps/lib/issues.ts'
import { loadRepo } from '../steps/lib/repo.ts'
import { session } from './factory-connect.ts'
import { seedIssues, seedPullRequests } from './lib/webhook-stand-in.ts'
import { BODY, BRANCH, TITLE, changes } from '../fixtures/saved-view.ts'

const force = process.argv.includes('--force')
const repo = loadRepo()

function gh(args: string[]): string {
	const result = Bun.spawnSync(['gh', ...args], { cwd: repo.root })
	if (result.exitCode !== 0) {
		throw new Error(`gh ${args.join(' ')} failed: ${new TextDecoder().decode(result.stderr).trim()}`)
	}
	return new TextDecoder().decode(result.stdout).trim()
}

function slug(): string {
	return gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
}

/** The issue body GitHub shows, with the frontmatter left behind. */
function bodyOf(issue: Issue): string {
	return [
		issue.body,
		'',
		'## Done when',
		'',
		issue.doneWhen,
		'',
		'## Files this is expected to touch',
		'',
		...issue.paths.map((path) => `- \`${path}\``),
		'',
		'---',
		'',
		`Seeded from \`.factory/issues\` by \`make lab-reset\`. Route: \`${issue.route ?? 'unspecified'}\`.`,
	].join('\n')
}

const dirty = git(['status', '--porcelain'], repo.root)
if (dirty !== '' && !force) {
	console.error(`${repo.root} has uncommitted work:\n${dirty}\n`)
	console.error('Commit it, stash it, or re-run with --force to discard it.')
	process.exit(1)
}

console.log(`resetting ${slug()}`)

// Workspaces first, so a branch a worktree still holds can be deleted.
for (const workspace of list(repo.root)) {
	remove(repo.root, workspace.item)
	console.log(`  removed workspace ${workspace.branch}`)
}
rmSync(join(WORKTREES, basename(repo.root)), { recursive: true, force: true })

for (const number of gh(['pr', 'list', '--state', 'open', '--json', 'number', '--jq', '.[].number']).split('\n').filter(Boolean)) {
	gh(['pr', 'close', number, '--delete-branch'])
	console.log(`  closed pull request #${number}`)
}

for (const number of gh(['issue', 'list', '--state', 'open', '--limit', '200', '--json', 'number', '--jq', '.[].number']).split('\n').filter(Boolean)) {
	gh(['issue', 'close', number, '--reason', 'not planned'])
	console.log(`  closed issue #${number}`)
}

if (force) {
	git(['reset', '--hard', '-q', 'HEAD'], repo.root)
	git(['clean', '-qfd'], repo.root)
}

for (const branch of git(['branch', '--list'], repo.root).split('\n')) {
	const name = branch.replace(/^[* ]+/, '').trim()
	if (name === '' || name === 'main') continue
	git(['branch', '-D', name], repo.root)
	console.log(`  removed branch ${name}`)
}

await clearBoard()

const issues = issuesIn(repo.root)
if (issues.length === 0) {
	console.error(`${repo.root} declares no issues in .factory/issues`)
	process.exit(1)
}

for (const issue of issues) {
	const url = gh(['issue', 'create', '--title', issue.title, '--body', bodyOf(issue)])
	console.log(`  ${url}  ${issue.route ?? ''}`)
}

if (issues.some((issue) => issue.route === 'review-rejection')) openTheProposal()

await seedBoard()

console.log(`\n${issues.length} issues open, ${gh(['pr', 'list', '--json', 'number', '--jq', 'length'])} pull requests open.`)


/**
 * Delete every work item the Factory holds, so intake starts from nothing.
 *
 * Skipped rather than fatal when the server is down: resetting the repository
 * is still worth doing, and factory-doctor is the command that has an opinion
 * about the server being up.
 */
async function clearBoard(): Promise<void> {
	const base = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'
	let cookie: string
	try {
		cookie = await session()
	} catch {
		console.log('  factory not reachable, board left alone')
		return
	}

	const listed = await fetch(`${base}/web/factory/projects`, { headers: { cookie, accept: 'application/json' } })
	const { projects } = (await listed.json()) as { projects: Array<{ id: string }> }

	for (const project of projects) {
		const response = await fetch(`${base}/web/factory/projects/${project.id}/work-items`, {
			headers: { cookie, accept: 'application/json' },
		})
		const { workItems } = (await response.json()) as { workItems: Array<{ id: string; title: string }> }
		for (const item of workItems) {
			const deleted = await fetch(`${base}/web/factory/work-items/${item.id}`, { method: 'DELETE', headers: { cookie, origin: base } })
			if (!deleted.ok) throw new Error(`deleting ${item.title} answered ${deleted.status}`)
		}
		console.log(`  cleared ${workItems.length} work items from the board`)
	}
}

/**
 * Put the new issues on the board, the way `issues.opened` would have.
 *
 * Any pull request still open is seeded too, so a reset that runs mid-run leaves
 * the review board agreeing with GitHub rather than holding yesterday's.
 */
async function seedBoard(): Promise<void> {
	const base = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'
	let cookie: string
	try {
		cookie = await session()
	} catch {
		console.log('  factory not reachable, board not seeded')
		return
	}

	const listed = await fetch(`${base}/web/factory/projects`, { headers: { cookie, accept: 'application/json' } })
	const { projects } = (await listed.json()) as { projects: Array<{ id: string; name: string }> }
	const project = projects.find((candidate) => candidate.name === slug().split('/')[1]) ?? projects[0]
	if (project === undefined) {
		console.log('  no factory project, board not seeded')
		return
	}

	const issues = await seedIssues(base, cookie, project.id, slug())
	const pulls = await seedPullRequests(base, cookie, project.id, slug())
	console.log(`  seeded ${issues} issues and ${pulls} pull requests onto ${project.name}`)
}

/**
 * Open the pull request the review-rejection route reads.
 *
 * Route six starts from somebody else's change rather than from an issue, so the
 * lab has to write it. The two faults in it are the two the recorded cold review
 * in steps/04-verification/reviews/6.json names, which is how the live review
 * and the offline one are held to the same answer.
 */
function openTheProposal(): void {
	const testPath = join(repo.root, 'apps', 'console', 'lib', 'ledger.test.ts')
	const edits = changes(readFileSync(testPath, 'utf8'))

	git(['checkout', '-q', '-b', BRANCH], repo.root)
	for (const change of edits) writeFileSync(join(repo.root, change.path), change.contents)
	git(['add', '-A'], repo.root)
	git(['commit', '-q', '-m', TITLE], repo.root)
	git(['push', '-q', '-u', 'origin', BRANCH], repo.root)
	git(['checkout', '-q', 'main'], repo.root)

	const url = gh(['pr', 'create', '--head', BRANCH, '--title', TITLE, '--body', BODY])
	console.log(`  ${url}  the change route six reviews`)
}
