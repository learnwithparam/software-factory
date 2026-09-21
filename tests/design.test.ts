/**
 * Phase 2: the design system asserts its own claims.
 *
 * design/tokens.json says which colour pairs a surface renders and which WCAG
 * level each must reach. These tests compute the ratio rather than trusting the
 * note beside the colour, and they fail when a generated stylesheet is stale.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'bun:test'
import { MINIMUM_RATIO, contrastRatio, renderCss, tokens } from '../scripts/tokens.ts'
import { ROOT } from '../scripts/tree-hash.ts'

const t = tokens()

it('every declared contrast pair reaches the level it claims', () => {
	const failures: string[] = []
	for (const pair of t.contrast.pairs) {
		const fg = t.color[pair.fg]
		const bg = t.color[pair.bg]
		if (!fg || !bg) throw new Error(`unknown colour in pair ${pair.fg} on ${pair.bg}`)
		const ratio = contrastRatio(fg.value, bg.value)
		const required = MINIMUM_RATIO[pair.level]
		if (ratio < required) {
			failures.push(`${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}, needs ${required} for ${pair.level}`)
		}
	}
	expect(failures).toEqual([])
})

it('every text, state and fill colour has a contrast pair', () => {
	// A colour that renders words and appears in no pair is a colour whose
	// legibility nobody checked. A border is exempt, and its role says so.
	// A surface or a fill is judged as the background words sit on.
	const asForeground = new Set(t.contrast.pairs.map((pair) => pair.fg))
	const asBackground = new Set(t.contrast.pairs.map((pair) => pair.bg))
	const unchecked = Object.entries(t.color)
		.filter(([name, token]) => {
			if (token.role === 'border') return false
			return token.role === 'surface' || token.role === 'fill' ? !asBackground.has(name) : !asForeground.has(name)
		})
		.map(([name]) => name)
	expect(unchecked).toEqual([])
})

it('every generated stylesheet matches the token source', () => {
	const stale: string[] = []
	for (const surface of t.surfaces) {
		const path = join(ROOT, surface.out)
		if (!existsSync(path)) {
			stale.push(`${surface.out} has never been generated`)
			continue
		}
		if (readFileSync(path, 'utf8') !== renderCss(t, surface.name)) {
			stale.push(`${surface.out} is stale, run make tokens`)
		}
	}
	expect(stale).toEqual([])
})

it('the yellow is a fill and never the colour of words', () => {
	// It is about 1.03 to 1 against the paper. The brand says it is a fill with
	// ink on top, so no pair may put it in front, and no stylesheet may set text in it.
	expect(t.contrast.pairs.filter((pair) => pair.fg === 'accent')).toEqual([])
	expect(t.color.accent?.role).toBe('fill')
})

/**
 * The workshop brand, as this repository holds it. design/BRAND.md says what each
 * value is for; these assertions name the value rather than checking a token
 * merely exists, because a token with the wrong value passes a test that only counts.
 */

const BRAND: ReadonlyArray<readonly [string, string, string]> = [
	['paper', '#FAFAFA', 'neutral-50'],
	['card', '#FFFFFF', 'white'],
	['ink', '#151515', 'neutral-900'],
	['ink-2', '#414141', 'neutral-700'],
	['muted', '#606060', 'neutral-600'],
	['faint', '#808080', 'neutral-500'],
	['line', '#DFDFDF', 'neutral-200'],
	['accent', '#FAFF69', 'primary-300'],
	['accent-deep', '#4F5101', 'primary-600'],
	['fill-dark', '#1F1F1C', 'neutral-750'],
	['pass', '#008138', 'green-700'],
	['fail', '#BF000F', 'red-700'],
	['wait', '#B75000', 'amber-700'],
]

const PAGES = ['workbook.html', 'guide.html']
const STYLE = 'design/book.css'

it('every brand token carries its sampled value', () => {
	const wrong = BRAND.filter(([name, value]) => t.color[name]?.value !== value).map(
		([name, value, source]) => `${name} is ${t.color[name]?.value}, ${source} is ${value}`,
	)
	expect(wrong).toEqual([])
	expect(Object.keys(t.color).sort()).toEqual(BRAND.map(([name]) => name).sort())
})

it('no page carries a dark palette', () => {
	const dark = [...PAGES, STYLE]
		.filter((file) => existsSync(join(ROOT, file)))
		.filter((file) => /prefers-color-scheme|data-theme/.test(readFileSync(join(ROOT, file), 'utf8')))
	expect(dark).toEqual([])
})

it('no page pulls a font over the network', () => {
	// A document that needs the network to look right looks wrong in a room with
	// bad wifi. The two typefaces are files in design/fonts and nothing else.
	const remote = [...PAGES, STYLE]
		.filter((file) => existsSync(join(ROOT, file)))
		.filter((file) => /fonts\.googleapis|fonts\.gstatic|url\(\s*["']?https?:/.test(readFileSync(join(ROOT, file), 'utf8')))
	expect(remote).toEqual([])
})

it('no stylesheet writes a colour that is not a token', () => {
	// A hex in the stylesheet is a second source of truth. The @page margin boxes
	// are the one exception: they sit outside :root and cannot read a variable.
	if (!existsSync(join(ROOT, STYLE))) return
	const css = readFileSync(join(ROOT, STYLE), 'utf8').replace(/@page[^{]*\{(?:[^{}]|\{[^}]*\})*\}/g, '')
	const values = new Set(Object.values(t.color).map((token) => token.value.toLowerCase()))
	const stray = (css.match(/#[0-9a-fA-F]{6}\b/g) ?? []).filter((hex) => !values.has(hex.toLowerCase()))
	expect(stray).toEqual([])
})

it('the typefaces are Inter and Inconsolata and there is no serif', () => {
	expect(t.font.sans?.value.startsWith('Inter,')).toBe(true)
	expect(t.font.mono?.value.startsWith('Inconsolata,')).toBe(true)
	expect(Object.keys(t.font).sort()).toEqual(['mono', 'sans'])
})

it('the page is one column with no side gutter', () => {
	// A side column held a figure number and one short note and pushed the text into a ribbon.
	expect(Object.keys(t.page).filter((key) => !key.startsWith('$')).sort()).toEqual(['canvas', 'width'])
	expect(readFileSync(join(ROOT, 'design', 'book.css'), 'utf8')).not.toMatch(/page-(side|gap|main)/)
})
