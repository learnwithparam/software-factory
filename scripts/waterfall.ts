/**
 * Describe the stage waterfall from the recorded run.
 *
 * The figure it replaces carried numbers nobody measured, under a caption
 * claiming a test read them from the run. Reading them from evidence/factory-run.json
 * is the only way that sentence becomes true. The result is a description in
 * design/diagrams/, and scripts/diagram.mjs draws it, so a bar cannot disagree
 * with the label beside it.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'
import type { RunReport } from './run-report.ts'

export const SPEC = join(ROOT, 'design', 'diagrams', 'stage-waterfall.json')

/** What each role is called on a page, rather than in the API. */
const NAMES: Record<string, string> = {
	triage: 'Triage',
	plan: 'Plan',
	work: 'Implement',
	review: 'Review',
}

const TICKS = 4
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 3600]

/** An axis whose top is a round number and whose ticks land on round numbers too. */
function axis(widestSeconds: number): { total: number; unit: string; per: number } {
	const seconds = STEPS.find((step) => step * TICKS >= widestSeconds) ?? Math.ceil(widestSeconds / TICKS)
	return seconds >= 60 ? { total: (seconds * TICKS) / 60, unit: ' min', per: 60 } : { total: seconds * TICKS, unit: ' s', per: 1 }
}

export function waterfall(report: RunReport): Record<string, unknown> {
	const rows = [
		...report.stages.map((stage) => ({ label: NAMES[stage.role] ?? stage.role, ms: stage.medianMs, note: stage.label, wait: false })),
		{ label: 'Human wait', ms: report.humanWaitMs, note: report.humanWaitLabel, wait: true },
	]
	const { total, unit, per } = axis(Math.max(...rows.map((row) => row.ms), 1) / 1000)

	return {
		shape: 'timeline',
		alt: 'Where the time in one run goes: each stage timed separately, with the wait on a person as the last bar.',
		caption: `One run with each stage timed on its own, read from evidence/factory-run.json on ${report.model}. Each bar is the median of what the factory recorded. Generation is rarely the slow part. Waiting on a person usually is.`,
		rows: rows.map((row) => ({
			label: row.label,
			start: 0,
			length: Number((row.ms / 1000 / per).toFixed(2)),
			...(row.wait ? { tone: 'wait' } : {}),
			note: row.note,
		})),
		total,
		unit,
		ticks: TICKS,
		labelWidth: 100,
	}
}

if (import.meta.main) {
	const report = JSON.parse(readFileSync(join(ROOT, 'evidence', 'factory-run.json'), 'utf8')) as RunReport
	writeFileSync(SPEC, `${JSON.stringify(waterfall(report), null, 2)}\n`)
	console.log(`stage waterfall: ${report.stages.length} stages, human wait ${report.humanWaitLabel}`)
}
