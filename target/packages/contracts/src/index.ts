/**
 * The one definition of what the ledger stores.
 *
 * The field lists are the runtime half: contract.test.ts asserts each equals its
 * JSON schema's properties, and the Go and Rust services assert the same thing
 * from their side. Three languages, one definition, three tests that go red
 * together when it moves.
 */

export type Currency = 'EUR' | 'USD'
export type Outcome = 'passed' | 'failed' | 'refused' | 'escalated'
export type StageName = 'claim' | 'context' | 'implement' | 'gates' | 'verify' | 'human'
export type BudgetState = 'under' | 'warning' | 'breached'

export interface Run {
	id: string
	item: string
	outcome: Outcome
	startedAt: string
	endedAt: string
	tokensIn: number
	tokensOut: number
	costMinor: number
	currency: Currency
}

export interface Stage {
	runId: string
	name: StageName
	startedAt: string
	endedAt: string
	toolCalls: number
}

export interface Budget {
	period: string
	limitMinor: number
	spentMinor: number
	remainingMinor: number
	currency: Currency
	state: BudgetState
}

export const RUN_FIELDS = [
	'id', 'item', 'outcome', 'startedAt', 'endedAt', 'tokensIn', 'tokensOut', 'costMinor', 'currency',
] as const

export const STAGE_FIELDS = ['runId', 'name', 'startedAt', 'endedAt', 'toolCalls'] as const

export const BUDGET_FIELDS = [
	'period', 'limitMinor', 'spentMinor', 'remainingMinor', 'currency', 'state',
] as const

export const STAGE_ORDER: readonly StageName[] = [
	'claim', 'context', 'implement', 'gates', 'verify', 'human',
]

/** Milliseconds between two RFC 3339 instants. Negative durations are a bug, not a value. */
export function durationMs(startedAt: string, endedAt: string): number {
	const ms = Date.parse(endedAt) - Date.parse(startedAt)
	if (Number.isNaN(ms)) throw new Error(`unparseable instant in ${startedAt}..${endedAt}`)
	if (ms < 0) throw new Error(`stage ended before it started: ${startedAt}..${endedAt}`)
	return ms
}

/** Format minor units for display, without ever dividing a currency amount. */
export function formatMinor(amountMinor: number, currency: Currency): string {
	const symbol = currency === 'EUR' ? '€' : '$'
	const sign = amountMinor < 0 ? '-' : ''
	const abs = Math.abs(amountMinor)
	return `${sign}${symbol}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
