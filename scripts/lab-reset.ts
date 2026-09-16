/**
 * Put the repository the factory is pointed at back the way it started.
 *
 * Run before a session. A rehearsal leaves branches and workspaces behind, and
 * discovering that in front of a room is the kind of thing that costs the hour.
 *
 * It refuses to touch a repository with uncommitted work unless told to, because
 * the one thing worse than a failed demonstration is destroying somebody's
 * afternoon to fix it.
 */

import { rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { WORKTREES, git, list, remove } from '../steps/02-execution/worktree.ts'
import { loadRepo } from '../steps/lib/repo.ts'

const force = process.argv.includes('--force')
const repo = loadRepo()

const dirty = git(['status', '--porcelain'], repo.root)
if (dirty !== '' && !force) {
	console.error(`${repo.root} has uncommitted work:\n${dirty}\n`)
	console.error('Commit it, stash it, or re-run with --force to discard it.')
	process.exit(1)
}

for (const workspace of list(repo.root)) {
	remove(repo.root, workspace.item)
	console.log(`removed workspace ${workspace.branch}`)
}
rmSync(join(WORKTREES, basename(repo.root)), { recursive: true, force: true })

if (force) {
	git(['reset', '--hard', '-q', 'HEAD'], repo.root)
	git(['clean', '-qfd'], repo.root)
}

for (const branch of git(['branch', '--list', 'fq-*'], repo.root).split('\n')) {
	const name = branch.replace(/^[* ]+/, '').trim()
	if (name === '') continue
	git(['branch', '-D', name], repo.root)
	console.log(`removed branch ${name}`)
}

console.log(`${repo.root} is back at ${git(['rev-parse', '--short', 'HEAD'], repo.root)}`)
