/**
 * Phase 10: an item becomes something a person can act on, or it does not.
 *
 * The whole loop runs against the fixture with a recorded agent, so this costs
 * nothing and still exercises every layer in order.
 */

import { expect, it } from 'bun:test'
import { join } from 'node:path'
import { deliver } from '../steps/06-delivery/deliver.ts'
import { pullRequestBody } from '../steps/06-delivery/record.ts'
import { replayExecutor } from '../steps/lib/executor.ts'
import { issue, issuesIn } from '../steps/lib/issues.ts'
import { loadRepo } from '../steps/lib/repo.ts'

const SAMPLE = join(import.meta.dirname, 'fixtures', 'sample')
const repo = loadRepo(SAMPLE)
const executor = replayExecutor()
const run = (id: string, extra = {}) =>
	deliver(repo, issue(SAMPLE, id), { executor, dryRun: true, ...extra })

it('an allowed item runs every stage in order and ends in a draft pull request', async () => {
	const { record } = await run('1')
	expect(record.outcome).toBe('passed')
	expect(record.stages.map((stage) => stage.name)).toEqual([
		'claim',
		'context',
		'implement',
		'gates',
		'verify',
	])
	expect(record.pullRequest?.draft).toBe(true)
})

it('a protected item is refused before any stage runs at all', async () => {
	const { record } = await run('3')
	expect(record.outcome).toBe('refused')
	expect(record.changedFiles).toEqual([])
	expect(record.stages).toEqual([])
	expect(record.refusal?.rule).toStartWith('protected:')
})

it('a full review queue stops work starting at all', async () => {
	const { record } = await run('1', { awaitingReview: repo.charter.reviewQueueCap })
	expect(record.outcome).toBe('refused')
	expect(record.refusal?.rule).toContain('awaiting_review')
})

it('every verdict in the record is the line its source wrote, never a summary', async () => {
	const { record } = await run('1')
	for (const entry of record.verdicts) expect(entry.line).toStartWith('VERDICT: ')
})

it('the record names which repository the run worked on', async () => {
	// One factory, many repositories. A record that does not say which is useless.
	const { record } = await run('1')
	expect(record.repo).toBe(repo.root)
})

it('the pull request body carries the evidence a reviewer needs', async () => {
	const { record } = await run('1')
	const body = pullRequestBody(record)
	expect(body).toContain('## Evidence')
	expect(body).toContain('## Where the time went')
	expect(body).toContain('Merging is not automated')
	for (const file of record.changedFiles) expect(body).toContain(file)
})

it('a missing recording is an error rather than an empty answer', async () => {
	// An executor that silently returns nothing turns every test below it into a
	// test of nothing.
	await expect(
		executor.run({ repo: SAMPLE, issueId: 'no-such-issue', role: 'doer', prompt: '', cwd: '.' }),
	).rejects.toThrow(/no recording/)
})

it('the fixture carries a work item of every shape, refusal included', async () => {
	// Sample work that only succeeds teaches the wrong lesson.
	const outcomes = []
	for (const item of issuesIn(SAMPLE)) {
		outcomes.push((await run(item.id)).record.outcome)
	}
	expect(outcomes).toContain('passed')
	expect(outcomes).toContain('refused')
})
