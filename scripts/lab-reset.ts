/**
 * Put the repository the factory works on back the way a session starts.
 *
 * Closes every open issue and pull request, deletes the branches a run left
 * behind, and recreates the issues from `.factory/issues/*.md`, which are the
 * source of truth for their text. A rehearsal and a live run then start from
 * exactly the same board.
 *
 * It clears the Factory's board too. Closing the issues is not enough: a work
 * item holds the session it started, a session is pinned to the model it was
 * created with, and a board left holding yesterday's items replays yesterday's
 * run. The reconcile worker recreates them from the issues within a minute.
 *
 * It refuses to touch a repository with uncommitted work unless told to,
 * because the one thing worse than a failed demonstration is destroying
 * somebody's afternoon to fix it.
 */

import { rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { WORKTREES, git, list, remove } from '../steps/02-execution/worktree.ts'
import { issuesIn, type Issue } from '../steps/lib/issues.ts'
import { loadRepo } from '../steps/lib/repo.ts'
import { session } from './factory-connect.ts'

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
