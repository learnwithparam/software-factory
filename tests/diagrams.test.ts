/**
 * Every picture in the workbook and the guide is drawn by scripts/diagram.mjs, and stays readable.
 *
 * Five things can quietly go wrong with a hand-drawn diagram, and each is a test here: the
 * drawing drifts from its description, a label prints too small to read, a colour is written
 * as a hex instead of a token, a class has no style behind it, and a concept that deserves a
 * picture has none. The two measured diagrams also have to match the record they quote.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drawSvg, LIMITS, MIN_PRINT_PT, PAGES, PRINT_WIDTH_PT, problems } from '../scripts/diagram.mjs'
import type { RunReport } from '../scripts/run-report.ts'
import { ROOT } from '../scripts/tree-hash.ts'
import { SPEC as WATERFALL, waterfall } from '../scripts/waterfall.ts'

const SPECS = join(ROOT, 'design', 'diagrams')
const CSS = readFileSync(join(ROOT, 'design', 'book.css'), 'utf8')
const FIGURE = /<figure class="diagram" data-diagram="([a-z0-9-]+)">[\s\S]*?<\/figure>/g

interface Placed {
	readonly page: string
	readonly id: string
	readonly html: string
}

function figures(): Placed[] {
	return PAGES.flatMap((page) =>
		[...readFileSync(join(ROOT, page), 'utf8').matchAll(FIGURE)].map((m) => ({
			page,
			id: m[1] as string,
			html: m[0],
		})),
	)
}

const specs = (): string[] =>
	readdirSync(SPECS)
		.filter((name) => name.endsWith('.json') && name !== 'exempt.json')
		.map((name) => name.replace(/\.json$/, ''))

/** Each concept the workbook declares, with the markup inside it. */
function conceptBlocks(): Map<string, string> {
	const text = readFileSync(join(ROOT, 'workbook.html'), 'utf8')
	const starts = [...text.matchAll(/<div class="concept" id="c-([a-z0-9-]+)"/g)]
	const blocks = new Map<string, string>()
	starts.forEach((m, i) => {
		const end = starts[i + 1]?.index ?? text.length
		blocks.set(m[1] as string, (text.slice(m.index, end).split('</section>')[0]) as string)
	})
	return blocks
}

const exempt = (): Record<string, string> =>
	existsSync(join(SPECS, 'exempt.json')) ? (JSON.parse(readFileSync(join(SPECS, 'exempt.json'), 'utf8')) as Record<string, string>) : {}

