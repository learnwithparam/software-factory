/**
 * Compose the bound book from the teaching surfaces, and say what each PDF is
 * built from.
 *
 * Kept apart from build-book.ts so a test can read the composition and the
 * source list without launching a browser. `make check` has no Chromium.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SPINE, read, sessions, sheetPath } from './teach.ts'
import { ROOT } from './tree-hash.ts'

export const BOOK = 'software-factory-book.pdf'
export const GENERATED = 'artifacts/book.html'

/** Where a session's own printable sheet is written. */
export function sheetPdf(key: string): string {
	return `teach/pdf/${key}.pdf`
}

/** Every PDF this repository ships, and the files each one is built from.
 *
 * The builder counts as a source. A generated document and its PDF are both
 * downstream of the script that writes them, so an edit there with no rebuild
 * leaves the pair consistent with each other and both behind.
 */
export function pdfSources(): Record<string, string[]> {
	const shared = ['teach/teach.css', 'teach/tokens.css', 'scripts/build-book.ts', 'scripts/book.ts']
	const out: Record<string, string[]> = {
		[BOOK]: [SPINE, ...sessions().map(sheetPath), 'teach/sessions.json', ...shared],
	}
	for (const session of sessions()) {
		out[sheetPdf(session.key)] = [sheetPath(session), ...shared]
	}
	return out
}

/** The body of a teaching surface, without its shell. */
function body(file: string): string {
	const text = read(file)
	const open = text.indexOf('<main class="doc">')
	const close = text.lastIndexOf('</main>')
	if (open === -1 || close === -1) throw new Error(`${file} has no <main class="doc"> to bind`)
	return text.slice(open + '<main class="doc">'.length, close)
}

function titleOf(file: string): string {
	const found = /<title>(.*?)<\/title>/s.exec(read(file))?.[1] ?? file
	return found.replace(/^Run sheet:\s*/, '')
}

/**
 * Phrases that have to survive the round trip into the PDF's text layer.
 *
 * Read off the book rather than written down, because a hand-kept list checks
 * the chapters somebody remembered. A phrase is only usable if it carries no
 * inline markup: an <em> in the middle splits the run, and a canary that
 * straddles one tests the markup instead of the font.
 */
export function canaries(html: string): string[] {
	const found: string[] = []
	for (const match of html.matchAll(/<p(?: class="(?:deck|lede)")?>([^<]{80,})/g)) {
		const words = (match[1] as string).replace(/\s+/g, ' ').trim().split(' ').slice(0, 9).join(' ')
		if (words.length > 40) found.push(words)
	}
	return found
}

/** A block of a surface, and the surface without it. */
function lift(html: string, open: string, close: string): [string, string] {
	const from = html.indexOf(open)
	if (from === -1) throw new Error(`no ${open} to lift`)
	const to = html.indexOf(close, from) + close.length
	return [html.slice(from, to), html.slice(0, from) + html.slice(to)]
}

export function compose(): string {
	const list = sessions()
	const chapters = list
		.map((session, index) => {
			const number = String(index + 1).padStart(2, '0')
			return `<li><span class="no">${number}</span><a href="#s-${session.key}">${session.title}<span class="what">${session.kind}, ${session.minutes} minutes</span></a></li>`
		})
		.join('\n')

	const sheets = list
		.map((session) => {
			const inner = body(sheetPath(session))
				// Inside the bound book the spine is a few pages back, not another file.
				.replace(/href="\.\.\/teach\.html#/g, 'href="#')
				.replace(/<header class="cover">/, `<header class="cover" id="s-${session.key}">`)
			return `<section class="part-open">\n${inner}\n</section>`
		})
		.join('\n\n')

	// The bound book has its own cover and one contents at the front. The spine's
	// are correct when it is read on its own and would be a second title page and a
	// second contents here.
	const [spineContents, withoutContents] = lift(body(SPINE), '<nav class="contents"', '</nav>')
	const [, spineBody] = lift(withoutContents, '<header class="cover">', '</header>')
	const partOne = spineContents.replace('<h2>Contents</h2>', '<h2>Part one, the concepts</h2>')

	const version = readFileSync(join(ROOT, 'package.json'), 'utf8').match(/"version": "([^"]+)"/)?.[1] ?? '0'

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The Software Factory</title>
<link rel="stylesheet" href="../teach/teach.css">
<style>
/* Running heads. Chromium has supported @page margin boxes since 131 and this
   is checked before the render, so a missing head fails rather than vanishes. */
@page { @top-left { content: "The Software Factory"; font-family: Helvetica, Arial, sans-serif; font-size: 8.5pt; color: #948D80; } }
.part-open { break-before: page; }
</style>
</head>
<body>
<main class="doc">

<header class="cover">
<p class="series">learnwithparam · edition ${version}</p>
<h1>The Software Factory</h1>
<p class="deck">The concepts, and the run sheet for every session that teaches them. Part one explains each idea once. Part two is what a facilitator reads standing up, and it points back at part one by name.</p>
<dl class="facts">
<dt>Built by</dt><dd><code>make book</code>, from the same pages the browser serves</dd>
<dt>Checked by</dt><dd>its own text layer, read back with <code>pdftotext</code> after every build</dd>
</dl>

${partOne}

<nav class="contents" aria-label="Sessions">
<h2>Part two, the sessions</h2>
<ol>
${chapters}
</ol>
</nav>
</header>

${spineBody}

<section class="chapter part-open" id="l-sessions">
<p class="kicker">Part two</p>
<h2>The sessions, and what each one is responsible for</h2>
<p class="lede">Each sheet below is one live session. It carries the timing, the talk track and the commands, and it cites the ideas in part one rather than explaining them a second time.</p>
</section>

${sheets}

</main>
</body>
</html>
`
}

export { body, titleOf }
