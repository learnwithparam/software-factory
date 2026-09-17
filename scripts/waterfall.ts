/**
 * Draw the stage waterfall from the recorded run.
 *
 * The figure it replaces carried numbers nobody measured, under a caption
 * claiming a test read them from the run. Generating it is the only way that
 * sentence becomes true, and it is cheaper than the test that would have had to
 * police a hand-drawn one.
 *
 * Bar widths come from the same numbers as the labels, so a bar cannot disagree
 * with the figure beside it.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'
import type { RunReport } from './run-report.ts'

const OPEN = '<figure class="diagram" data-diagram="stage-waterfall">'
const CLOSE = '</figure>'

/** What each role is called on a slide, rather than in the API. */
const NAMES: Record<string, string> = {
	triage: 'triage',
	plan: 'plan',
	work: 'implement',
	review: 'review',
}

export function waterfall(report: RunReport): string {
	const rows = [
		...report.stages.map((stage) => ({ name: NAMES[stage.role] ?? stage.role, ms: stage.medianMs, label: stage.label, wait: false })),
		{ name: 'human', ms: report.humanWaitMs, label: report.humanWaitLabel, wait: true },
	]

	const widest = Math.max(...rows.map((row) => row.ms), 1)
	const scale = 760 / widest
	const height = 48 + rows.length * 30

	const bars = rows
		.map((row, index) => {
			const y = 36 + index * 30
			const width = Math.max(4, Math.round(row.ms * scale))
			const fill = row.wait ? ' fill="var(--c-wait)"' : ''
			const cls = row.wait ? 'wait' : 'muted'
			const rect = row.wait
				? `<rect x="110" y="${y}" width="${width}" height="16" rx="2"${fill}/>`
				: `<rect class="solid" x="110" y="${y}" width="${width}" height="16" rx="2"/>`
			return `<text x="0" y="${y + 12}" class="small mono ${cls}">${row.name}</text>${rect}<text x="${120 + width}" y="${y + 12}" class="small ${cls}" data-figure="${row.wait ? 'humanWait' : `stage.${row.name}`}">${row.label}</text>`
		})
		.join('\n')

	return `${OPEN}
<svg viewBox="-4 -4 1010 ${height + 40}" role="img" aria-labelledby="d3t">
<title id="d3t">Where the time in one run actually goes</title>
<text x="0" y="14" class="label">one run, every stage timed separately</text>
<g>
${bars}
</g>
<text x="0" y="${height + 20}" class="small muted">Generation is rarely the slow part. Waiting on a person usually is, and it stays invisible until somebody measures it.</text>
</svg>
<figcaption>Figure 3. A run with each stage timed on its own, drawn from <code>evidence/factory-run.json</code> on ${report.model}. Every figure here is the median of what the factory recorded, so none of them can drift from what actually happened.</figcaption>
${CLOSE}`
}

if (import.meta.main) {
	const report = JSON.parse(readFileSync(join(ROOT, 'evidence', 'factory-run.json'), 'utf8')) as RunReport
	const path = join(ROOT, 'teach.html')
	const page = readFileSync(path, 'utf8')

	const start = page.indexOf(OPEN)
	if (start === -1) throw new Error('teach.html has no stage-waterfall figure to replace')
	const end = page.indexOf(CLOSE, start)
	if (end === -1) throw new Error('the stage-waterfall figure is not closed')

	writeFileSync(path, page.slice(0, start) + waterfall(report) + page.slice(end + CLOSE.length))
	console.log(`stage waterfall: ${report.stages.length} stages, human wait ${report.humanWaitLabel}`)
}
