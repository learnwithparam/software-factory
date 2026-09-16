/**
 * Step four on stage: making the work prove itself.
 *
 * `gate`                    the checks, and the one line they end in
 * `negative-proof`          undo the change, watch the test go red
 * `negative-proof --toothless`  a test that passes whatever the code does
 * `holdout`                 checks the writer never saw
 * `verify`                  the cold read, and what it is not given
 * `evidence`                deciding in code what a verdict may claim
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allowed, failed, note, refused, step, table, title, verdict } from '../lib/out.ts'
import { findTask } from '../03-context/router.ts'
import { judge, transcriptFor, weakenedTests, type Claimed, type Evidence } from './verifier.ts'

/** A tiny module and its test, written to a scratch directory so the proof is real. */
function scratch(implementation: string, test: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'factory-proof-'))
	writeFileSync(join(dir, 'share.ts'), implementation)
	writeFileSync(join(dir, 'share.test.ts'), test)
	return dir
}

function runBunTest(dir: string): { passed: boolean; summary: string } {
	const result = Bun.spawnSync(['bun', 'test'], { cwd: dir })
	const output = new TextDecoder().decode(result.stderr) + new TextDecoder().decode(result.stdout)
	const line = output.split('\n').find((entry) => /\d+ (pass|fail)/.test(entry)) ?? ''
	return { passed: result.exitCode === 0, summary: line.trim() }
}

const FIXED = `export function share(part: number, whole: number): number {
	// The fix: a whole of zero has no shares, and dividing would produce NaN,
	// which renders as an empty bar rather than as an error anybody notices.
	if (whole === 0) return 0
	return part / whole
}
`

const BROKEN = `export function share(part: number, whole: number): number {
	return part / whole
}
`

const REAL_TEST = `import { expect, test } from 'bun:test'
import { share } from './share.ts'

test('a whole of zero has no shares rather than NaN', () => {
	expect(share(3, 0)).toBe(0)
})
`

const TOOTHLESS_TEST = `import { expect, test } from 'bun:test'
import { share } from './share.ts'

test('share returns a number', () => {
	// Passes whether or not the fix is present, which is the whole problem.
	expect(typeof share(3, 0)).toBe('number')
})
`