describe('every figure', () => {
	it('exists, so no gate below is checking nothing', () => {
		expect(figures().length).toBeGreaterThan(0)
	})

	it('is what the tool draws', () => {
		const run = Bun.spawnSync(['node', 'scripts/diagram.mjs', '--check'], { cwd: ROOT })
		expect(run.exitCode, run.stderr.toString() || run.stdout.toString()).toBe(0)
	})

	it('is placed once, and every description is placed', () => {
		const placed = figures().map((f) => f.id)
		const repeated = [...new Set(placed.filter((id) => placed.filter((other) => other === id).length > 1))]
		expect(repeated, 'a diagram is placed twice, its number would repeat').toEqual([])
		expect(placed.filter((id) => !specs().includes(id)), 'placed with no design/diagrams/<id>.json').toEqual([])
		expect(specs().filter((id) => !placed.includes(id)), 'a description no page places').toEqual([])
	})

	it('prints no label smaller than the minimum', () => {
		// A unit on the 504 wide canvas prints at PRINT_WIDTH_PT / 504 points. The old canvas was
		// 1010 wide, which is how labels reached 5.5pt.
		const small: string[] = []
		for (const { page, id, html } of figures()) {
			const width = Number(/viewBox="0 0 ([0-9.]+) /.exec(html)?.[1])
			for (const m of html.matchAll(/<text [^>]*font-size="([0-9.]+)"/g)) {
				const printed = (Number(m[1]) * PRINT_WIDTH_PT) / width
				if (printed < MIN_PRINT_PT) small.push(`${page} ${id}: size ${m[1]} on a ${width} canvas prints at ${printed.toFixed(1)}pt`)
			}
		}
		expect(small).toEqual([])
	})

	it('gives every text element a size, so it can be measured', () => {
		const bare = figures().flatMap(({ page, id, html }) =>
			[...html.matchAll(/<text [^>]*>/g)].filter((m) => !m[0].includes('font-size=')).map(() => `${page} ${id}`),
		)
		expect(bare).toEqual([])
	})

	it('holds no literal colour', () => {
		const bad: string[] = []
		for (const { page, id, html } of figures()) {
			if (/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b|rgba?\(|style=/.test(html)) bad.push(`${page} ${id}: a colour or style written into the figure`)
			if (/\b(fill|stroke)="(?!none")/.test(html)) bad.push(`${page} ${id}: fill or stroke set by attribute, use a token class`)
		}
		expect(bad).toEqual([])
	})

	it('uses only classes the stylesheet styles', () => {
		const used = new Set(figures().flatMap(({ html }) => [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => (m[1] as string).split(/\s+/))))
		const missing = [...used].filter((name) => !new RegExp(`\\.${name.replace(/[-]/g, '\\-')}(?![A-Za-z0-9_-])`).test(CSS))
		expect(missing, 'classes the tool emits that design/book.css does not style').toEqual([])
	})

	it('travels with its heading in one block that cannot split', () => {
		// Chromium does not honour break-after on a grid item, so the heading, the hook and the
		// concept's first picture sit in one div.lead.
		const loose = [...conceptBlocks()]
			.filter(([, html]) => html.includes('data-diagram="'))
			.filter(([, html]) => !/<div class="lead">\s*<h3>[^\n]*<\/h3>\s*(?:<p class="hook">[^\n]*<\/p>\s*)?<figure class="diagram"/.test(html))
			.map(([id]) => id)
		expect(loose, 'a concept whose first figure is not held with its heading in a div.lead').toEqual([])
	})
})

describe('every concept', () => {
	it('has a diagram or a written reason', () => {
		const bare = [...conceptBlocks()].filter(([, html]) => !html.includes('class="diagram"')).map(([id]) => id)
		const excused = exempt()
		expect(bare.filter((id) => !(id in excused)), 'no diagram and no reason in design/diagrams/exempt.json').toEqual([])
		expect(Object.keys(excused).filter((id) => !bare.includes(id)), 'an exemption for a concept that now has a diagram, or does not exist').toEqual([])
		expect(Object.entries(excused).filter(([, why]) => why.split(/\s+/).length < 6).map(([id]) => id), 'an exemption needs a sentence').toEqual([])
	})
})

describe('the measured stage waterfall', () => {
	const report = join(ROOT, 'evidence', 'factory-run.json')
	it.if(existsSync(report))('is the one the run record produces', () => {
		const record = JSON.parse(readFileSync(report, 'utf8')) as RunReport
		expect(JSON.parse(readFileSync(WATERFALL, 'utf8'))).toEqual(waterfall(record))
	})
})

describe('the budget: a figure is a picture, not paragraphs in rectangles', () => {
	const flow = (steps: unknown[], extra: object = {}) => ({ shape: 'flow', steps, ...extra })

	it('holds for every figure: the word budget, no footnote, geometry', () => {
		const all = specs().flatMap((id) => problems(id, JSON.parse(readFileSync(join(SPECS, `${id}.json`), 'utf8'))))
		expect(all).toEqual([])
	})

	it('refuses a label over six words', () => {
		expect(problems('t', flow([{ title: 'Nobody adds a field at three in the morning' }])).some((p) => p.includes('9 words'))).toBe(true)
	})

	it('refuses a figure over the drawn-word budget', () => {
		const steps = Array.from({ length: 6 }, () => ({ title: 'one two three four five six' }))
		expect(problems('t', flow(steps)).some((p) => p.includes('words drawn'))).toBe(true)
		expect(LIMITS.figure).toBe(34)
	})

	it('refuses a footnote and a list of sentences in a box', () => {
		expect(problems('t', flow([{ title: 'A' }], { foot: ['x'] })).some((p) => p.includes('foot'))).toBe(true)
		expect(problems('t', flow([{ title: 'A', note: ['one', 'two'] }])).some((p) => p.includes('note'))).toBe(true)
	})

	it('refuses a split with no arrow and allows one with an arrow', () => {
		const sides = { left: { title: 'A', items: ['x'] }, right: { title: 'B', items: ['y'] } }
		expect(problems('t', { shape: 'split', ...sides }).some((p) => p.includes('split'))).toBe(true)
		expect(problems('t', { shape: 'split', arrow: 'then', ...sides })).toEqual([])
	})

	it('draws each new shape with every label readable and inside the canvas', () => {
		const shapes: Record<string, object> = {
			gate: { shape: 'gate', path: [{ title: 'Proposal' }, { title: 'Cited' }, { title: 'Stored' }], gates: [{ after: 0, refuse: 'No trace id' }] },
			growth: { shape: 'growth', rising: { label: 'Piling on' }, flat: { label: 'Routing' }, xlabel: 'Mistakes fixed', ylabel: 'Prompt size', mark: { at: 0.6, label: 'Accuracy falls' } },
			scope: { shape: 'scope', rings: [{ title: 'The host', items: ['files', 'network'] }, { title: 'The agent can read' }, { title: 'It can change', tone: 'mark' }] },
			pair: { shape: 'pair', left: { title: 'Before' }, right: { title: 'After', tone: 'mark' }, rows: [{ label: 'Errors', left: 'Rising', right: 'Flat', changed: true }, { label: 'Traffic', left: 'Normal', right: 'Normal' }] },
		}
		for (const [name, spec] of Object.entries(shapes)) {
			const svg = drawSvg('t', { ...spec, alt: 'a picture' })
			const width = Number(/viewBox="0 0 (\d+) /.exec(svg)?.[1])
			const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]))
			expect([name, sizes.length > 0]).toEqual([name, true])
			expect([name, Math.min(...sizes) * PRINT_WIDTH_PT / width >= MIN_PRINT_PT]).toEqual([name, true])
			expect([name, /x="-|y="-/.test(svg)]).toEqual([name, false])
		}
	})
})
