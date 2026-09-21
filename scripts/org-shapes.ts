/**
 * Describe the four company shapes from the four profiles.
 *
 * The figure this replaces was authored by hand and had drifted: it showed runs
 * starting themselves under `startup`, where profiles/startup/board.json sets
 * autoRunEnabled false, and it described enterprise as "refused, and routed"
 * when routing to an owning team is what distinguishes scaleup from it.
 *
 * A diagram is a claim. This one is read from the same files `make profile`
 * copies into the repository, so the page and the switch cannot disagree. The
 * result is a description in design/diagrams/, drawn by scripts/diagram.mjs.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'

export const SPEC = join(ROOT, 'design', 'diagrams', 'org-shapes.json')
const SHAPES = ['solo', 'startup', 'scaleup', 'enterprise'] as const

interface Board {
	readonly autoRunEnabled: boolean
	readonly autoApprovePlans: boolean
	readonly reviewQueueCap: number
}

function board(shape: string): Board {
	return JSON.parse(readFileSync(join(ROOT, 'profiles', shape, 'board.json'), 'utf8')) as Board
}

export function autonomy(shape: string, target: string): string {
	const graph = JSON.parse(readFileSync(join(ROOT, 'profiles', shape, 'targets.json'), 'utf8')) as {
		targets: Record<string, { autonomy: string }>
	}
	return graph.targets[target]?.autonomy ?? '?'
}

function protectsMoney(shape: string): boolean {
	return readFileSync(join(ROOT, 'profiles', shape, 'charter.md'), 'utf8').includes('services/budget/**')
}

interface Cell {
	readonly text: string
	readonly tone?: string
}

const yesNo = (on: boolean): Cell => ({ text: on ? 'Yes' : 'No' })

/** What happens to the money item, derived rather than asserted. */
function moneyOutcome(shape: string): Cell {
	const level = autonomy(shape, 'budget')
	if (level === 'build') return { text: 'Pull request', tone: 'wait' }
	if (level === 'propose') return { text: 'Plan', tone: 'wait' }
	return protectsMoney(shape) ? { text: 'Refused', tone: 'fail' } : { text: 'Routed', tone: 'fail' }
}

export function orgShapes(): Record<string, unknown> {
	const row = (label: string, cell: (shape: string) => Cell) => ({ label, cells: SHAPES.map(cell) })
	return {
		shape: 'matrix',
		alt: 'Four company shapes as four gate settings on one codebase: what starts itself, what plans approve themselves, the queue cap, and what happens to the money item.',
		caption:
			'Read from profiles/*/board.json, targets.json and each charter, so this page and make profile cannot disagree. The codebase does not change between the columns. Only what a person insists on seeing does.',
		corner: 'Same work',
		cols: ['Solo', 'Startup', 'Scaleup', 'Enterprise'],
		labelWidth: 96,
		rows: [
			row('Self-starts', (shape) => yesNo(board(shape).autoRunEnabled)),
			row('Self-approves', (shape) => yesNo(board(shape).autoApprovePlans)),
			row('Queue cap', (shape) => ({ text: `${board(shape).reviewQueueCap}` })),
			row('Money item', moneyOutcome),
		],
	}
}

if (import.meta.main) {
	writeFileSync(SPEC, `${JSON.stringify(orgShapes(), null, 2)}\n`)
	console.log(`org shapes: ${SHAPES.map((shape) => `${shape}=${autonomy(shape, 'budget')}`).join(' ')}`)
}
