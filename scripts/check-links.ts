/**
 * Resolve every URL sources.json declares, and fail on the ones that do not answer.
 *
 *   bun scripts/check-links.ts
 *
 * Deliberately not part of `make check`. A gate that needs the network fails for
 * reasons that have nothing to do with the change in front of it, and a gate that
 * cries wolf is a gate people learn to skip. It runs as its own scheduled CI job,
 * where a rotted citation is news rather than noise.
 *
 * A citation nobody can open is not a citation, which is the whole reason for it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'

const AGENT = 'learnwithparam-link-check/1.0 (+https://learnwithparam.com)'

interface Source {
	readonly url: string
	readonly title: string
}

/** Undefined when the URL answers, otherwise why it did not. */
async function resolve(url: string): Promise<string | undefined> {
	if (!url.startsWith('https://') && !url.startsWith('http://')) return 'not an http URL'
	try {
		const response = await fetch(url, {
			headers: { 'user-agent': AGENT },
			signal: AbortSignal.timeout(20_000),
		})
		return response.ok ? undefined : `HTTP ${response.status}`
	} catch (error) {
		return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
	}
}

const sources: Source[] = JSON.parse(readFileSync(join(ROOT, 'sources.json'), 'utf8')).sources
const problems: string[] = []
for (const source of sources) {
	const why = await resolve(source.url)
	console.log(`${why === undefined ? 'ok  ' : 'FAIL'}  ${source.url}${why === undefined ? '' : `  ${why}`}`)
	if (why !== undefined) problems.push(`${source.url} (${source.title}): ${why}`)
}

if (problems.length > 0) {
	console.error(`\ncheck-links FAILED: ${problems.length} source(s) did not answer`)
	for (const line of problems) console.error(`  ✗ ${line}`)
	process.exit(1)
}
console.log(`\ncheck-links ok: ${sources.length} sources resolve`)
