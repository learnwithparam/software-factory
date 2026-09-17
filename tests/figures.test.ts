/**
 * No figure on a teaching page may disagree with the run that produced it.
 *
 * teach.html says so in a caption, which is a claim, and a claim the code does
 * not assert is the thing this whole repository argues against. Before this
 * test the stage waterfall carried five numbers nobody had measured, under a
 * sentence promising a test had read them.
 *
 * Every figure the surfaces quote carries `data-figure`, and every one of those
 * keys has to resolve in evidence/factory-run.json to exactly the text shown.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../scripts/tree-hash.ts'
import type { RunReport } from '../scripts/run-report.ts'

const REPORT = join(ROOT, 'evidence', 'factory-run.json')
const present = existsSync(REPORT)

/** The value a key names, or undefined when the record does not carry it. */
function figure(report: RunReport, key: string): string | undefined {
	if (key === 'humanWait') return report.humanWaitLabel
	const stage = /^stage\.(.+)$/.exec(key)?.[1]
	if (stage === undefined) return undefined
	const names: Record<string, string> = { triage: 'triage', plan: 'plan', implement: 'work', review: 'review' }
	const role = names[stage] ?? stage
	return report.stages.find((entry) => entry.role === role)?.label
}

describe.if(present)('every quoted figure', () => {
	const report = JSON.parse(readFileSync(REPORT, 'utf8')) as RunReport
	const page = readFileSync(join(ROOT, 'teach.html'), 'utf8')
	const quoted = [...page.matchAll(/data-figure="([^"]+)"[^>]*>([^<]*)</g)].map((m) => ({
		key: m[1] as string,
		shown: (m[2] as string).trim(),
	}))

	it('is bound to a key the record carries', () => {
		expect(quoted.length).toBeGreaterThan(0)
		const unknown = quoted.filter((entry) => figure(report, entry.key) === undefined)
		expect(unknown.map((entry) => entry.key)).toEqual([])
	})

	it('shows exactly what the record says', () => {
		const drifted = quoted
			.filter((entry) => figure(report, entry.key) !== entry.shown)
			.map((entry) => `${entry.key}: page says ${entry.shown}, the run says ${figure(report, entry.key)}`)
		expect(drifted).toEqual([])
	})

	it('names the model the run was made on', () => {
		expect(page).toContain(report.model)
	})
})
