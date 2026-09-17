/**
 * The contents lists every section, and every link lands somewhere.
 *
 * A hand-written sidebar is a list that will point at a section somebody
 * renamed, and a reader who clicks a dead anchor in front of a room does not
 * forgive the page. The rail is generated; this is what notices when it has not
 * been.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../scripts/tree-hash.ts'
import { rail, sections } from '../scripts/spine-rail.ts'

const page = readFileSync(join(ROOT, 'teach.html'), 'utf8')

describe('the contents rail', () => {
	it('is the one the sections would produce', () => {
		expect(page).toContain(rail(sections(page)))
	})

	it('links to a section that exists, every time', () => {
		const dead = [...page.matchAll(/<a href="#(l-[^"]+)"/g)]
			.map((match) => match[1] as string)
			.filter((id) => !page.includes(`id="${id}"`))
		expect(dead).toEqual([])
	})

	it('covers the company shapes, which the leadership workshop is built on', () => {
		expect(sections(page).map((entry) => entry.id)).toContain('l-shapes')
	})
})
