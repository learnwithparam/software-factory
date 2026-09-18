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
import { sessions, sheetPath } from '../scripts/teach.ts'
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

it('every text and state colour has a contrast pair', () => {
	// A colour that renders words and appears in no pair is a colour whose
	// legibility nobody checked. A border is exempt, and its role says so.
	const asForeground = new Set(t.contrast.pairs.map((pair) => pair.fg))
	const asBackground = new Set(t.contrast.pairs.map((pair) => pair.bg))
	const unchecked = Object.entries(t.color)
		.filter(([name, token]) => {
			if (token.role === 'border') return false
			return token.role === 'surface' ? !asBackground.has(name) : !asForeground.has(name)
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

it('the accent colour is never claimed as body text', () => {
	// It passes at large sizes only. A pair claiming AA or AAA for it would be a
	// promise the palette cannot keep, so the claim itself is what gets checked.
	const overclaimed = t.contrast.pairs.filter(
		(pair) => pair.fg === 'accent' && pair.level !== 'AA-large',
	)
	expect(overclaimed).toEqual([])
})

/**
 * The house book system, as this repository holds it.
 *
 * Every standalone document across learnwithparam shares one set of values. The
 * copy in each repository is a copy, so it drifts, and the drift is always the
 * same shape: somebody adds a dark palette to one document out of twenty, or
 * pulls a webfont, or nudges a grey. Each assertion below names the value it
 * expects rather than checking that a token merely exists, because a token with
 * the wrong value passes every test that only counts tokens.
 */

const HOUSE: ReadonlyArray<readonly [string, string, string]> = [
	['bg', '#FBFAF8', 'paper'],
	['bg-alt', '#FFFFFF', 'card'],
	['bg-inset', '#F5F2EC', 'sunk'],
	['ink', '#1F1B16', 'ink'],
	['ink-2', '#3D372F', 'ink-2'],
	['ink-muted', '#5F594F', 'muted'],
	['ink-faint', '#948D80', 'faint'],
	['line', '#E6E1D8', 'rule'],
	['line-2', '#F0EDE7', 'rule-2'],
	['pass', '#046C4E', 'go'],
	['wait', '#A45B08', 'ask'],
	['fail', '#9E2A16', 'no'],
]

/** Every document that is served to a reader, and the stylesheet they share. */
function surfaces(): string[] {
	return ['teach.html', 'review.html', 'teach/teach.css', 'teach/tokens.css', ...sessions().map(sheetPath)]
}

it('every house token carries its house value', () => {
	const wrong = HOUSE.filter(([name, value]) => t.color[name]?.value !== value).map(
		([name, value, house]) => `${name} is ${t.color[name]?.value}, the house ${house} is ${value}`,
	)
	expect(wrong).toEqual([])
})

it('the two local tokens say they are local', () => {
	// Deviating from the house is allowed and has to be stated where somebody
	// copying this file will read it. An undocumented extra token is drift.
	const local = ['accent', 'refuse']
	const silent = local.filter((name) => !(t.color[name]?.use ?? '').includes('local to this repository'))
	expect(silent).toEqual([])
})

it('no surface carries a dark palette', () => {
	// A toggle on three documents out of twenty was the inconsistency, and it
	// doubled every token. The house is light only.
	const dark = surfaces()
		.filter((file) => existsSync(join(ROOT, file)))
		.filter((file) => /prefers-color-scheme|data-theme/.test(readFileSync(join(ROOT, file), 'utf8')))
	expect(dark).toEqual([])
})

it('no surface pulls a font over the network', () => {
	// A document that needs the network to look right is a document that looks
	// wrong in a room with bad wifi, which is every room.
	const remote = surfaces()
		.filter((file) => existsSync(join(ROOT, file)))
		.filter((file) => /fonts\.googleapis|fonts\.gstatic|@font-face|https?:\/\/[^"']*\.(?:woff2?|ttf|otf)/.test(readFileSync(join(ROOT, file), 'utf8')))
	expect(remote).toEqual([])
})

it('the screen mono stack has no Monaco and no Courier New', () => {
	// The first drift the house checker ever caught. Both are legitimate faces
	// and neither is the house one, so the stack quietly stops matching its
	// siblings. The print block is exempt and says why: ui-monospace is what
	// breaks a text layer, and Courier is what fixes it.
	expect(t.font.mono?.value).not.toContain('Monaco')
	expect(t.font.mono?.value).not.toContain('Courier New')
})

it('prose is serif and furniture is not', () => {
	// House rule one. A paragraph is read, so serif; a schedule row, a command
	// block and a table are scanned, so sans. Never a table body in serif.
	const css = readFileSync(join(ROOT, 'teach/teach.css'), 'utf8')
	const screen = css.slice(0, css.indexOf('@media print'))
	expect(/body\s*\{[^}]*font-family:\s*var\(--font-serif\)/.test(screen), 'body is not set in the serif').toBe(true)
	expect(/^table\s*\{[^}]*font-family:\s*var\(--font-sans\)/m.test(screen), 'a table body is not set in the sans').toBe(true)
})
