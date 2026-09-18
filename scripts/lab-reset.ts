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

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { WORKTREES, git, list, remove } from '../steps/02-execution/worktree.ts'
import { issuesIn, type Issue } from '../steps/lib/issues.ts'
import { loadRepo } from '../steps/lib/repo.ts'
import { session } from './factory-connect.ts'
import { installationFor, seedIssues, seedPullRequests } from './lib/webhook-stand-in.ts'
import { BRANCH, TITLE, body as proposalBody, changes } from '../fixtures/saved-view.ts'

const force = process.argv.includes('--force')
const repo = loadRepo()

/**
 * Which known governance state this reset establishes.
 *
 * Unset means the baseline graph the six routes are written against. The
 * profiles spec sets FACTORY_SHAPE, because it applies a shape and then resets
 * the board, and a reset that always restored the baseline erased the shape
 * between `make profile` and the run meant to demonstrate it.
 *
 * Resolved here rather than inside restoreShape, so a name that matches no
 * profile is refused before a single issue is closed.
 */
const SHAPE = process.env.FACTORY_SHAPE
const GRAPH = SHAPE === undefined
	? join(import.meta.dirname, '..', 'fixtures', 'ledger-baseline')
	: join(import.meta.dirname, '..', 'profiles', SHAPE)
if (!existsSync(join(GRAPH, 'targets.json'))) {
	console.error(`FACTORY_SHAPE=${SHAPE} names no profile: ${GRAPH} has no targets.json`)
	process.exit(1)
}

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

// Mastra clones the repo once per session and never deletes it. The reset ends every session.
const SANDBOXES =
	process.env.MASTRACODE_LOCAL_SANDBOX_ROOT?.trim() || join(import.meta.dirname, '..', '..', 'workspaces')
for (const sandbox of existsSync(SANDBOXES) ? readdirSync(SANDBOXES) : []) {
	rmSync(join(SANDBOXES, sandbox), { recursive: true, force: true })
}
console.log(`  cleared session sandboxes in ${SANDBOXES}`)

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

// Remote branches a run left behind. A pull request that was closed took its
// branch with it; one that was never opened did not, and factory/issue-70 sat
// on the remote for weeks failing a check that asked whether any factory branch
// existed.
for (const remote of gh(['api', `repos/${slug()}/branches`, '--jq', '.[].name']).split('\n')) {
	const name = remote.trim()
	if (name === '' || name === 'main' || !/^factory\//.test(name)) continue
	gh(['api', '-X', 'DELETE', `repos/${slug()}/git/refs/heads/${name}`])
	console.log(`  removed remote branch ${name}`)
}

for (const branch of git(['branch', '--list'], repo.root).split('\n')) {
	const name = branch.replace(/^[* ]+/, '').trim()
	if (name === '' || name === 'main') continue
	git(['branch', '-D', name], repo.root)
	console.log(`  removed branch ${name}`)
}

restoreShape()

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
 * Put the governance files back to the graph the routes are written against.
 *
 * The profiles spec switches the charter through all four company shapes and
 * restores it on the way out, so a run that is interrupted leaves the ledger in
 * whichever shape it had reached. Killing a sequence mid-run left the `startup`
 * charter in place, where the money path proposes rather than builds.
 *
 * The baseline is not one of the four shapes, which is the part that is easy to
 * get wrong: this restored `profiles/solo` first, and solo puts every target on
 * `build`, so route five would have built the money path instead of refusing
 * it and route four would have lost the plan gate that the ownership graph
 * exists to impose. fixtures/ledger-baseline/README.md says which route needs
 * which level.
 *
 * Restoring it belongs here rather than only in the spec, because this is the
 * command a person runs when the board is in a state nobody can account for.
 * It commits and pushes, because a run clones from the remote.
 */
function restoreShape(): void {
	const from = GRAPH
	const changed: string[] = []
	for (const name of ['charter.md', 'targets.json']) {
		const to = join(repo.root, '.factory', name)
		const wanted = readFileSync(join(from, name), 'utf8')
		if (readFileSync(to, 'utf8') === wanted) continue
		writeFileSync(to, wanted)
		changed.push(`.factory/${name}`)
	}

	const which = SHAPE === undefined ? 'baseline' : `${SHAPE} shape`
	if (changed.length === 0) {
		console.log(`  charter and targets already hold the ${which} graph`)
		return
	}

	git(['add', ...changed], repo.root)
	git(['commit', '-q', '-m', `Operate on the ${which} graph`], repo.root)
	git(['push', '-q', 'origin', 'HEAD'], repo.root)
	console.log(`  restored ${changed.join(' and ')} to the ${which} graph, and pushed`)
}

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
 * Deliver the webhooks GitHub would have sent, so the board fills itself.
 *
 * Not a write to the work-items table: the Intake column is drawn from what
 * intake delivered, so rows inserted behind it leave the board empty while the
 * API happily lists them.
 */
async function seedBoard(): Promise<void> {
	try {
		const installation = await installationFor(await session())
		const issues = await seedIssues(slug(), installation)
		const pulls = await seedPullRequests(slug(), installation)
		console.log(`  delivered ${issues} issue and ${pulls} pull request webhooks`)
	} catch (error) {
		console.log(`  board not seeded: ${(error as Error).message}`)
	}
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
	// The issue this change answers, so the reviewer has an ask to judge scope
	// against rather than only a diff.
	const authorising = Number(
		gh(['issue', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title', '--jq',
			`.[] | select(.title == ${JSON.stringify(issuesIn(repo.root).find((issue) => issue.route === 'review-rejection')?.title ?? '')}) | .number`]),
	)

	const testPath = join(repo.root, 'apps', 'console', 'lib', 'ledger.test.ts')
	const edits = changes(readFileSync(testPath, 'utf8'))

	git(['checkout', '-q', '-b', BRANCH], repo.root)
	for (const change of edits) writeFileSync(join(repo.root, change.path), change.contents)
	git(['add', '-A'], repo.root)
	git(['commit', '-q', '-m', TITLE], repo.root)
	git(['push', '-q', '-u', 'origin', BRANCH], repo.root)
	git(['checkout', '-q', 'main'], repo.root)

	const url = gh(['pr', 'create', '--head', BRANCH, '--title', TITLE, '--body', proposalBody(authorising)])
	console.log(`  ${url}  the change route six reviews`)
}
