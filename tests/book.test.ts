/**
 * The printed book is the same book as the pages, and its text layer works.
 *
 * A PDF fails silently in a way nothing else here does: every page looks
 * perfect and the text extracts as gibberish, or the pages are simply last
 * month's. Neither is visible in a diff. `make book` proves the text layer on
 * its own output, because that needs a browser and poppler; these are what
 * `make check` can assert with neither, on a machine that only has the files.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { expect, it } from 'bun:test'
import { BOOK, pdfSources, sheetPdf } from '../scripts/book.ts'
import { sessions } from '../scripts/teach.ts'
import { ROOT } from '../scripts/tree-hash.ts'

const FRESHNESS = join(ROOT, 'scripts/pdf-freshness.json')
const recorded: Record<string, Record<string, string>> = existsSync(FRESHNESS)
	? JSON.parse(readFileSync(FRESHNESS, 'utf8'))
	: {}

function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}

it('every session has a printable sheet, and every sheet has a session', () => {
	const expected = [BOOK, ...sessions().map((session) => sheetPdf(session.key))].sort()
	expect(Object.keys(pdfSources()).sort()).toEqual(expected)

	const missing = expected.filter((pdf) => !existsSync(join(ROOT, pdf)))
	expect(missing, 'declared but never built: run make book').toEqual([])
})

it('no PDF is older than anything it was built from', () => {
	// 🔴 The builder counts as a source. A generated document and its PDF are both
	// downstream of the script that writes them, so an edit there with no rebuild
	// leaves the pair consistent with each other and both behind, which no
	// html-to-pdf comparison can see.
	//
	// 🔴 Content hashes, never modification times. A fresh checkout gives every
	// file the same timestamp in an arbitrary order, so an mtime gate reports
	// everything stale on its first CI run and could never have passed there.
	const stale: string[] = []
	for (const [pdf, sources] of Object.entries(pdfSources())) {
		const known = recorded[pdf]
		if (known === undefined) {
			stale.push(`${pdf} has no recorded sources: run make book`)
			continue
		}
		for (const source of sources) {
			const path = join(ROOT, source)
			if (!existsSync(path)) continue
			if (known[source] !== sha256(path)) stale.push(`${pdf} was not rebuilt after ${source} changed`)
		}
	}
	expect([...new Set(stale)].slice(0, 6), 'run make book').toEqual([])
})

it('the print block still resets every trap that breaks a text layer', () => {
	// Each of these renders perfectly and extracts as garbage. They were isolated
	// one at a time, by experiment, and every one of them is a property somebody
	// would reasonably add back for the screen.
	const css = readFileSync(join(ROOT, 'teach/teach.css'), 'utf8')
	const print = css.slice(css.indexOf('@media print'))
	const required: Array<[string, string]> = [
		['--font-sans: Helvetica', 'the printed sans stack must not resolve to SF Pro'],
		['--font-serif: Georgia', 'the printed serif stack must be one that embeds space glyphs'],
		['--font-mono: "Courier New"', 'the printed mono stack must not be ui-monospace'],
		['letter-spacing: normal !important', 'tracking both over-splits and glues runs'],
		['font-weight: 700 !important', 'a variable face at 900 glues its run and drops a character'],
		['position: static !important', 'a positioned list item paints last and detaches from its heading'],
	]
	const absent = required.filter(([rule]) => !print.includes(rule)).map(([rule, why]) => `${rule} (${why})`)
	expect(absent).toEqual([])
})

it('the page inset is declared in one place', () => {
	// A CSS @page margin overrides the margin passed to page.pdf(), so setting
	// both only hides which one is live. And it must not be padding on a wrapper:
	// block padding insets the start and end of a block, leaving page two onward
	// flush against the paper edge.
	const css = readFileSync(join(ROOT, 'teach/teach.css'), 'utf8')
	expect(css).toContain('@page {')
	expect(/@page\s*\{[^}]*margin:/.test(css), '@page declares no margin').toBe(true)
	const builder = readFileSync(join(ROOT, 'scripts/build-book.ts'), 'utf8')
	expect(builder).toContain("margin: { top: '0', bottom: '0', left: '0', right: '0' }")
})
