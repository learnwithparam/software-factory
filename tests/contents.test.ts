/**
 * The contents lists every section, and every link lands somewhere.
 *
 * A hand-written list is a list that will point at a section somebody renamed, and a
 * reader who clicks a dead anchor in front of a room does not forgive the page. The
 * contents is generated; this is what notices when it has not been.
 */

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contents, sections, SURFACES } from '../scripts/contents.ts'
import { ROOT } from '../scripts/tree-hash.ts'
import { sessions } from '../scripts/teach.ts'

const read = (name: string) => readFileSync(join(ROOT, name), 'utf8')

describe('the contents', () => {
	for (const name of SURFACES) {
		const page = read(name)

		it(`of ${name} is the one its sections would produce`, () => {
			expect(page).toContain(contents(sections(page)))
		})

		it(`of ${name} links to a section that exists, every time`, () => {
			const dead = [...page.matchAll(/<a href="#((?:l|s)-[^"]+|before)"/g)]
				.map((match) => match[1] as string)
				.filter((id) => !page.includes(` id="${id}"`))
			expect(dead).toEqual([])
		})
	}

	it('covers the company shapes, which the leadership workshop is built on', () => {
		expect(sections(read('workbook.html')).map((entry) => entry.id)).toContain('l-shapes')
	})

	it('lists every session, so one can be found and printed alone', () => {
		const ids = sections(read('guide.html')).map((entry) => entry.id)
		expect(sessions().map((session) => `s-${session.key}`).filter((id) => !ids.includes(id))).toEqual([])
	})
})
