/**
 * Render the workbook and the guide to PDF, then read the PDFs back.
 *
 *   make book
 *
 * WHY IT CHECKS ITSELF
 *
 * A Chromium print-to-PDF fails in a way no visual review catches: every page
 * looks perfect and the text layer extracts as garbage, or a command is cut off
 * and nobody notices. The causes are CSS properties that are correct on screen,
 * so nothing looks wrong and nobody rebuilds. Each is reset in the print block of
 * design/book.css, and this asserts the resets are still doing their job:
 *
 *   welded      a system font that Chromium embeds as per-word runs with no space glyph
 *   over-split  letter-spacing from about .13em emits one run per character
 *   clipped     a command that runs off the page is cut in the text layer too
 *   fonts       Inter and Inconsolata are embedded, not quietly replaced
 *   tight       a code block, table or figure closer than MIN_GAP_MM to what follows it
 *   empty       a page that is mostly white, outside the cover, the contents and
 *               the last page of each document
 *   canaries    catch the rest, including corruptions local to one element
 *
 * poppler is a hard dependency. A verification that skips when its tool is
 * missing is not a verification.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MARGIN_BOXES_FROM, PDFS, bare, canaries, clippedCommands, commands, pdfSources } from './book.ts'
import { ROOT } from './tree-hash.ts'

const FRESHNESS = join(ROOT, 'scripts/pdf-freshness.json')

/** A code block, table or figure must leave at least this much room before the next element. */
const MIN_GAP_MM = 5
/** A page less full than this is a page of white space. */
const MIN_FILL = 0.55
/** The A4 page in points, and the band the @page margins take at the top and bottom (16 mm and 18 mm). */
const PAGE_H_PT = 841.89
const TOP_PT = (16 / 25.4) * 72
const BOTTOM_PT = (18 / 25.4) * 72

const sha256 = (file: string) => createHash('sha256').update(readFileSync(join(ROOT, file))).digest('hex').slice(0, 16)

