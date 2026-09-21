/**
 * What each PDF is built from, and what has to survive into its text layer.
 *
 * Kept apart from build-book.ts so a test can read the source list and the
 * phrases without launching a browser. `make check` has no Chromium.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { GUIDE, WORKBOOK } from './teach.ts'
import { ROOT } from './tree-hash.ts'

/** Margin boxes are what put a page number on the page. Chromium grew them in 131. */
export const MARGIN_BOXES_FROM = 131

const fonts = () =>
	readdirSync(join(ROOT, 'design/fonts'))
		.filter((name) => name.endsWith('.woff2'))
		.map((name) => `design/fonts/${name}`)

/** The two documents this repository prints, and the running head each carries. */
export const PDFS: Record<string, { source: string; head: string }> = {
	'software-factory-workbook.pdf': { source: WORKBOOK, head: 'Software Factory workbook' },
	'software-factory-guide.pdf': { source: GUIDE, head: 'Software Factory facilitator guide' },
}

/** Every PDF this repository ships, and the files each one is built from.
 *
 * The builder counts as a source. A generated document and its PDF are both
 * downstream of the script that writes them, so an edit there with no rebuild
 * leaves the pair consistent with each other and both behind.
 */
export function pdfSources(): Record<string, string[]> {
	const shared = [
		'design/book.css',
		'design/tokens.css',
		...fonts(),
		'scripts/build-book.ts',
		'scripts/book.ts',
		'scripts/diagram.mjs',
	]
	const out: Record<string, string[]> = {}
	for (const [pdf, job] of Object.entries(PDFS)) {
		out[pdf] = [job.source, ...(job.source === GUIDE ? ['teach/sessions.json'] : []), ...shared]
	}
	return out
}

/**
 * Phrases that have to survive the round trip into the PDF's text layer.
 *
 * Read off the document rather than written down, because a hand-kept list checks
 * the chapters somebody remembered. A phrase is only usable if it carries no
 * inline markup: an <em> in the middle splits the run, and a canary that
 * straddles one tests the markup instead of the font.
 */
export function canaries(html: string): string[] {
	const found: string[] = []
	for (const match of html.matchAll(/<p(?: class="(?:deck|lede)")?>([^<]{80,})/g)) {
		const words = (match[1] as string).replace(/\s+/g, ' ').trim().split(' ').slice(0, 9).join(' ')
		if (words.length > 40 && !words.includes('&')) found.push(words)
	}
	return found
}

const decode = (text: string) =>
	text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

export const bare = (text: string) => text.replace(/\s+/g, '')

/** Every line of every command block on a page. */
export function commands(html: string): string[] {
	const lines: string[] = []
	for (const block of html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)) {
		for (const line of decode((block[1] as string).replace(/<[^>]+>/g, '')).split('\n')) {
			if (bare(line)) lines.push(line.trim())
		}
	}
	return lines
}

/** A command the PDF does not carry whole. Whitespace is ignored: a long command wraps, and the wrap is a break, not a loss. */
export function clippedCommands(raw: string, lines: string[]): string[] {
	const flat = bare(raw)
	return lines.filter((line) => !flat.includes(bare(line)))
}
