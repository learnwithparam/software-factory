import { defineConfig } from '@playwright/test'

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
	use: {
		viewport: { width: 1440, height: 900 },
		baseURL: process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111',
		trace: 'retain-on-failure',
	},
})
