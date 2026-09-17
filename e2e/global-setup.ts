/**
 * Sign in once for the whole run.
 *
 * Better Auth rate-limits sign-in, and on localhost it cannot determine a
 * client address, so every spec in the suite shares one bucket. `openBoard`
 * used to sign in on each call: nine calls inside ten seconds, and specs four
 * to ten died with `sign-in answered 429` while every one of them passed when
 * run alone. That is the shape of the bug that only a full sequence finds, and
 * it is the reason the sequence is worth running.
 *
 * The session is written here once and loaded into every browser context by
 * `use.storageState`, so the suite makes one sign-in rather than fifteen.
 */

import { request } from '@playwright/test'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { AUTH, BASE, EMAIL, secret } from './lib/factory.ts'

export default async function signInOnce(): Promise<void> {
	mkdirSync(dirname(AUTH), { recursive: true })

	// Better Auth refuses a request with no Origin, which is its protection
	// against a browser being tricked into making one, so a script has to say
	// where it is pretending to be from.
	const context = await request.newContext()
	const response = await context.post(`${BASE}/auth/api/sign-in/email`, {
		headers: { origin: BASE },
		data: { email: EMAIL, password: secret('FACTORY_USER_PASSWORD') },
	})
	if (!response.ok()) {
		throw new Error(
			`sign-in answered ${response.status()}. A 429 here means a previous run signed in recently: Better Auth shares one bucket on localhost, so wait for its window rather than retrying.`,
		)
	}

	const state = await context.storageState({ path: AUTH })
	await context.dispose()

	// A storage state with no cookie loads without complaint and every board
	// then times out waiting for a column that is never drawn.
	if (state.cookies.length === 0) throw new Error(`${BASE} accepted the sign-in and set no cookie`)

	// It holds a live session. Not committed, because artifacts/ is ignored, but
	// it should not be world-readable either.
	chmodSync(AUTH, 0o600)
}
