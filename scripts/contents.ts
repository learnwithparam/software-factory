/**
 * Build the contents page of each document from the sections it has.
 *
 * A book has one contents and it sits at the front, so it is there when the book is
 * printed and a reader holding paper can still find the verification chapter.
 *
 * Generated, because a hand-written list of links is a list that will point at a
 * section somebody renamed. tests/contents.test.ts fails when a page carries a contents
 * other than the one its own sections would produce.
 *
 *     bun scripts/contents.ts        rewrites both documents in place
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'

export const SURFACES = ['workbook.html', 'guide.html'] as const

const OPEN = '<nav class="contents" aria-label="Contents">'
const CLOSE = '</nav>'

export interface Entry {
	readonly id: string
	readonly label: string
	readonly title: string
}

/** Every section a reader meets, in order: a workbook chapter, a guide session, the front note. */
export function sections(page: string): Entry[] {
	const found: Entry[] = []
	for (const match of page.matchAll(/ id="(l-[^"]+|s-[^"]+|before)"/g)) {
		const after = page.slice(match.index ?? 0, (match.index ?? 0) + 1400)
		const label = /class="(?:kicker|when|series)">(.*?)</s.exec(after)?.[1]?.trim() ?? ''
		const heading = /<h2[^>]*>(.*?)<\/h2>/s.exec(after)?.[1] ?? ''
		const title = heading.replace(/<[^>]+>/g, '').trim()
		// The part before the colon is the name; the rest is the sentence about it.
		found.push({ id: match[1] as string, label, title: (title.split(':')[0] ?? title).trim() })
	}
	return found
}

export function contents(entries: Entry[]): string {
	const items = entries
		.map((entry, index) => {
			const number = String(index + 1).padStart(2, '0')
			return `<li><span class="no">${number}</span><a href="#${entry.id}">${entry.title}<span class="what">${entry.label}</span></a></li>`
		})
		.join('\n')
	return `${OPEN}
<h2>Contents</h2>
<ol>
${items}
</ol>
${CLOSE}`
}

/** The page with its contents replaced by the one its sections produce. */
export function fill(page: string, name: string): string {
	const start = page.indexOf(OPEN)
	if (start === -1) throw new Error(`${name} has no contents to fill; add the shell first`)
	const end = page.indexOf(CLOSE, start) + CLOSE.length
	return page.slice(0, start) + contents(sections(page)) + page.slice(end)
}

if (import.meta.main) {
	for (const name of SURFACES) {
		const path = join(ROOT, name)
		const page = readFileSync(path, 'utf8')
		writeFileSync(path, fill(page, name))
		console.log(`${name}: ${sections(page).length} sections`)
	}
}
