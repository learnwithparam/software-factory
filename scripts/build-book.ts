/**
 * Render the teaching surfaces to PDF, then read the PDFs back.
 *
 *   make book
 *
 * WHY IT CHECKS ITSELF
 *
 * A Chromium print-to-PDF fails in a way no visual review catches: every page
 * looks perfect and the text layer extracts as garbage. The causes are CSS
 * properties that are correct on screen, so nothing about the document looks
 * wrong and nobody rebuilds. Six of them are known and every one is reset in the
 * print block of teach/teach.css. This runs pdftotext over its own output and
 * asserts the resets are still doing their job:
 *
 *   welded      ui-sans-serif or system-ui resolves to SF Pro, which Chromium
 *               embeds as per-word runs with no space glyph, so a paragraph
 *               extracts as "onelongtoken"
 *   over-split  letter-spacing from about .13em emits one positioned run per
 *               character, so a heading extracts as "S I X L A Y E R S"
 *   canaries    catch everything else, including the local corruptions that
 *               move no whole-document count: a negative margin that leaves its
 *               containing block drops the first character of every run inside
 *               it, and only inside it
 *
 * poppler is a hard dependency. A verification that skips when its tool is
 * missing is not a verification.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BOOK, GENERATED, canaries, compose, pdfSources, sheetPdf, titleOf } from './book.ts'
import { sessions, sheetPath } from './teach.ts'
import { ROOT } from './tree-hash.ts'

const FRESHNESS = join(ROOT, 'scripts/pdf-freshness.json')

/** Margin boxes are what put a page number on the page. Chromium grew them in 131. */
const MARGIN_BOXES_FROM = 131

function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}

function runningHead(title: string): string {
	// The blank for the title page is repeated here, because Chromium takes the
	// last margin box it is given rather than the most specific one: the rule in
	// teach.css loses to this one and a cover prints with a head across the top.
	return `@page { @top-left { content: ${JSON.stringify(title)}; font-family: Helvetica, Arial, sans-serif; font-size: 8.5pt; color: #948D80; } }
@page :first { @top-left { content: ""; } }`
}

/**
 * The inset lives in @page in teach/teach.css and nowhere else. A CSS @page
 * margin overrides whatever is passed here, so passing one too would only hide
 * which of them is live.
 */
const PDF_OPTIONS = { format: 'A4' as const, printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } }

function extract(path: string): string {
	return execFileSync('pdftotext', ['-raw', path, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
		.replace(/\s+/g, ' ')
}

/** Everything wrong with one PDF's text layer, named so it can be acted on. */
export function textLayerProblems(raw: string, expected: string[]): string[] {
	const problems: string[] = []

	const missing = expected.filter((phrase) => !raw.includes(phrase))
	for (const phrase of missing.slice(0, 3)) {
		problems.push(`missing from the text layer: "${phrase}"`)
	}
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
				'Reset letter-spacing in the print block of teach/teach.css.',
		)
	}
	return problems
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

	const html = compose()
	mkdirSync(join(ROOT, dirname(GENERATED)), { recursive: true })
	writeFileSync(join(ROOT, GENERATED), html)

	const jobs: Array<{ out: string; source: string; head: string; expect: string[] }> = [
		{ out: BOOK, source: GENERATED, head: '', expect: canaries(html) },
		...sessions().map((session) => ({
			out: sheetPdf(session.key),
			source: sheetPath(session),
			head: runningHead(titleOf(sheetPath(session))),
			expect: canaries(readFileSync(join(ROOT, sheetPath(session)), 'utf8')),
		})),
	]

	const page = await browser.newPage()
	const problems: string[] = []
	for (const job of jobs) {
		await page.goto(pathToFileURL(join(ROOT, job.source)).href, { waitUntil: 'networkidle' })
		if (job.head !== '') await page.addStyleTag({ content: job.head })
		const pdf = await page.pdf(PDF_OPTIONS)
		const out = join(ROOT, job.out)
		mkdirSync(dirname(out), { recursive: true })
		writeFileSync(out, pdf)

		const raw = extract(out)
		const found = textLayerProblems(raw, job.expect)
		if (found.length > 0) problems.push(...found.map((line) => `${job.out}: ${line}`))
		console.log(`${job.out.padEnd(38)} ${(pdf.length / 1024).toFixed(0).padStart(5)} KB  ${raw.split(' ').length} words extract`)
	}
	await browser.close()

	if (problems.length > 0) {
		console.error('\nmake book  FAIL  the PDFs render correctly and do not extract')
		for (const line of problems) console.error(`    ${line}`)
		console.error('\n    Compare: pdftotext -raw <file> - | less')
		process.exit(1)
	}

	// Content hashes, never modification times: a fresh checkout gives every file
	// the same timestamp in an arbitrary order, so an mtime gate can never pass in
	// CI. A hash also says something truer, that a file actually differs.
	const freshness: Record<string, Record<string, string>> = {}
	for (const [pdf, sources] of Object.entries(pdfSources())) {
		freshness[pdf] = {}
		for (const source of sources.filter((file) => existsSync(join(ROOT, file)))) {
			;(freshness[pdf] as Record<string, string>)[source] = sha256(join(ROOT, source))
		}
	}
	writeFileSync(FRESHNESS, `${JSON.stringify(freshness, null, '\t')}\n`)
	console.log(`\nmake book  ok  ${jobs.length} PDFs, every canary present, no welded and no over-split runs`)
}
