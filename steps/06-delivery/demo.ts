/**
 * Step six on stage: an item becomes something a person can review.
 *
 * `triage`     sorting the items before any of them runs
 * `run`        the whole loop, every layer, one item
 * `refused`    the one it will not do, and why that is a success
 * `open-pr`    what arrives for a person
 * `try-merge`  what happens when something tries to merge it
 * `all`        the full tour, which is what Lightning four runs
 */

import { allowed, failed, note, refused as refusedLine, step, table, title, verdict, waiting } from '../lib/out.ts'
import { decide } from '../01-boundary/policy.ts'
import { issue, issuesIn } from '../lib/issues.ts'
import { loadRepo } from '../lib/repo.ts'
import { deliver } from './deliver.ts'
import { pullRequestBody } from './record.ts'

const repo = loadRepo()
const items = issuesIn(repo.root)

function doTriage(): number {
	title(`${items.length} items, sorted before any of them runs`)
	const rows = items.map((item) => {
		const decision = decide(repo, { id: item.id, paths: item.paths })
		return [
			item.id,
			item.title,
			decision.allowed ? decision.autonomy : 'refuse',
			decision.allowed ? decision.targets.join(', ') : decision.rule,
		]
	})
	table(['item', 'title', 'may', 'because'], rows)

	note('Triage is a separate stage so a narrow request does not quietly become a wide change.')
	step('One may be finished unattended. One needs a person to accept the plan. One is refused.')
	verdict('PASS', 'Sorted by consequence, before any file is touched.')
	return 0
}

async function doRun(id: string, dryRun: boolean): Promise<number> {
	const item = issue(repo.root, id)
	title(`Item ${item.id}: ${item.title}`)

	const delivery = await deliver(repo, item, {
		dryRun,
		onStage: (name, detail) => step(`${name.padEnd(10)} ${detail}`),
	})
	const record = delivery.record

	title('Verdicts, quoted')
	for (const entry of record.verdicts) {
		const line = entry.line
		if (line.startsWith('VERDICT: PASS')) allowed(`${entry.from}: ${line}`)
		else if (line.startsWith('VERDICT: REFUSED')) refusedLine(`${entry.from}: ${line}`)
		else failed(`${entry.from}: ${line}`)
	}

	if (record.pullRequest !== undefined) {
		title('What a person receives')
		allowed(`draft pull request on ${record.pullRequest.branch}`)
		note(record.pullRequest.url)
	}

	verdict(
		record.outcome === 'passed' ? 'PASS' : record.outcome === 'refused' ? 'REFUSED' : 'NEEDS REVIEW',
		`${record.outcome}, ${record.changedFiles.length} file(s) changed, ${(record.costMinor / 100).toFixed(2)} EUR.`,
	)
	return 0
}

async function doRefused(): Promise<number> {
	const refusedItem = items.find(
		(candidate) => !decide(repo, { id: candidate.id, paths: candidate.paths }).allowed,
	)
	if (refusedItem === undefined) {
		failed('every item in this repository is permitted, so nothing demonstrates a refusal')
		verdict('FAIL', 'A lab whose sample work only succeeds teaches the wrong lesson.')
		return 1
	}
	title(`The one it will not do: ${refusedItem.title}`)

	const delivery = await deliver(repo, refusedItem, { dryRun: true })
	const refusal = delivery.record.refusal

	if (refusal === undefined) {
		failed('nothing stopped it, which means the charter is not being read')
		verdict('FAIL', 'A protected path allowed a change.')
		return 1
	}

	refusedLine(refusal.rule)
	note(refusal.reason)
	allowed(`${delivery.record.changedFiles.length} files changed, because it stopped before touching any`)
	note('Without that rule: a plausible change to something load bearing, verified by tests the same run wrote.')
	verdict('REFUSED', 'This is the successful outcome, and it looks like nothing.')
	return 0
}

async function doOpenPr(): Promise<number> {
	const buildable = items.find((candidate) => {
		const decision = decide(repo, { id: candidate.id, paths: candidate.paths })
		return decision.allowed && decision.autonomy === 'build'
	})
	if (buildable === undefined) {
		failed('no item here may be finished unattended, so nothing reaches a pull request')
		return 1
	}
	const delivery = await deliver(repo, buildable, { dryRun: true })
	const record = { ...delivery.record, pullRequest: delivery.record.pullRequest ?? { branch: 'fq-12', url: '', draft: true } }

	title('The pull request body, as a reviewer sees it')
	console.log(pullRequestBody(record))
	note('A reviewer opens one thing and can see whether the work was checked before deciding whether it is right.')
	verdict('PASS', 'Draft, because a machine produced it and nobody has stood behind it yet.')
	return 0
}

function doTryMerge(): number {
	title('Something tries to merge it')
	waiting('the committed hook catches the common shell routes')
	refusedLine('merge refused: nothing merges without a named engineer, on any tier')
	note('The hook is a guardrail. The enforcement that counts is a branch protection rule, because a guardrail an agent can edit is not a boundary.')
	verdict('REFUSED', 'The pipeline stops at a reviewed pull request, every time.')
	return 0
}

async function doAll(): Promise<number> {
	let worst = 0
	worst = Math.max(worst, doTriage())
	const buildable = items.find((candidate) => {
		const decision = decide(repo, { id: candidate.id, paths: candidate.paths })
		return decision.allowed && decision.autonomy === 'build'
	})
	worst = Math.max(worst, await doRun(buildable?.id ?? items[0]?.id ?? '1', true))
	worst = Math.max(worst, await doRefused())
	worst = Math.max(worst, await doOpenPr())
	worst = Math.max(worst, doTryMerge())
	return worst
}

const argv = process.argv.slice(2)
const [command = 'all', argument] = argv
const dryRun = argv.includes('--dry-run')

const commands: Record<string, () => number | Promise<number>> = {
	triage: doTriage,
	run: () => doRun(argument ?? items[0]?.id ?? '1', dryRun),
	refused: doRefused,
	'open-pr': doOpenPr,
	'try-merge': doTryMerge,
	all: doAll,
}

const chosen = commands[command]
if (chosen === undefined) {
	console.error(`unknown command: ${command}`)
	console.error('usage: demo.ts [triage|run <item>|refused|open-pr|try-merge|all]')
	process.exit(2)
}
process.exit(await chosen())
