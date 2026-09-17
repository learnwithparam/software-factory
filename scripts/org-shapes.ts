/**
 * Draw the four company shapes from the four profiles.
 *
 * The figure this replaces was authored by hand and had drifted: it showed runs
 * starting themselves under `startup`, where profiles/startup/board.json sets
 * autoRunEnabled false, and it described enterprise as "refused, and routed"
 * when routing to an owning team is what distinguishes scaleup from it.
 *
 * A diagram is a claim. This one is now read from the same files `make profile`
 * copies into the repository, so the slide and the switch cannot disagree.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'

const OPEN = '<figure class="diagram" data-diagram="org-shapes">'
const CLOSE = '</figure>'
const SHAPES = ['solo', 'startup', 'scaleup', 'enterprise'] as const

interface Board {
	readonly autoRunEnabled: boolean
	readonly autoApprovePlans: boolean
	readonly reviewQueueCap: number
}

function board(shape: string): Board {
	return JSON.parse(readFileSync(join(ROOT, 'profiles', shape, 'board.json'), 'utf8')) as Board
}

function autonomy(shape: string, target: string): string {
	const graph = JSON.parse(readFileSync(join(ROOT, 'profiles', shape, 'targets.json'), 'utf8')) as {
		targets: Record<string, { autonomy: string }>
	}
	return graph.targets[target]?.autonomy ?? '?'
}

function protectsMoney(shape: string): boolean {
	return readFileSync(join(ROOT, 'profiles', shape, 'charter.md'), 'utf8').includes('services/budget/**')
}

/** What happens to the money item, derived rather than asserted. */
function moneyOutcome(shape: string): { text: string; className: string } {
	const level = autonomy(shape, 'budget')
	if (level === 'build') return { text: 'a pull request, unattended', className: 'wait' }
	if (level === 'propose') return { text: 'a plan, waiting on a person', className: 'wait' }
	return protectsMoney(shape)
		? { text: 'refused at the boundary', className: 'refuse' }
		: { text: 'refused, routed to its team', className: 'refuse' }
}

const COLUMNS = SHAPES.map((shape, index) => ({ shape, x: 190 + index * 200 }))

function row(label: string, y: number, on: (shape: string) => boolean): string {
	const cells = COLUMNS.map(
		({ shape, x }) => `<rect class="${on(shape) ? 'solid' : 'tint'}" x="${x}" y="${y}" width="140" height="16" rx="2"/>`,
	).join('')
	return `<text x="0" y="${y + 12}" class="small mono muted">${label}</text>\n${cells}`
}

export function orgShapes(): string {
	const headers = COLUMNS.map(({ shape, x }) => `<text x="${x + 8}" y="44" class="title">${shape}</text>`).join('')

	const rows = [
		row('runs start themselves', 70, (shape) => board(shape).autoRunEnabled),
		row('plans approve themselves', 102, (shape) => board(shape).autoApprovePlans),
		row('the money path is off limits', 134, (shape) => autonomy(shape, 'budget') === 'refuse'),
		row('the contract needs a plan', 166, (shape) => autonomy(shape, 'contracts') !== 'build'),
	].join('\n')

	const caps = COLUMNS.map(({ shape, x }) => `<text x="${x}" y="210" class="small muted">${board(shape).reviewQueueCap} waiting</text>`).join('')
	const money = COLUMNS.map(({ shape, x }) => {
		const outcome = moneyOutcome(shape)
		return `<text x="${x}" y="262" class="small ${outcome.className}">${outcome.text}</text>`
	}).join('')

	return `${OPEN}
<svg viewBox="-4 -4 1010 330" role="img" aria-labelledby="d5t">
<title id="d5t">Four company shapes as four gate configurations on one codebase</title>
<text x="0" y="14" class="label">the same six items, four operating models</text>
<g>
${headers}
</g>
<g>
${rows}
<text x="0" y="210" class="small mono muted">the queue stops at</text>
${caps}
</g>
<line x1="0" y1="236" x2="1000" y2="236" class="dashed"/>
<text x="0" y="262" class="small mono muted">the money item</text>
${money}
<text x="0" y="300" class="small muted">One repository, one command to switch. The room sees the same item open a pull request in one shape and stop dead in another inside a minute.</text>
</svg>
<figcaption>Figure 5. Read from <code>profiles/*/board.json</code>, <code>targets.json</code> and each charter, so the slide and <code>make profile</code> cannot disagree. Nothing about the codebase changes between these columns; only what a person insists on seeing.</figcaption>
${CLOSE}`
}

if (import.meta.main) {
	const path = join(ROOT, 'teach.html')
	const page = readFileSync(path, 'utf8')
	const start = page.indexOf(OPEN)
	if (start === -1) throw new Error('teach.html has no org-shapes figure to replace')
	const end = page.indexOf(CLOSE, start)
	writeFileSync(path, page.slice(0, start) + orgShapes() + page.slice(end + CLOSE.length))
	console.log(`org shapes: ${SHAPES.map((shape) => `${shape}=${autonomy(shape, 'budget')}`).join(' ')}`)
}
