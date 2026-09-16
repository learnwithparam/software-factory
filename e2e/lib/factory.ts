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

/** The board's phases, in the order work moves through them. */
export const PHASES = ['intake', 'triage', 'planning', 'execute', 'review', 'done', 'canceled'] as const
export type Phase = (typeof PHASES)[number]

function secret(name: string): string {
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
 * Sign in through the API and load the board already authenticated.
 *
 * Better Auth refuses a request with no Origin, which is its protection against
 * a browser being tricked into making one, so a script has to say where it is
 * pretending to be from.
 */
export async function openBoard(page: Page): Promise<void> {
	const response = await page.request.post(`${BASE}/auth/api/sign-in/email`, {
		headers: { origin: BASE },
		data: { email: EMAIL, password: secret('FACTORY_USER_PASSWORD') },
	})
	if (!response.ok()) throw new Error(`sign-in answered ${response.status()}`)

	await page.goto(BASE, { waitUntil: 'domcontentloaded' })
	await expect(page.locator('[data-testid="board-column-intake"]')).toBeVisible({ timeout: 60_000 })
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

export async function openSession(page: Page, title: string): Promise<void> {
	await cardByTitle(page, title).click()
	await page.waitForTimeout(2_000)
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
	await expect(page.locator('[data-testid="board-column-intake"]')).toBeVisible({ timeout: 60_000 })
}
