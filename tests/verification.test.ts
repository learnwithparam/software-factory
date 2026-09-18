/**
 * Phase 7: nothing may claim more than the run proved.
 *
 * The gate runs for real against the fixture, including the case where a
 * required check is missing, because that is the one people assume is covered
 * and is not.
 */

import { expect, it } from 'bun:test'
import { join } from 'node:path'
import { runGate } from '../steps/04-verification/gate.ts'
import { judge, weakenedTests, type Claimed, type Evidence } from '../steps/04-verification/verifier.ts'
import { issue } from '../steps/lib/issues.ts'
import { loadRepo } from '../steps/lib/repo.ts'

const SAMPLE = join(import.meta.dirname, 'fixtures', 'sample')
const repo = loadRepo(SAMPLE)
const item = issue(SAMPLE, '1')

const passing: Claimed = {
	judgement: 'pass',
	findings: [],
	gateLine: 'VERDICT: PASS every selected check passed',
}
const proven: Evidence = {
	changedFiles: [...item.paths],
	gateLine: 'VERDICT: PASS every selected check passed',
	negativeProof: { testName: 'a new test', redWithoutChange: true },
	holdout: [{ name: 'an independent check', passed: true }],
}

it('the gate runs the commands the repository declares and passes', () => {
	const result = runGate(repo, ['app/page.txt'])
	expect(result.state).toBe('PASS')
	expect(result.exitCode).toBe(0)
	expect(result.runs.length).toBeGreaterThan(0)
})

it('a missing test command is misconfigured, which is neither a pass nor a failure', () => {
	// Absence and success are indistinguishable from outside. Only one is safe.
	const result = runGate(repo, ['app/page.txt'], { withoutTests: true })
	expect(result.state).toBe('MISCONFIGURED')
	expect(result.exitCode).toBe(2)
})

it('a path no target owns is misconfigured rather than quietly skipped', () => {
	const result = runGate(repo, ['nowhere/thing.txt'])
	expect(result.state).toBe('MISCONFIGURED')
	expect(result.line).toContain('owned by no target')
})

it('the verdict is one line, and it says which state it is', () => {
	expect(runGate(repo, ['app/page.txt']).line).toStartWith('VERDICT: PASS')
})

it('a claim with every proof in place stands', () => {
	expect(judge(item, passing, proven).judgement).toBe('pass')
})

it('a pass with no reverted proof is downgraded', () => {
	const result = judge(item, passing, { ...proven, negativeProof: undefined })
	expect(result.judgement).toBe('needs-review')
	expect(result.downgradedFrom).toBe('pass')
})

it('a test that stayed green while its subject was broken fails the run', () => {
	const result = judge(item, passing, {
		...proven,
		negativeProof: { testName: 'x', redWithoutChange: false },
	})
	expect(result.judgement).toBe('fail')
})

it('a misconfigured gate outranks a reviewer who called it a pass', () => {
	const line = 'VERDICT: MISCONFIGURED no test command ran'
	expect(judge(item, { ...passing, gateLine: line }, { ...proven, gateLine: line }).judgement).toBe('fail')
})

it('a quoted gate line that does not match the real one is downgraded', () => {
	// An agent reporting that everything passed is a claim, not evidence.
	expect(judge(item, { ...passing, gateLine: 'VERDICT: PASS all good' }, proven).judgement).not.toBe('pass')
})

it('files the task did not name are reported', () => {
	const result = judge(item, passing, { ...proven, changedFiles: [...item.paths, 'lib/core.txt'] })
	expect(result.reasons.join(' ')).toContain('did not name')
})

it('a run with no independent check is downgraded', () => {
	expect(judge(item, passing, { ...proven, holdout: [] }).judgement).toBe('needs-review')
})

it('weakening an existing assertion is caught as a property of the diff', () => {
	// No glob can express this one, so it is not on the protected path list.
	const diff = [
		'+++ b/app/thing.test.ts',
		'-\texpect(value).toBe(0)',
		'-\texpect(total).toBeCloseTo(1, 10)',
		'+\texpect(typeof value).toBe("number")',
	].join('\n')
	expect(weakenedTests(diff)).toHaveLength(1)
})

it('adding tests is not mistaken for weakening them', () => {
	const diff = ['+++ b/app/thing.test.ts', '+\texpect(value).toBe(0)'].join('\n')
	expect(weakenedTests(diff)).toEqual([])
})
