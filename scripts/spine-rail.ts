/**
 * Build the sidebar from the sections that exist.
 *
 * The concept spine was one long column with no way to see its shape or jump
 * around it. A reader arriving at "what is a verification layer" had to scroll
 * and hope. The AI SRE workshop solved this with a sticky rail listing the day,
 * and this is the same idea applied to a book rather than a schedule.
 *
 * Generated, because a hand-written list of links is a list that will point at a
 * section somebody renamed.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'

const OPEN = '<nav class="rail" aria-label="Contents">'
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
		.map((entry) => `<li><a href="#${entry.id}"><span class="where">${entry.kicker}</span><span>${entry.title}</span></a></li>`)
		.join('\n')
	return `${OPEN}
<h3>The spine</h3>
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
