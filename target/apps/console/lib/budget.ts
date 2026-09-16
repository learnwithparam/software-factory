/**
 * Asking the money question.
 *
 * The console never computes a budget. It totals nothing, applies no threshold
 * and decides no state. It shells out to the Rust binary that owns those rules,
 * because that crate is the money path and the charter marks it load bearing.
 * Keeping the calculation in one place is what makes the protected path mean
 * something: there is no second implementation here to drift from it.
 */

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Budget, Currency, Run } from '@ledger/contracts'

const run = promisify(execFile)

/**
 * Where the budget binary lives.
 *
 * Resolved when it is called, not when this module loads. Next evaluates modules
 * while collecting page data, and `import.meta.dirname` is undefined inside that
 * bundle, so computing it at the top level failed the build rather than the call.
 */
function binaryPath(): string {
	const configured = process.env.BUDGET_CLI
	if (configured !== undefined && configured !== '') return configured
	// The console runs from apps/console, so the money path is two levels up.
	return join(process.cwd(), '..', '..', 'services', 'budget', 'target', 'debug', 'budget-cli')
}

export type BudgetAnswer =
	| { ok: true; budget: Budget }
	| { ok: false; reason: string }

/** The month a run belongs to, as the budget engine writes periods. */
export function periodOf(instant: string): string {
	return instant.slice(0, 7)
}

/** Total one period's spend. Refuses to mix currencies rather than adding across them. */
export function spendFor(runs: Run[], period: string): { minor: number; currency: Currency } | undefined {
	const inPeriod = runs.filter((entry) => periodOf(entry.startedAt) === period)
	const first = inPeriod[0]
	if (first === undefined) return undefined
	if (inPeriod.some((entry) => entry.currency !== first.currency)) return undefined
	return {
		minor: inPeriod.reduce((sum, entry) => sum + entry.costMinor, 0),
		currency: first.currency,
	}
}

/**
 * Ask the budget engine where a period stands.
 *
 * A missing binary is reported rather than filled in with a plausible answer,
 * because a wrong number about money is worse than no number.
 */
export async function assess(
	period: string,
	limitMinor: number,
	spentMinor: number,
	currency: Currency,
): Promise<BudgetAnswer> {
	try {
		const { stdout } = await run(
			binaryPath(),
			[period, String(limitMinor), String(spentMinor), currency],
			{ timeout: 4000 },
		)
		return { ok: true, budget: JSON.parse(stdout) as Budget }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		return {
			ok: false,
			reason: message.includes('ENOENT')
				? 'The budget engine is not built. Run cargo build in services/budget.'
				: message,
		}
	}
}
