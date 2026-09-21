/**
 * The company-shapes slide and the switch that applies them must agree.
 *
 * The hand-drawn version had drifted: it showed runs starting themselves under
 * `startup`, where profiles/startup/board.json sets autoRunEnabled false, and it
 * called enterprise "refused, and routed" when routing to an owning team is what
 * distinguishes scaleup from it. Nobody would have caught either in a room.
 *
 * The figure is generated from the profiles now, so this is what notices when
 * somebody edits the slide by hand or changes a profile without redrawing.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../scripts/tree-hash.ts'
import { SPEC, orgShapes } from '../scripts/org-shapes.ts'

const page = readFileSync(join(ROOT, 'workbook.html'), 'utf8')

describe('the four company shapes', () => {
	it('are drawn from the profiles, not written down beside them', () => {
		// The description on disk is what the drawing tool reads, so it has to be the
		// one the profiles produce, and the workbook has to place it.
		expect(JSON.parse(readFileSync(SPEC, 'utf8'))).toEqual(orgShapes())
		expect(page).toContain('data-diagram="org-shapes"')
	})

	it('disagree about the money path, or there is nothing to teach', () => {
		const levels = ['solo', 'startup', 'scaleup', 'enterprise'].map((shape) => {
			const graph = JSON.parse(readFileSync(join(ROOT, 'profiles', shape, 'targets.json'), 'utf8')) as {
				targets: Record<string, { autonomy: string }>
			}
			return graph.targets.budget?.autonomy
		})
		expect(new Set(levels).size).toBeGreaterThan(1)
	})

	it('separate the two shapes that both refuse', () => {
		// scaleup refuses by autonomy and enterprise protects the path outright, so
		// one stops after planning and the other before it. Collapse that and the
		// fourth column is decoration.
		const scaleup = readFileSync(join(ROOT, 'profiles', 'scaleup', 'charter.md'), 'utf8')
		const enterprise = readFileSync(join(ROOT, 'profiles', 'enterprise', 'charter.md'), 'utf8')
		expect(enterprise).toContain('services/budget/**')
		expect(scaleup).not.toContain('services/budget/**')
	})
})
