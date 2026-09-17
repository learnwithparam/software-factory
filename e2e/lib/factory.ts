/**
 * Every Mastra Factory selector and wait, in one file.
 *
 * This is early access software and its interface will move. When it does, this
 * is the file to fix, and no spec should ever reach past it to a class name or a
 * piece of copy. The board exposes `data-testid` on each column and on each
 * card, which is what everything below is built on.
 *
 * The waits are the other half. A board that polls GitHub every minute and runs
 * agents in sandboxes does not settle on a timer, so nothing here sleeps for a
 * fixed period and hopes.
 */

import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const BASE = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'
export const EMAIL = process.env.FACTORY_USER_EMAIL ?? 'lab@learnwithparam.com'
export const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

/** Where global-setup.ts leaves the one session the whole run shares. */
export const AUTH = join(import.meta.dirname, '..', '..', 'artifacts', 'auth.json')

/** The board's phases, in the order work moves through them. */
export const PHASES = ['intake', 'triage', 'planning', 'execute', 'review', 'done', 'canceled'] as const
export type Phase = (typeof PHASES)[number]

export function secret(name: string): string {
	const path = join(homedir(), '.config', 'lwp-secrets', 'factory.env')
	const value = readFileSync(path, 'utf8')
		.split('\n')
		.map((line) => new RegExp(`^${name}=(.*)$`).exec(line.trim())?.[1])
		.find((found): found is string => found !== undefined)
		?.replace(/^["'](.*)["']$/, '$1')
	if (value === undefined) throw new Error(`${name} is not in ${path}`)
	return value
}

/**
 * Load the board, already authenticated.
 *
 * The session comes from global-setup.ts through `use.storageState`, so this
 * signs in nothing. It used to sign in on every call, which the full sequence
 * turned into nine sign-ins inside ten seconds and one shared Better Auth
 * bucket answering 429.
 */
export async function openBoard(page: Page): Promise<void> {
	await page.goto(BASE, { waitUntil: 'domcontentloaded' })

	// An unauthenticated board is an indistinguishable empty board, and the wait
	// below then spends sixty seconds on a column that will never be drawn and
	// reports a timeout. The board has no password field; the sign-in form does.
	if ((await page.locator('input[type="password"]').count()) > 0) {
		throw new Error(`${BASE} is showing its sign-in form, so no session reached the browser: check artifacts/auth.json and global-setup.ts`)
	}

	await settleBoard(page)
}

/**
 * Wait for the board to stop drawing.
 *
 * The columns become visible long before their cards do, and a count taken in
 * that gap reads zero: six issues on the board and a spec insisting there are
 * none. Waiting for a fixed period would trade one flake for another, so this
 * waits for the number of cards to stop changing.
 *
 * Stability rather than a selector, because the skeletons are an implementation
 * detail and this file exists so that a UI change is one fix rather than nine.
 */
export async function settleBoard(page: Page, timeoutMs = 60_000): Promise<void> {
	await expect(page.locator('[data-testid="board-column-intake"]')).toBeVisible({ timeout: timeoutMs })

	const cards = page.locator('[data-testid="work-item-card"]')
	const deadline = Date.now() + timeoutMs
	let last = -1
	let stable = 0
	while (Date.now() < deadline) {
		const now = await cards.count()
		stable = now === last ? stable + 1 : 0
		last = now
		// Three readings the same. Two is enough for a board that never had cards
		// and not enough for one still painting them in.
		if (stable >= 3) return
		await page.waitForTimeout(500)
	}
	throw new Error(`the board was still drawing after ${Math.round(timeoutMs / 1000)}s`)
}

export function column(page: Page, phase: Phase) {
	return page.locator(`[data-testid="board-column-${phase}"]`)
}

/** Cards carry the issue title as their accessible name, which is what a person reads. */
export function card(page: Page, title: string) {
	return page.locator('[data-testid="work-item-card"]').filter({ has: page.locator(`[aria-label]`) }).filter({ hasText: title }).first()
}

export function cardByTitle(page: Page, title: string) {
	return page.locator(`[data-testid="work-item-card"][aria-label="${title}"]`)
}

/** How many cards sit in a phase right now. */
export async function count(page: Page, phase: Phase): Promise<number> {
	return column(page, phase).locator('[data-testid="work-item-card"]').count()
}

/**
 * Wait for an item to reach a phase.
 *
 * Long by default. A run claims a sandbox, installs what the repository needs
 * and calls a model, and a timeout tuned for a fast day is a test that fails on
 * a slow one for no reason anybody can act on.
 */
export async function waitForPhase(page: Page, title: string, phase: Phase, timeout = 12 * 60 * 1000): Promise<void> {
	await expect(async () => {
		await page.reload({ waitUntil: 'domcontentloaded' })
		await expect(column(page, phase).locator(`[aria-label="${title}"]`)).toBeVisible({ timeout: 5_000 })
	}).toPass({ timeout, intervals: [5_000] })
}

/** Which phase an item is in, or undefined when the board does not show it. */
export async function phaseOf(page: Page, title: string): Promise<Phase | undefined> {
	for (const phase of PHASES) {
		if ((await column(page, phase).locator(`[aria-label="${title}"]`).count()) > 0) return phase
	}
	return undefined
}

/** Press a button on one card, such as Investigate or Accept. */
export async function act(page: Page, title: string, action: string): Promise<void> {
	const target = cardByTitle(page, title)
	await target.scrollIntoViewIfNeeded()
	await target.getByRole('button', { name: action }).click()
}

export async function openSession(page: Page, title: string): Promise<string> {
	// The button, not the card: clicking the card selects it and leaves the board
	// on screen. And found by the text a person reads rather than by aria-label,
	// because the first click this suite ever attempted timed out waiting for
	// [aria-label="<title>"] on a card that plainly showed the title. Every click
	// path in the run sheets was written from reading the interface rather than
	// driving it, and this is the first one to be driven.
	// Go back to the board, not reload whatever is on screen. After one session is
	// open the page is on the session, and reloading it stays there, so the second
	// call waits for a card that is not on the page at all.
	//
	// And it has to be a fresh load either way: the board is a snapshot from when
	// it was drawn, and this suite moves items through the API, so a card that has
	// reached planning is still drawn in intake offering Investigate.
	await page.goto(BASE, { waitUntil: 'domcontentloaded' })
	await settleBoard(page)
	const target = page.locator('[data-testid="work-item-card"]').filter({ hasText: title }).first()
	await target.scrollIntoViewIfNeeded()
	await target.getByRole('button', { name: 'Open session' }).click({ timeout: 30_000 })
	await page.waitForTimeout(3_000)

	// The address, so a caller can come back. The button is not always on the
	// card: after a stage runs again it is gone, and the session it opened is
	// still there. A URL survives that; a button does not.
	return page.url()
}

/** The two switches that decide how much of the board runs unattended. */
export async function setAutomation(page: Page, which: 'Auto-start runs' | 'Auto-approve plans', on: boolean): Promise<void> {
	const toggle = page.getByRole('switch', { name: which })
	const state = await toggle.getAttribute('data-checked')
	const isOn = state !== null
	if (isOn !== on) await toggle.click()
}

export { expect }

/**
 * Reload and wait for the board to actually be there.
 *
 * domcontentloaded fires before this interface has drawn anything, so a reload
 * followed by a screenshot photographs a spinner. Every spec reloads through
 * here rather than calling page.reload itself.
 */
export async function showBoard(page: Page): Promise<void> {
	await page.reload({ waitUntil: 'domcontentloaded' })
	await settleBoard(page)
}
