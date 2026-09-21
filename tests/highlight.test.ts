/**
 * Every code block in the workbook and the guide is coloured by scripts/highlight.mjs.
 *
 * A block is plain text the tool colours, so a hand edit is overwritten and named. The colours are
 * token classes: each has a style bound to a palette variable, and the palette pairs are already
 * pinned by tests/design.test.ts.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { highlight, LANGS, PAGES, plainText, stale, unlabelled } from '../scripts/highlight.mjs'
import { ROOT } from '../scripts/tree-hash.ts'

const CSS = readFileSync(join(ROOT, 'design', 'book.css'), 'utf8')
const CLASSES = ['hl-k', 'hl-s', 'hl-n', 'hl-c']
const page = (name: string): string => readFileSync(join(ROOT, name), 'utf8')

describe('every code block', () => {
	it('is what the tool writes', () => {
		const off = PAGES.flatMap((name) => stale(page(name)).map((first) => `${name}: ${first}`))
		expect(off).toEqual([])
	})

	it('names its language', () => {
		expect(PAGES.map((name) => `${name}: ${unlabelled(page(name))}`)).toEqual(PAGES.map((name) => `${name}: 0`))
	})

	it('uses a language the tool knows', () => {
		const used = new Set(PAGES.flatMap((name) => [...page(name).matchAll(/<pre data-lang="([a-z]+)"/g)].map((m) => String(m[1]))))
		expect([...used].filter((lang) => !LANGS.includes(lang))).toEqual([])
	})
})

describe('the highlighter', () => {
	it('gives sql a keyword, a string, a number and a comment', () => {
		const out = highlight('sql', "SELECT service, count() -- one row\nFROM t WHERE severity = 'ERROR' AND n > 30")
		expect(CLASSES.filter((cls) => !out.includes(`class="${cls}"`))).toEqual([])
	})

	it('never changes the text', () => {
		const src = 'docker exec -it x --param_a=1 # note\nmake up\n'
		expect(plainText(highlight('bash', src))).toBe(src)
	})

	it('names a hand edit inside a block', () => {
		expect(stale('<pre data-lang="sql">SELECT <span class="hl-s">1</span></pre>')).toEqual(['SELECT 1'])
	})

	it('has a style bound to a palette variable for every colour class', () => {
		expect(CLASSES.filter((cls) => !new RegExp(`\\.${cls}\\s*\\{[^}]*var\\(--c-`).test(CSS))).toEqual([])
	})
})
