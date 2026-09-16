/**
 * The board, before anything has run.
 *
 * This is the picture Lightning 1 opens on and the one every other spec depends
 * on being true: six items waiting, nothing started, and the two switches that
 * decide how much of what follows happens without a person.
 */

import { test } from '@playwright/test'
import { column, count, expect, openBoard, PHASES } from '../lib/factory.ts'
import { shot } from '../lib/shot.ts'

test('six items are waiting and nothing has started', async ({ page }) => {
	await openBoard(page)

	expect(await count(page, 'intake')).toBe(6)
	for (const phase of ['triage', 'planning', 'execute', 'review'] as const) {
		expect(await count(page, phase), `${phase} should be empty before a run`).toBe(0)
	}

	await shot(page, 'factory-intake')
})

test('the board shows every phase work moves through', async ({ page }) => {
	await openBoard(page)
	// Naming them in a test is what makes a renamed phase a failure rather than a
	// surprise on the day a session runs.
	for (const phase of PHASES) {
		await expect(column(page, phase), `no column for ${phase}`).toBeAttached()
	}
	await shot(page, 'factory-board-work')
})

test('the two automation switches are both off', async ({ page }) => {
	await openBoard(page)
	// Every session starts from here, so a demonstration is never explained by a
	// setting somebody left on last time.
	for (const name of ['Auto-start runs', 'Auto-approve plans']) {
		const toggle = page.getByRole('switch', { name })
		await expect(toggle).toBeVisible()
		await expect(toggle).toHaveAttribute('data-unchecked', '')
	}
	await shot(page, 'factory-automation-settings')
})
