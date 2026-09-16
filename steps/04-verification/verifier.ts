/**
 * Verification: deciding what a result is allowed to claim.
 *
 * Two ideas live here, and they are separate on purpose.
 *
 * The cold read: a second agent receives the task and the diff, and explicitly
 * not the account of how the work went. Told what was attempted, a reviewer
 * anchors on it and starts confirming rather than checking.
 *
 * The evidence rules: after the agent has finished talking, ordinary code reads
 * the artifacts the run produced and decides what the verdict may say. A pass
 * whose test output cannot be found is downgraded. A pass with no reverted proof
 * is downgraded. What the agent said about the run is never consulted.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../lib/graph.ts'
import type { Task } from '../03-context/router.ts'

export type Judgement = 'pass' | 'fail' | 'needs-review'

export interface Finding {
	readonly file: string
	readonly what: string
}

/** What the reviewing agent returns. Its claim, before any rule is applied. */
export interface Claimed {
	readonly judgement: Judgement
	readonly findings: readonly Finding[]
	/** The exact verdict line from the gate script, quoted rather than summarised. */
	readonly gateLine: string
}

/** What the run actually produced, read from disk rather than from the agent. */
export interface Evidence {
	/** Files the change touched, relative to the repository root. */
	readonly changedFiles: readonly string[]
	/** The gate script's own last line. */
	readonly gateLine: string
	/** Whether a new test was shown to fail without the change. */
	readonly negativeProof?: { testName: string; redWithoutChange: boolean }
	/** Results of the checks the implementing agent never saw. */
	readonly holdout?: ReadonlyArray<{ name: string; passed: boolean }>
}

export interface Verdict {
	readonly judgement: Judgement
	readonly reasons: readonly string[]
	readonly findings: readonly Finding[]
	readonly downgradedFrom?: Judgement
}

const TEST_PATTERN = /(\.test\.[tj]sx?|_test\.go|^tests?\/|\/tests?\/)/

/**
 * Apply the rules, in order, to what the run produced.
 *
 * Every rule can only make the verdict stricter. None of them can turn a
 * failure into a pass, because the point is to bound what may be asserted, not
 * to argue with the reviewer.
 */
export function judge(task: Task, claimed: Claimed, evidence: Evidence): Verdict {
	const reasons: string[] = []
	let judgement = claimed.judgement
	const original = claimed.judgement

	const downgrade = (to: Judgement, why: string): void => {
		const rank: Record<Judgement, number> = { pass: 0, 'needs-review': 1, fail: 2 }
		if (rank[to] > rank[judgement]) judgement = to
		reasons.push(why)
	}

	// The quotation rule. The reviewer must reproduce the gate's line exactly.
	if (claimed.gateLine.trim() !== evidence.gateLine.trim()) {
		downgrade('needs-review', 'the quoted gate line does not match the one the gate wrote')
	}

	// The gate rule. Its own line outranks any opinion about it.
	if (evidence.gateLine.startsWith('VERDICT: MISCONFIGURED')) {
		downgrade('fail', 'the gate reported a missing check, which is neither a pass nor a failure')
	} else if (evidence.gateLine.startsWith('VERDICT: FAIL')) {
		downgrade('fail', 'the gate failed')
	} else if (!evidence.gateLine.startsWith('VERDICT: PASS')) {
		downgrade('needs-review', 'no gate verdict was recorded for this run')
	}

	// The scope rule. Files the task did not name are the most common real defect.
	const declared = new Set(task.paths)
	const extra = evidence.changedFiles.filter((file) => !declared.has(file))
	if (extra.length > 0) {
		downgrade('needs-review', `changed ${extra.length} file(s) the task did not name: ${extra.join(', ')}`)
	}

	// The evidence rule. A pass with no reverted proof is not a pass.
	if (evidence.negativeProof === undefined) {
		downgrade('needs-review', 'no test was shown to fail without the change')
	} else if (!evidence.negativeProof.redWithoutChange) {
		downgrade('fail', `${evidence.negativeProof.testName} stayed green while its subject was broken`)
	}

	// The independence rule. Checks the writer never saw carry more weight.
	const heldOut = evidence.holdout ?? []
	const brokenHoldout = heldOut.filter((check) => !check.passed)
	if (heldOut.length === 0) {
		downgrade('needs-review', 'no holdout check ran, so nothing independent confirmed the behaviour')
	} else if (brokenHoldout.length > 0) {
		downgrade('fail', `${brokenHoldout.length} holdout check(s) failed: ${brokenHoldout[0]?.name}`)
	}

	return {
		judgement,
		reasons,
		findings: claimed.findings,
		...(judgement === original ? {} : { downgradedFrom: original }),
	}
}

/**
 * Did this change weaken an existing test?
 *
 * No glob can express it, so it is a property of the diff. Adding tests is
 * ordinary work. Removing assertions from one that already existed is how a
 * failing run turns itself green.
 */
export function weakenedTests(diff: string): Finding[] {
	const findings: Finding[] = []
	let file = ''
	let removed = 0
	let added = 0

	const flush = (): void => {
		if (file !== '' && TEST_PATTERN.test(file) && removed > added) {
			findings.push({
				file,
				what: `${removed} assertion lines removed and ${added} added in an existing test`,
			})
		}
		removed = 0
		added = 0
	}

	for (const line of diff.split('\n')) {
		if (line.startsWith('+++ b/')) {
			flush()
			file = line.slice('+++ b/'.length)
			continue
		}
		const isAssertion = /\b(expect|assert|t\.Fatal|t\.Error|require)\b/.test(line)
		if (!isAssertion) continue
		if (line.startsWith('-')) removed += 1
		else if (line.startsWith('+')) added += 1
	}
	flush()
	return findings
}

/** Where a recorded review lives for a task, when the executor is replaying. */
export function transcriptFor(taskId: string): string {
	return join(ROOT, 'steps/04-verification/transcripts', `${taskId}.json`)
}

export function hasTranscript(taskId: string): boolean {
	return existsSync(transcriptFor(taskId))
}
