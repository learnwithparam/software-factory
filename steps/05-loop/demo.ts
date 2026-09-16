/**
 * Step five on stage: recovering, and knowing when to stop.
 *
 * `run <item>`              a failure handed back with its reason, and a second attempt that uses it
 * `run <item> --impossible` attempts exhausted, the item escalated with its history
 * `run <item> --slow`       a stage over budget, stopped with accurate state
 * `budget`                  where the time actually went
 */

import { allowed, failed, note, refused, step, table, title, verdict, waiting } from '../lib/out.ts'
import { findTask } from '../03-context/router.ts'
import { humanish } from './report.ts'
import { handback, loadBudget, overBudget, run, type Attempt, type Failure, type StageName } from './loop.ts'

const FIRST_FAILURE: Failure = {
	stage: 'gates',
	what: 'the console suite failed one check',
	where: 'apps/console/lib/ledger.test.ts:31',
	expected: 'shares sum to one, so the bars cannot exceed the whole',
	output: 'expected 1, received 0.9791666666666666',
}

function stages(timings: Partial<Record<StageName, number>>): Attempt['stages'] {
	const budget = loadBudget()
	return Object.entries(timings).map(([name, ms]) => ({
		name: name as StageName,
		ms: ms as number,
		overBudget: overBudget(name as StageName, ms as number, budget),
	}))
}

const HAPPY: Record<StageName, number> = {
	claim: 4_000,
	context: 31_000,
	implement: 151_000,
	gates: 136_000,
	verify: 132_000,
	human: 0,
}

/** A Doer that fails once, reads the reason, and succeeds. */
function recovering() {
	return async (_task: unknown, previous: Failure | undefined, attempt: number): Promise<Attempt> => {
		if (attempt === 1) {
			return { number: 1, passed: false, failure: FIRST_FAILURE, stages: stages(HAPPY) }
		}
		if (previous === undefined) throw new Error('the second attempt was given no reason to start from')
		return { number: attempt, passed: true, stages: stages({ ...HAPPY, implement: 47_000 }) }
	}
}

/** A Doer for work that cannot be done. */
function neverSucceeds() {
	return async (_task: unknown, _previous: Failure | undefined, attempt: number): Promise<Attempt> => ({
		number: attempt,
		passed: false,
		failure: { ...FIRST_FAILURE, what: `attempt ${attempt} failed the same check` },
		stages: stages(HAPPY),
	})
}

/** A Doer whose verification never ends. */
function tooSlow() {
	return async (_task: unknown, _previous: Failure | undefined, attempt: number): Promise<Attempt> => ({
		number: attempt,
		passed: false,
		failure: FIRST_FAILURE,
		stages: stages({ ...HAPPY, verify: 1_920_000 }),
	})
}

async function doRun(id: string, mode: 'recover' | 'impossible' | 'slow'): Promise<number> {
	const task = findTask(id)
	const doer = { recover: recovering(), impossible: neverSucceeds(), slow: tooSlow() }[mode]

	title(`Task ${task.id}: ${task.title}`)
	const result = await run(task, doer)

	for (const attempt of result.attempts) {
		if (attempt.passed) {
			allowed(`attempt ${attempt.number} passed`)
			continue
		}
		failed(`attempt ${attempt.number} failed at ${attempt.failure?.stage}`)
		if (attempt.failure !== undefined && attempt.number < result.attempts.length) {
			title('What goes back to the Doer')
			console.log(handback(attempt.failure))
			note('A status with no detail produces a retry that repeats the same mistake.')
		}
	}

	title('How it ended')
	switch (result.ending) {
		case 'passed':
			allowed(result.reason)
			verdict('PASS', 'Recovered without anybody restarting it.')
			return 0
		case 'escalated-attempts':
			waiting(result.reason)
			note('An item back with a person, with its attempts recorded, is a result. A run still going is not.')
			verdict('NEEDS REVIEW', 'Escalated rather than spun.')
			return 0
		case 'escalated-budget':
			refused(result.reason)
			note('The state left behind is accurate, so the next run resumes rather than starting over.')
			verdict('NEEDS REVIEW', 'Stopped on time, not on failure.')
			return 0
	}
}

function doBudget(): number {
	const budget = loadBudget()

	title('Where the time went')
	const total = Object.values(HAPPY).reduce((sum, ms) => sum + ms, 0) + 2_700_000
	const measured: Array<[StageName, number]> = [
		['claim', HAPPY.claim],
		['context', HAPPY.context],
		['implement', HAPPY.implement],
		['gates', HAPPY.gates],
		['verify', HAPPY.verify],
		['human', 2_700_000],
	]
	const width = 32
	for (const [name, ms] of measured) {
		const share = ms / total
		const bar = '█'.repeat(Math.max(1, Math.round(share * width)))
		console.log(`  ${name.padEnd(10)} ${bar.padEnd(width)} ${humanish(ms).padStart(7)}  ${(share * 100).toFixed(0).padStart(3)}%`)
	}
	note('Generation is rarely the slow part. Waiting on a person usually is, and it is invisible until it is measured.')

	title('What each stage may spend')
	table(
		['stage', 'budget', 'why'],
		Object.entries(budget.stages).map(([name, entry]) => [
			name,
			entry.seconds === 0 ? 'unbounded' : `${entry.seconds}s`,
			entry.why,
		]),
	)
	step('A stage past its budget stops the run and leaves the item where a person can pick it up.')
	verdict('PASS', 'Every stage is timed separately, which is the only way to know which one to attack.')
	return 0
}

const argv = process.argv.slice(2)
const [command = 'budget', argument] = argv

const mode = argv.includes('--impossible') ? 'impossible' : argv.includes('--slow') ? 'slow' : 'recover'

if (command === 'budget') process.exit(doBudget())
else if (command === 'run') process.exit(await doRun(argument ?? '12', mode))
else {
	console.error(`unknown command: ${command}`)
	console.error('usage: demo.ts [run <item> [--impossible|--slow]|budget]')
	process.exit(2)
}