function doNegativeProof(toothless: boolean): number {
	const test = toothless ? TOOTHLESS_TEST : REAL_TEST
	const dir = scratch(FIXED, test)
	try {
		title(toothless ? 'A test that does not bite' : 'The check no gate can make')

		step('with the change in place')
		const withChange = runBunTest(dir)
		if (withChange.passed) allowed(`green: ${withChange.summary}`)
		else failed(`the test fails even with the change: ${withChange.summary}`)

		step('now undo the change, keeping the test')
		writeFileSync(join(dir, 'share.ts'), BROKEN)
		const withoutChange = runBunTest(dir)

		if (!withoutChange.passed) {
			allowed(`red: ${withoutChange.summary}`)
			step('restore the change')
			writeFileSync(join(dir, 'share.ts'), FIXED)
			allowed(`green again: ${runBunTest(dir).summary}`)
			verdict('PASS', 'The test is connected to the behaviour it claims to cover.')
			return 0
		}

		refused(`still green without the change: ${withoutChange.summary}`)
		note('A test that has never been red is not known to test anything.')
		verdict('FAIL', 'The suite passes, and it proves nothing.')
		return 1
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

interface Transcript {
	given: string[]
	withheld: string[]
	claimed: { judgement: string; findings: Array<{ file: string; what: string }> }
}

function doVerify(id = '12'): number {
	const recorded = JSON.parse(readFileSync(transcriptFor(id), 'utf8')) as Transcript
	const task = findTask(id)

	title('What the reviewer is given')
	for (const item of recorded.given) allowed(item)

	title('And what it is deliberately not given')
	for (const item of recorded.withheld) refused(item)
	note('Told what was attempted, a reviewer anchors on it and starts confirming rather than checking.')

	title('Its findings')
	for (const finding of recorded.claimed.findings) {
		failed(finding.file)
		note(finding.what)
	}

	verdict(
		recorded.claimed.judgement === 'pass' ? 'PASS' : 'FAIL',
		`${recorded.claimed.findings.length} finding(s) on a change whose own suite was green. Task ${task.id}.`,
	)
	return 0
}

function doHoldout(): number {
	title('Checks the implementing agent never saw')
	note('They live outside the target and the router never routes them, so nothing can aim at them.')
	table(
		['check', 'what it protects'],
		[
			['a run list is bounded', 'a list that grows without a limit eventually takes the page down'],
			['an absurd limit is refused', 'a caller must not be able to ask for everything'],
			['a missing run is a not-found', 'an empty success and a missing row look identical otherwise'],
			['stages come back in loop order', 'a retried delivery arrives out of order'],
			['a refusal is represented', 'sample data that only succeeds teaches the wrong lesson'],
		],
	)
	step('Run them against a live ledger with: make demo STEP=06')
	verdict('PASS', 'Five independent checks, none of them visible to the writer.')
	return 0
}

function doEvidence(lostArtifact: boolean): number {
	const task = findTask('12')
	const claimed: Claimed = {
		judgement: 'pass',
		findings: [],
		gateLine: 'VERDICT: PASS every selected check passed',
	}
	const evidence: Evidence = {
		changedFiles: [...task.paths],
		gateLine: 'VERDICT: PASS every selected check passed',
		negativeProof: lostArtifact ? undefined : { testName: 'the empty state names what is missing', redWithoutChange: true },
		holdout: lostArtifact ? [] : [{ name: 'a missing run is a not-found', passed: true }],
	}

	title(lostArtifact ? 'The same claim, with its proof missing' : 'A claim with its proof present')
	step(`the reviewing agent says: ${claimed.judgement}`)

	const result = judge(task, claimed, evidence)
	for (const reason of result.reasons) refused(reason)

	if (result.downgradedFrom !== undefined) {
		note(`downgraded from ${result.downgradedFrom} by code the agent never ran`)
	} else {
		allowed('every rule is satisfied, so the claim stands')
	}

	title('And the rule no path list can express')
	const diff = [
		'+++ b/target/apps/console/lib/ledger.test.ts',
		'-\texpect(bars[0].share).toBe(0)',
		'-\texpect(total).toBeCloseTo(1, 10)',
		'+\texpect(typeof bars[0].share).toBe("number")',
	].join('\n')
	for (const finding of weakenedTests(diff)) {
		failed(`${finding.file}: ${finding.what}`)
	}
	note('Adding tests is ordinary work. Editing one so a failure disappears is not.')

	const banner = { pass: 'PASS', fail: 'FAIL', 'needs-review': 'NEEDS REVIEW' } as const
	verdict(banner[result.judgement], 'Decided after the agent stopped talking, by code it never ran.')
	return 0
}

function doGate(): number {
	title('The gate, and the one line it ends in')
	const result = Bun.spawnSync(['bash', 'steps/04-verification/gates.sh', '--paths', 'apps/console/app/page.tsx'], {
		cwd: join(import.meta.dir, '..', '..'),
	})
	console.log(new TextDecoder().decode(result.stdout).trim())
	note('Nothing downstream may restate that line. A summary of it is a claim; the line is evidence.')
	return result.exitCode ?? 1
}

const argv = process.argv.slice(2)
const [command = 'evidence'] = argv

const commands: Record<string, () => number> = {
	gate: doGate,
	'negative-proof': () => doNegativeProof(argv.includes('--toothless')),
	holdout: doHoldout,
	verify: doVerify,
	evidence: () => doEvidence(argv.includes('--lost-artifact')),
}

const chosen = commands[command]
if (chosen === undefined) {
	console.error(`unknown command: ${command}`)
	console.error('usage: demo.ts [gate|negative-proof [--toothless]|holdout|verify|evidence [--lost-artifact]]')
	process.exit(2)
}
process.exit(chosen())
