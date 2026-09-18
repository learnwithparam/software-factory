/**
 * Phase 9: the loop recovers, and it ends.
 *
 * A loop whose return type allows "still going" is a loop that will.
 */

import { expect, it } from 'bun:test'
import { join } from 'node:path'
import { handback, loadBudget, overBudget, run, type Attempt, type Failure } from '../steps/05-loop/loop.ts'
import { issue } from '../steps/lib/issues.ts'

const SAMPLE = join(import.meta.dirname, 'fixtures', 'sample')
const budget = loadBudget()
const item = issue(SAMPLE, '1')

const failure: Failure = {
	stage: 'gates',
	what: 'a check failed',
	where: 'app/thing.test.ts:31',
	expected: 'the declared outcome holds',
	output: 'expected 1, received 0.979',
}

function attempt(number: number, passed: boolean, overrun = false): Attempt {
	return {
		number,
		passed,
		...(passed ? {} : { failure }),
		stages: [{ name: 'verify', ms: overrun ? 9_000_000 : 1_000, overBudget: overrun }],
	}
}

it('a failure hands back a reason the next attempt can start from', () => {
	const packet = handback(failure)
	expect(packet).toContain(failure.where)
	expect(packet).toContain(failure.expected)
	expect(packet).toContain('Do not begin again')
})

it('the second attempt is given the first attempt failure', async () => {
	let received: Failure | undefined
	const result = await run(
		item,
		async (_issue, previous, number) => {
			if (number === 2) received = previous
			return attempt(number, number === 2)
		},
		budget,
	)
	expect(result.ending).toBe('passed')
	expect(received).toEqual(failure)
})

it('attempts are bounded, and running out is a result rather than a fault', async () => {
	const result = await run(item, async (_issue, _previous, number) => attempt(number, false), budget)
	expect(result.ending).toBe('escalated-attempts')
	expect(result.attempts).toHaveLength(budget.attempts.max)
})

it('a stage past its budget stops the run before the attempts are used up', async () => {
	const result = await run(item, async (_issue, _previous, number) => attempt(number, false, true), budget)
	expect(result.ending).toBe('escalated-budget')
	expect(result.attempts).toHaveLength(1)
})

it('human wait is recorded and never bounded', () => {
	// A person takes the time a person takes. Measuring it is the point.
	expect(overBudget('human', 99_999_000, budget)).toBe(false)
	expect(overBudget('verify', 99_999_000, budget)).toBe(true)
})

it('every stage budget carries the reason for its number', () => {
	const silent = Object.entries(budget.stages).filter(([, entry]) => entry.why.trim().length < 20)
	expect(silent.map(([name]) => name)).toEqual([])
})
