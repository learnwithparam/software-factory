/**
 * Self-healing: failing usefully, and stopping.
 *
 * Two roles, not one. The Doer implements. The Tester decides whether the
 * result meets the task, and when it does not, hands back the reason attached
 * to the failure rather than a bare rejection. The next attempt starts from that
 * reason, which is what makes it cheap.
 *
 * Every cycle has three declared endings: it passed, it ran out of attempts, or
 * it ran out of time. Escalation is a real outcome. An item returned to a person
 * with its attempts recorded is more useful than a run that is still going.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../lib/graph.ts'
import type { Task } from '../03-context/router.ts'

export const BUDGET = join(ROOT, 'steps/05-loop/budget.json')

export type StageName = 'claim' | 'context' | 'implement' | 'gates' | 'verify' | 'human'

export interface Budget {
	readonly attempts: { max: number; why: string }
	readonly stages: Record<StageName, { seconds: number; why: string }>
}

export function loadBudget(path: string = BUDGET): Budget {
	const raw = JSON.parse(readFileSync(path, 'utf8')) as Budget
	if (!raw.attempts || !raw.stages) throw new Error(`${path} declares no attempts or stages`)
	return raw
}

/** What the Tester hands back. A rejection with nowhere to start from is not useful. */
export interface Failure {
	readonly stage: StageName
	readonly what: string
	readonly where: string
	readonly expected: string
	readonly output: string
}

export interface Attempt {
	readonly number: number
	readonly passed: boolean
	readonly failure?: Failure
	readonly stages: Array<{ name: StageName; ms: number; overBudget: boolean }>
}

export type Ending = 'passed' | 'escalated-attempts' | 'escalated-budget'

export interface LoopResult {
	readonly task: Task
	readonly ending: Ending
	readonly attempts: Attempt[]
	readonly reason: string
}

/** A Doer: given the task and the last failure, produce a result. */
export type Doer = (task: Task, previous: Failure | undefined, attempt: number) => Promise<Attempt>

/**
 * Run the loop until it ends, and make sure it can.
 *
 * The result always names which of the three endings happened. A loop whose
 * return type allows "still going" is a loop that will.
 */
export async function run(task: Task, doer: Doer, budget: Budget = loadBudget()): Promise<LoopResult> {
	const attempts: Attempt[] = []
	let previous: Failure | undefined

	for (let number = 1; number <= budget.attempts.max; number += 1) {
		const attempt = await doer(task, previous, number)
		attempts.push(attempt)

		const blown = attempt.stages.find((stage) => stage.overBudget)
		if (blown !== undefined) {
			return {
				task,
				attempts,
				ending: 'escalated-budget',
				reason: `${blown.name} ran past its budget of ${budget.stages[blown.name].seconds}s. ${budget.stages[blown.name].why}`,
			}
		}

		if (attempt.passed) {
			return { task, attempts, ending: 'passed', reason: `passed on attempt ${number}` }
		}
		previous = attempt.failure
	}

	return {
		task,
		attempts,
		ending: 'escalated-attempts',
		reason: `${budget.attempts.max} attempts with the reason attached, still failing. ${budget.attempts.why}`,
	}
}

/** The packet the next attempt starts from. */
export function handback(failure: Failure): string {
	return [
		`The previous attempt failed at ${failure.stage}.`,
		`What failed: ${failure.what}`,
		`Where: ${failure.where}`,
		`What the task said should be true: ${failure.expected}`,
		'',
		'Output:',
		failure.output.trim(),
		'',
		'Start from this. Do not begin again.',
	].join('\n')
}

/** Is this stage over its budget? Human wait is recorded, never bounded. */
export function overBudget(stage: StageName, ms: number, budget: Budget = loadBudget()): boolean {
	const seconds = budget.stages[stage].seconds
	return seconds > 0 && ms > seconds * 1000
}
