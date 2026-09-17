import { defineConfig } from '@playwright/test'
import { AUTH } from './lib/factory.ts'

export default defineConfig({
	testDir: './specs',
	// One at a time. Several specs drive the same Factory, the same ledger
	// services and the same GitHub repository, and running them together would
	// make every failure a question about which one moved the board.
	workers: 1,
	fullyParallel: false,
	retries: 0,
	timeout: 15 * 60 * 1000,
	expect: { timeout: 30 * 1000 },
	reporter: [['list'], ['json', { outputFile: '../artifacts/playwright.json' }]],
	// One sign-in for the whole run, not one per openBoard. Better Auth shares a
	// single rate-limit bucket on localhost, and the sequence found it.
	globalSetup: './global-setup.ts',
	use: {
		storageState: AUTH,
		viewport: { width: 1440, height: 900 },
		baseURL: process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111',
		trace: 'retain-on-failure',
	},
})
