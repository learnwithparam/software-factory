/**
 * The product the factory works on.
 *
 * A session shows these beside the factory's own screens, because the point of
 * the whole exercise is a change landing in something a person uses. The console
 * computes no money: every figure here came from the service that owns it.
 */

import { expect, test } from '@playwright/test'
import { CONSOLE, INGEST, startLedger, stopLedger } from '../lib/ledger.ts'
import { shot } from '../lib/shot.ts'

test.beforeAll(async () => {
	await startLedger()
})

test.afterAll(() => {
	stopLedger()
})

test('the ledger lists its runs with what each one cost', async ({ page }) => {
	await page.goto(CONSOLE, { waitUntil: 'networkidle' })
	await expect(page.getByRole('heading', { name: /where the time and the money went/i })).toBeVisible()

	// A refusal is in the seeded data on purpose, so the table shows one.
	await expect(page.getByText('refused', { exact: true }).first()).toBeVisible()
	// The budget figure comes from the Rust binary, not from this page.
	await expect(page.getByText(/of .* allowed/)).toBeVisible()

	await shot(page, 'console-runs')
})

test('one run shows where its time went, and which stage took longest', async ({ page }) => {
	const runs = (await (await fetch(`${INGEST}/runs`)).json()) as Array<{ id: string; outcome: string }>
	const withStages = runs.find((run) => run.outcome !== 'refused')
	expect(withStages).toBeDefined()

	await page.goto(`${CONSOLE}/runs/${withStages?.id}`, { waitUntil: 'networkidle' })
	await expect(page.getByRole('heading', { name: 'Stages' })).toBeVisible()
	await expect(page.locator('.bar.slowest')).toBeVisible()
	await expect(page.getByText(/percent of the measured time/)).toBeVisible()

	await shot(page, 'console-waterfall')
})
