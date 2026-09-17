/**
 * Every picture in the teaching material, taken by the suite that proves it.
 *
 * A screenshot nobody takes is a screenshot that goes stale without anyone
 * noticing, so `teach/manifest.json` names each one and `make status` reports a
 * picture no spec captures as missing. Nothing here is taken by hand.
 *
 * Terminal output gets the same treatment. The text is real, captured from the
 * command actually running, and only the rendering is ours: a projector reads a
 * typeset block far better than a photograph of a terminal.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Page } from '@playwright/test'

export const ROOT = join(import.meta.dirname, '..', '..')
export const SCREENS = join(ROOT, 'evidence', 'screens')

/**
 * Text that means the page has not finished, whatever else is on it.
 *
 * Four of the first eight pictures this suite took were the Mastra spinner or
 * the words "Loading boards...", and every assertion around them passed. A
 * screenshot is the one artefact a test cannot check by reading, so the check
 * has to live here.
 */
const STILL_LOADING = [/Loading boards/i, /Loading\u2026/i, /Loading\.\.\./i]

/** Whether a rendered page is still telling us it has not finished. */
export function looksUnfinished(text: string): boolean {
	return text.trim() === '' || STILL_LOADING.some((pattern) => pattern.test(text))
}

/**
 * Photograph the page, refusing a page that is still loading.
 *
 * Throwing is the point. A blank picture in evidence/screens is worse than a
 * failed run, because the run tells you now and the picture tells you in front
 * of a room.
 */
/**
 * What each picture must have on screen, from the manifest that names it.
 *
 * Read from there rather than passed in, so the claim lives beside the caption
 * and no spec can quietly photograph something else.
 */
function mustShowFor(name: string): string | undefined {
	const manifest = JSON.parse(readFileSync(join(ROOT, 'teach', 'manifest.json'), 'utf8')) as {
		screenshots: Array<{ name: string; mustShow?: string }>
	}
	return manifest.screenshots.find((shot) => shot.name === name)?.mustShow
}

export async function shot(page: Page, name: string): Promise<void> {
	await settled(page, name)
	const text = (await page.locator('body').innerText().catch(() => '')) || ''

	// The claim the picture is making, checked against the page making it. Three
	// screenshots in this repository were a loading spinner or an empty board and
	// every assertion around them passed, because a PNG cannot be read by a test.
	const mustShow = mustShowFor(name)
	if (mustShow !== undefined && !text.includes(mustShow)) {
		throw new Error(`${name} should show ${JSON.stringify(mustShow)} and the page does not say it`)
	}

	mkdirSync(SCREENS, { recursive: true })
	await page.screenshot({ path: join(SCREENS, `${name}.png`), fullPage: false })
	// What was on screen, beside the picture of it, so make status can check a
	// stale file rather than trusting that it exists.
	writeFileSync(join(SCREENS, `${name}.txt`), text)
}

/** Wait for the interface to stop saying it is loading, then prove it stopped. */
export async function settled(page: Page, name: string, timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	let text = ''
	while (Date.now() < deadline) {
		text = (await page.locator('body').innerText().catch(() => '')) || ''
		if (!looksUnfinished(text)) return
		await page.waitForTimeout(500)
	}
	const saw = text.trim() === '' ? 'nothing rendered at all' : `"${text.slice(0, 60).replace(/\n/g, ' ')}"`
	throw new Error(`${name} would have photographed a loading page: ${saw}`)
}

/** A named region of a page, for when the whole viewport says too little. */
export async function shotOf(page: Page, selector: string, name: string): Promise<void> {
	mkdirSync(SCREENS, { recursive: true })
	const target = page.locator(selector).first()
	await target.scrollIntoViewIfNeeded()
	await target.screenshot({ path: join(SCREENS, `${name}.png`) })
}

export interface Ran {
	readonly command: string
	readonly output: string
	readonly exitCode: number
}

/** Run a command and keep exactly what it printed. */
export function run(command: string, cwd: string = ROOT): Ran {
	const result = spawnSync('bash', ['-lc', command], { cwd, encoding: 'utf8' })
	return {
		command,
		output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd(),
		exitCode: result.status ?? -1,
	}
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
}

/**
 * Colour the marks the commands print, so a verdict reads the same on a slide as
 * it does in a terminal. The text itself is untouched.
 */
function paint(text: string): string {
	return escapeHtml(text.replace(ANSI, ''))
		.split('\n')
		.map((line) => {
			const state = line.includes('VERDICT: PASS')
				? 'pass'
				: line.includes('VERDICT: FAIL')
					? 'fail'
					: line.includes('VERDICT: REFUSED')
						? 'refuse'
						: line.includes('VERDICT: MISCONFIGURED') || line.includes('VERDICT: NEEDS REVIEW')
							? 'wait'
							: line.startsWith('✓') || line.startsWith('✅')
								? 'pass'
								: line.startsWith('✗') || line.startsWith('❌')
									? 'fail'
									: line.startsWith('⊘')
										? 'refuse'
										: line.startsWith('○')
											? 'wait'
											: ''
			return state === '' ? line : `<span class="${state}">${line}</span>`
		})
		.join('\n')
}

/** Render real command output as a typeset block and photograph it. */
export async function shotTerminal(page: Page, name: string, ran: Ran, caption?: string): Promise<void> {
	mkdirSync(SCREENS, { recursive: true })
	const tokens = readFileSync(join(ROOT, 'teach', 'tokens.css'), 'utf8')
	const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${tokens}
body { margin: 0; padding: 28px; background: var(--c-bg); font-family: var(--font-sans); }
.card { border-radius: 10px; overflow: hidden; border: 1px solid var(--c-line); max-width: 1040px; }
.bar { background: var(--c-bg-inset); padding: 10px 16px; font-family: var(--font-mono); font-size: 13px; color: var(--c-ink-muted); }
/* Wrapped, not clipped. A finding that runs off the right edge of a slide is a
   finding the room does not read, and these lines are the point of the picture. */
pre { margin: 0; background: var(--c-term-bg); color: var(--c-term-ink); padding: 20px 24px;
      font-family: var(--font-mono); font-size: 14px; line-height: 1.55;
      white-space: pre-wrap; word-break: break-word; overflow: visible; }
.pass { color: #7ee3b0; } .fail { color: #ff9c92; } .wait { color: #f0cf6b; } .refuse { color: #b9aeff; }
p.cap { margin: 14px 2px 0; color: var(--c-ink-muted); font-size: 13px; max-width: 1040px; }
</style></head><body>
<div class="card"><div class="bar">$ ${escapeHtml(ran.command)}</div><pre>${paint(ran.output)}</pre></div>
${caption ? `<p class="cap">${escapeHtml(caption)}</p>` : ''}
</body></html>`

	await page.setContent(html, { waitUntil: 'load' })
	const card = page.locator('body')
	await card.screenshot({ path: join(SCREENS, `${name}.png`) })
}

export { dirname }
