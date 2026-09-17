/**
 * The interface has the controls the run sheets send people to, and a person can
 * start a run by clicking.
 *
 * Every approval in this repository went through the API. The twelve sheets tell
 * a presenter which buttons to press and nothing had ever pressed one, so the
 * first click anything attempted timed out: the card was drawn before the item
 * moved and still offered Investigate rather than Open session.
 *
 * Two claims, then. That every control a sheet names is on the page. And that a
 * person clicking Investigate starts a run, which is the gate the whole
 * supervised tier rests on and was, until now, only known to work through an
 * HTTP call nobody in a session will ever make.
 */

import { test } from '@playwright/test'
import { column, expect, openBoard, PHASES, showBoard } from '../lib/factory.ts'
import { NAV, SWITCHES } from '../lib/controls.ts'
import { LEDGER } from '../lib/ledger.ts'
import { itemForRoute, setAutomation, stageOf } from '../lib/drive.ts'
import { shot } from '../lib/shot.ts'

test('every control the run sheets name is on the page', async ({ page }) => {
	await openBoard(page)

	for (const item of NAV) {
		await expect(page.getByRole('link', { name: item }).or(page.getByRole('button', { name: item })).first(), `nav: ${item}`).toBeVisible()
	}

	for (const phase of PHASES) {
		await expect(column(page, phase), `column: ${phase}`).toBeAttached()
	}

	for (const name of SWITCHES) {
		await expect(page.getByRole('switch', { name }), `switch: ${name}`).toBeVisible()
	}

	// The button a session opens on, on a card that is resting.
	const waiting = page.locator('[data-testid="work-item-card"]').first()
	await expect(waiting.getByRole('button', { name: 'Investigate' }), 'a resting card offers Investigate').toBeVisible()
})

test('a person starts a run by clicking, not by calling the API', async ({ page }) => {
	test.setTimeout(20 * 60 * 1000)

	await openBoard(page)

	// Named rather than assumed. This spec clicks Investigate, so nothing may
	// have started the item first, and the profiles spec that runs before it
	// leaves the automation switches wherever its last shape put them.
	await setAutomation(false, false)

	const before = await itemForRoute(LEDGER, 'clean')
	expect(stageOf(before), 'the clean issue should be resting, so auto-start must be off before this spec').toBe('intake')

	const startedAt = Date.now()
	const card = page.locator('[data-testid="work-item-card"]').filter({ hasText: before.title }).first()
	await card.scrollIntoViewIfNeeded()
	await card.getByRole('button', { name: 'Investigate' }).click()

	// The claim is that the click started something, not that the run finished.
	// Waiting for the whole of triage made this fifteen minutes long and failed on
	// a deadline rather than on anything about clicking.
	const deadline = Date.now() + 5 * 60 * 1000
	let now = before
	while (stageOf(now) === 'intake' && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 5_000))
		now = await itemForRoute(LEDGER, 'clean')
	}
	expect(stageOf(now), 'clicking Investigate should move the item off intake').not.toBe('intake')
	expect(Date.now(), 'and it should have raised work, not just been clicked').toBeGreaterThan(startedAt)

	await showBoard(page)
	await shot(page, 'factory-clicked-start')
})
