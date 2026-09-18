/**
 * Build the contents page from the sections that exist.
 *
 * This was a sticky sidebar, beside a second chip row listing the same sections,
 * inside a grid the rest of the page was still fighting. A book has one contents
 * and it sits at the front, so it is there when the book is printed and a reader
 * who is holding paper can still find the verification chapter.
 *
 * Generated, because a hand-written list of links is a list that will point at a
 * section somebody renamed.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'

const OPEN = '<nav class="contents" aria-label="Contents">'
const CLOSE = '</nav>'

export interface Entry {
	readonly id: string
	readonly kicker: string
	readonly title: string
}

/** Every section of the spine, in the order a reader meets them. */
export function sections(page: string): Entry[] {
	const found: Entry[] = []
	for (const match of page.matchAll(/id="(l-[^"]+)"/g)) {
		const after = page.slice(match.index ?? 0, (match.index ?? 0) + 1400)
		const kicker = /class="kicker">(.*?)</s.exec(after)?.[1]?.trim() ?? ''
		const heading = /<h2[^>]*>(.*?)<\/h2>/s.exec(after)?.[1] ?? ''
		const title = heading.replace(/<[^>]+>/g, '').trim()
		// The part before the colon is the name; the rest is the sentence about it.
		found.push({ id: match[1] as string, kicker, title: (title.split(':')[0] ?? title).trim() })
	}
	return found
}

export function rail(entries: Entry[]): string {
	const items = entries
		.map((entry, index) => {
			const number = String(index + 1).padStart(2, '0')
			return `<li><span class="no">${number}</span><a href="#${entry.id}">${entry.title}<span class="what">${entry.kicker}</span></a></li>`
		})
		.join('\n')
	return `${OPEN}
<h2>Contents</h2>
<ol>
${items}
</ol>
${CLOSE}`
}

if (import.meta.main) {
	const path = join(ROOT, 'teach.html')
	const page = readFileSync(path, 'utf8')
	const entries = sections(page)
	const built = rail(entries)

	const start = page.indexOf(OPEN)
	const next = start === -1 ? page : page.slice(0, start) + built + page.slice(page.indexOf(CLOSE, start) + CLOSE.length)
	if (start === -1) throw new Error('teach.html has no rail to fill; add the shell first')

	writeFileSync(path, next)
	console.log(`rail: ${entries.length} sections`)
}
