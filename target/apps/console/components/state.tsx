import type { Budget, Outcome } from '@ledger/contracts'

/**
 * One chip per state, so an outcome reads the same everywhere it appears.
 * A refusal is styled as its own state rather than a failure, because a run that
 * declined to touch a protected path did exactly what it was asked to do.
 */
export function OutcomeChip({ outcome }: { outcome: Outcome }) {
	return <span className={`chip ${outcome}`}>{outcome}</span>
}

export function BudgetChip({ state }: { state: Budget['state'] }) {
	return <span className={`chip ${state}`}>{state}</span>
}