function extract(path: string): string {
	return execFileSync('pdftotext', ['-raw', path, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).replace(/\s+/g, ' ')
}

/** Everything wrong with one PDF's text layer, named so it can be acted on. */
export function textLayerProblems(raw: string, expected: string[]): string[] {
	const problems: string[] = []

	const missing = expected.filter((phrase) => !raw.includes(phrase))
	for (const phrase of missing.slice(0, 3)) problems.push(`missing from the text layer: "${phrase}"`)
	if (missing.length > 3) problems.push(`and ${missing.length - 3} more phrases missing`)

	// A slug and a URL are legitimately long and always carry a separator.
	// Welded prose never does.
	const welded = raw.split(' ').filter((word) => word.length > 30 && /^[A-Za-z]+$/.test(word))
	if (welded.length > 0) {
		problems.push(
			`${welded.length} run-together token(s), so the text layer lost its spaces. First: "${welded[0]?.slice(0, 48)}". ` +
				'Something put ui-sans-serif or system-ui back into a printed font stack.',
		)
	}

	// Five or more single letters separated by spaces is not prose.
	const split = raw.match(/\b(?:[A-Za-z] ){4,}[A-Za-z]\b/g) ?? []
	if (split.length > 0) {
		problems.push(
			`${split.length} over-split run(s), so a tracked label emitted one run per character. First: "${split[0]?.slice(0, 48)}". ` +
				'Reset letter-spacing in the print block of design/book.css.',
		)
	}
	return problems
}

/** Where each page's ink ends, as a share of the space between the margins. Read from a raster, so a picture counts. */
function fills(path: string): number[] {
	const dpi = 24
	const dir = mkdtempSync(join(tmpdir(), 'book-fill-'))
	execFileSync('pdftoppm', ['-gray', '-r', String(dpi), path, join(dir, 'p')])
	const pages = readdirSync(dir).filter((name) => name.endsWith('.pgm')).sort()
	const top = Math.floor((TOP_PT * dpi) / 72)
	const bottom = Math.floor(((PAGE_H_PT - BOTTOM_PT) * dpi) / 72)
	return pages.map((name) => {
		const buf = readFileSync(join(dir, name))
		// P5, then "width height", then "255", then the pixels: three newline-terminated header lines.
		let at = 0
		for (let seen = 0; seen < 3; at++) if (buf[at] === 10) seen++
		const [width, height] = (buf.toString('latin1', 0, at).split('\n')[1] as string).split(' ').map(Number) as [number, number]
		let last = top
		for (let y = top; y < Math.min(bottom, height); y++) {
			for (let x = 0; x < width; x++) {
				if ((buf[at + y * width + x] as number) < 250) {
					last = y
					break
				}
			}
		}
		return (last - top) / (bottom - top)
	})
}

const pageText = (path: string, n: number) =>
	execFileSync('pdftotext', ['-f', String(n), '-l', String(n), '-raw', path, '-'], { encoding: 'utf8' })

/** Pages that are allowed to be short: the cover, the contents, the page before a forced break, the last one. */
export function emptyPages(path: string, fill: number[], opens: string[]): string[] {
	const short: string[] = []
	fill.forEach((share, i) => {
		const n = i + 1
		if (share >= MIN_FILL || n === 1 || n === fill.length) return
		if (/^\s*Contents\b/.test(pageText(path, n))) return
		const next = bare(pageText(path, n + 1)).slice(0, 240)
		if (opens.some((mark) => next.includes(mark))) return
		short.push(`page ${n} is ${Math.round(share * 100)}% full`)
	})
	return short
}

if (import.meta.main) {
	const playwright = (await import(pathToFileURL(join(ROOT, 'e2e/node_modules/playwright/index.mjs')).href)) as {
		chromium: { launch: () => Promise<any> }
	}
	const browser = await playwright.chromium.launch()
	const version = Number((browser.version() as string).split('.')[0])
	if (Number.isNaN(version) || version < MARGIN_BOXES_FROM) {
		await browser.close()
		throw new Error(
			`Chromium ${browser.version()} predates @page margin boxes (${MARGIN_BOXES_FROM}), so the book would print with no page numbers and nothing would say so. Run: cd e2e && bun x playwright install chromium`,
		)
	}

	const page = await browser.newPage()
	const problems: string[] = []
	for (const [out, job] of Object.entries(PDFS)) {
		await page.goto(pathToFileURL(join(ROOT, job.source)).href, { waitUntil: 'networkidle' })
		// The blank for the cover is repeated after the running head, because Chromium
		// takes the last margin box it is given rather than the most specific one.
		await page.addStyleTag({
			content:
				`@page { @top-left { content: ${JSON.stringify(job.head)}; font-family: Inter, Helvetica, Arial, sans-serif; font-size: 8.5pt; color: #606060; } }\n` +
				'@page :first { @top-left { content: ""; } }',
		})
		// A screenshot that did not load is a page that teaches nothing, and it prints as
		// white space rather than as an error. Every screenshot is lazy, so printing loads
		// them; this has to as well, or it reports every figure as broken.
		// The callback runs in the browser and this project has no DOM types, so it goes over as text.
		const broken: string[] = await page.evaluate(`(async () => {
			const images = Array.from(document.images)
			for (const img of images) img.loading = 'eager'
			await Promise.all(
				images.filter((img) => !img.complete).map((img) => new Promise((done) => { img.onload = done; img.onerror = done })),
			)
			await document.fonts.ready
			return images.filter((img) => img.naturalWidth === 0).map((img) => img.getAttribute('src') ?? '')
		})()`)
		if (broken.length > 0) problems.push(`${out}: ${broken.length} image(s) did not load, first: ${broken[0]}`)
		const opens: string[] = (await page.$$eval('.opens', (els: Array<{ textContent: string | null }>) => els.map((el) => el.textContent ?? '')))
			.map((text: string) => bare(text).slice(0, 24))
			.filter(Boolean)

		// Blocks side by side are not stacked, so a negative gap is skipped. The callback
		// runs in the browser and this project has no DOM types, so it goes over as text.
		await page.emulateMedia({ media: 'print' })
		const tight: string[] = await page.evaluate(`((minMm) => {
			const min = (minMm * 96) / 25.4
			const found = []
			for (const el of document.querySelectorAll('pre, table, figure')) {
				const next = el.nextElementSibling
				if (!next) continue
				const gap = next.getBoundingClientRect().top - el.getBoundingClientRect().bottom
				if (gap < -2 || gap >= min) continue
				const heading = Array.from(document.querySelectorAll('h2, h3')).filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).pop()
				found.push(el.tagName.toLowerCase() + ' under "' + ((heading && heading.textContent) || '?').trim().slice(0, 40) + '" leaves ' + ((gap * 25.4) / 96).toFixed(1) + ' mm')
			}
			return found
		})(${MIN_GAP_MM})`)
		problems.push(...tight.map((line) => `${out}: ${line}, under ${MIN_GAP_MM} mm`))

		// The inset lives in @page in design/book.css and nowhere else. A CSS @page margin
		// overrides whatever is passed here, so passing one too would only hide which of
		// them is live.
		const pdf: Buffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } })
		const path = join(ROOT, out)
		writeFileSync(path, pdf)

		const raw = extract(path)
		const html = readFileSync(join(ROOT, job.source), 'utf8')
		problems.push(...textLayerProblems(raw, canaries(html)).map((line) => `${out}: ${line}`))
		const cut = clippedCommands(raw, commands(html))
		if (cut.length > 0) problems.push(`${out}: ${cut.length} command line(s) are not whole in the text layer. First: "${cut[0]?.slice(0, 70)}"`)
		const embedded = execFileSync('pdffonts', [path], { encoding: 'utf8' })
		for (const face of ['Inter', 'Inconsolata']) {
			if (!embedded.includes(face)) problems.push(`${out}: ${face} is not embedded, so the page fell back to a system font`)
		}
		const fill = fills(path)
		problems.push(...emptyPages(path, fill, opens).map((line) => `${out}: ${line}, under ${MIN_FILL * 100}%`))
		console.log(`${out.padEnd(36)} ${(pdf.length / 1024).toFixed(0).padStart(5)} KB  ${fill.length} pages  ${raw.split(' ').length} words extract`)
	}
	await browser.close()

	if (problems.length > 0) {
		console.error('\nmake book  FAIL  the PDFs render and do not read back')
		for (const line of problems) console.error(`    ${line}`)
		console.error('\n    Compare: pdftotext -raw <file> - | less')
		process.exit(1)
	}

	// Content hashes, never modification times: a fresh checkout gives every file the
	// same timestamp in an arbitrary order, so an mtime gate could never pass in CI.
	const freshness: Record<string, Record<string, string>> = {}
	for (const [pdf, sources] of Object.entries(pdfSources())) {
		freshness[pdf] = Object.fromEntries(sources.filter((file) => existsSync(join(ROOT, file))).map((file) => [file, sha256(file)]))
	}
	writeFileSync(FRESHNESS, `${JSON.stringify(freshness, null, '\t')}\n`)
	console.log(`\nmake book  ok  ${Object.keys(PDFS).length} PDFs, every canary and command whole, fonts embedded, every block spaced, no page mostly empty`)
}
