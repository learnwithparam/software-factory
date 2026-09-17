/**
 * Sign in once for the whole run, and prove the saved state can see the board.
 *
 * Better Auth rate-limits sign-in, and on localhost it cannot determine a
 * client address, so every spec in the suite shares one bucket. `openBoard`
 * used to sign in on each call: nine calls inside ten seconds, and specs four
 * to ten died with `sign-in answered 429` while every one of them passed when
 * run alone. That is the shape of the bug that only a full sequence finds.
 *
 * The state is captured from a real browser context rather than from an API
 * one, which matters more than it looks. A cookie alone authenticates: the
 * sidebar, the filters and the switcher all render. The switcher then says
 * "Select factory", the board draws its columns with nothing in them, and a
 * spec counting cards reads zero while the API reports eight. Loading the app
 * once here lets it choose its factory and persist the choice, and
 * storageState carries that with the cookie.
 *
 * It waits for a card before saving, because a state that cannot see the board
 * is the thing this exists to prevent, and an empty board is indistinguishable
 * from a broken session in a screenshot.
 */

import { chromium } from '@playwright/test'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { AUTH, BASE, EMAIL, secret } from './lib/factory.ts'

export default async function signInOnce(): Promise<void> {
	mkdirSync(dirname(AUTH), { recursive: true })

	const browser = await chromium.launch()
	const context = await browser.newContext()
	try {
		// Better Auth refuses a request with no Origin, which is its protection
		// against a browser being tricked into making one, so a script has to say
		// where it is pretending to be from.
		const response = await context.request.post(`${BASE}/auth/api/sign-in/email`, {
			headers: { origin: BASE },
			data: { email: EMAIL, password: secret('FACTORY_USER_PASSWORD') },
		})
		if (!response.ok()) {
			throw new Error(
				`sign-in answered ${response.status()}. A 429 here means a previous run signed in recently: Better Auth shares one bucket on localhost, so wait for its window rather than retrying.`,
			)
		}

		const page = await context.newPage()
		await page.goto(BASE, { waitUntil: 'domcontentloaded' })
		await page.locator('[data-testid="board-column-intake"]').waitFor({ state: 'visible', timeout: 90_000 })
		await page
			.locator('[data-testid="work-item-card"]')
			.first()
			.waitFor({ state: 'visible', timeout: 90_000 })
			.catch(() => {
				throw new Error(`${BASE} drew its board with no cards on it, so the saved session would see an empty board: make lab-reset`)
			})

		const state = await context.storageState({ path: AUTH })

		// A storage state with no cookie loads without complaint and every board
		// then times out waiting for a column that is never drawn.
		if (state.cookies.length === 0) throw new Error(`${BASE} accepted the sign-in and set no cookie`)
		console.log(`signed in once: ${state.cookies.length} cookies, ${state.origins.length} origins saved`)
	} finally {
		await browser.close()
	}

	// It holds a live session. Not committed, because artifacts/ is ignored, but
	// it should not be world-readable either.
	chmodSync(AUTH, 0o600)
}
