/**
 * No figure on a teaching page may disagree with the run that produced it.
 *
 * workbook.html says so in a caption, which is a claim, and a claim the code does
 * not assert is the thing this whole repository argues against. Before this
 * test the stage waterfall carried five numbers nobody had measured, under a
 * sentence promising a test had read them.
 *
 * The waterfall is drawn from evidence/factory-run.json by scripts/waterfall.ts, and the
 * timings on the page have to be the ones the record carries.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../scripts/tree-hash.ts'
import type { RunReport } from '../scripts/run-report.ts'

const REPORT = join(ROOT, 'evidence', 'factory-run.json')
const present = existsSync(REPORT)

/** The picture of the stage timings, as the workbook carries it. */
function waterfallFigure(page: string): string {
	return /<figure class="diagram" data-diagram="stage-waterfall">[\s\S]*?<\/figure>/.exec(page)?.[0] ?? ''
}

describe.if(present)('the stage waterfall', () => {
	const report = JSON.parse(readFileSync(REPORT, 'utf8')) as RunReport
	const page = readFileSync(join(ROOT, 'workbook.html'), 'utf8')
	const shown = waterfallFigure(page)
	// String() so a missing field becomes the word undefined and fails by name. An undefined
	// element inside an array is one Bun's toEqual does not count against an empty array.
	const quoted = [...report.stages.map((stage) => stage.label), report.humanWaitLabel].map((label) => String(label))

	it('is placed, and quotes a timing for every stage and the wait', () => {
		expect(shown).not.toBe('')
		expect(quoted.filter((label) => label === 'undefined' || label === '')).toEqual([])
	})

	it('shows exactly what the record says', () => {
		const drifted = quoted.filter((label) => !shown.includes(`>${label}<`))
		expect(drifted, 'timings the record carries that the picture does not show').toEqual([])
	})

	it('names the model the run was made on', () => {
		expect(shown).toContain(report.model)
	})
})
