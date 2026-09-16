/**
 * Phase 2: the design system asserts its own claims.
 *
 * design/tokens.json says which colour pairs a surface renders and which WCAG
 * level each must reach. These tests compute the ratio rather than trusting the
 * note beside the colour, and they fail when a generated stylesheet is stale.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
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
