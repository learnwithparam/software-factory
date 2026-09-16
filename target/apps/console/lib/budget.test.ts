import { describe, expect, it } from 'bun:test'
import type { Run } from '@ledger/contracts'
import { periodOf, spendFor } from './budget.ts'

function run(costMinor: number, startedAt: string, currency: Run['currency'] = 'EUR'): Run {
	return {
		id: `r-${startedAt}-${costMinor}`,
		item: 'item',
		outcome: 'passed',
		startedAt,
		endedAt: startedAt,
		tokensIn: 0,
		tokensOut: 0,
		costMinor,
		currency,
	}
}

describe('periodOf', () => {
	it('is the calendar month the budget engine expects', () => {
		expect(periodOf('2026-09-16T10:00:00Z')).toBe('2026-09')
	})
})

describe('spendFor', () => {
	it('totals only the runs inside the period', () => {
		const runs = [run(100, '2026-09-01T00:00:00Z'), run(50, '2026-08-31T23:59:59Z')]
		expect(spendFor(runs, '2026-09')).toEqual({ minor: 100, currency: 'EUR' })
	})

	it('is undefined when the period has no runs, rather than reporting zero spend', () => {
		// Zero spend and no data look identical on a page, and only one is true.
		expect(spendFor([run(100, '2026-09-01T00:00:00Z')], '2026-07')).toBeUndefined()
	})

	it('refuses to add across currencies rather than producing a meaningless total', () => {
		const runs = [run(100, '2026-09-01T00:00:00Z', 'EUR'), run(100, '2026-09-02T00:00:00Z', 'USD')]
		expect(spendFor(runs, '2026-09')).toBeUndefined()
	})
})
