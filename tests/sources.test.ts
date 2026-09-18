/**
 * Every external claim carries a source, and every source is still cited.
 *
 * An enterprise reader checks the citations, and a link that rotted is a citation
 * nobody can check. sources.json is the one list; these bind it to the pages in
 * both directions so neither can drift. Reachability is a separate CI job,
 * because a gate that needs the network cannot sit inside `make check`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'bun:test'
import { teachFiles } from '../scripts/teach.ts'
import { ROOT } from '../scripts/tree-hash.ts'

interface Source {
	readonly url: string
	readonly title: string
	readonly publisher: string
	readonly read: string
	readonly supports: string
}

const declared: Source[] = JSON.parse(readFileSync(join(ROOT, 'sources.json'), 'utf8')).sources

/** A link to the repository or to a vendor whose product the lab runs is plumbing
 *  rather than a claim about the world. What has to be declared is anything a
 *  reader would follow to check something a page asserts. */
const PLUMBING = /^https?:\/\/([a-z0-9-]+\.)*(github\.com|localhost|learnwithparam\.com|mastra\.ai)/

function cited(): Set<string> {
	const found = new Set<string>()
	for (const file of [...teachFiles(), 'README.md', 'AGENTS.md']) {
		const text = readFileSync(join(ROOT, file), 'utf8')
		for (const match of text.matchAll(/href="(https?:\/\/[^"]+)"/g)) found.add(match[1] as string)
		for (const match of text.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) found.add(match[1] as string)
	}
	return found
}

it('every cited URL is declared in sources.json', () => {
	const known = new Set(declared.map((source) => source.url))
	const undeclared = [...cited()].filter((url) => !known.has(url) && !PLUMBING.test(url)).sort()
	expect(undeclared).toEqual([])
})

it('every declared source is cited somewhere', () => {
	// A source nothing points at is a reading list pretending to be a citation.
	const pages = cited()
	const orphans = declared.filter((source) => !pages.has(source.url)).map((source) => source.url)
	expect(orphans).toEqual([])
})

it('every source says what it supports and when it was read', () => {
	const incomplete = declared
		.filter((source) => !(source.url && source.title && source.publisher && source.read && source.supports))
		.map((source) => source.url ?? '?')
	expect(incomplete).toEqual([])
})

it('no source was read in the future', () => {
	// A date typed rather than checked is the first sign nobody opened the page.
	const today = new Date().toISOString().slice(0, 10)
	const ahead = declared.filter((source) => source.read > today).map((source) => source.url)
	expect(ahead).toEqual([])
})
