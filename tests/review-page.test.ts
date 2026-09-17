/**
 * The review page is generated, and generated pages go stale.
 *
 * review.html exists so a run can be read without being re-run. A page that
 * lists yesterday's screenshots is worse than no page, because it looks like
 * evidence, so this asserts it accounts for every screenshot the manifest names.
 *
 * make e2e regenerates it after a run. This is what notices when somebody adds a
 * screenshot to the manifest and does not.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../scripts/tree-hash.ts'

const manifest = JSON.parse(readFileSync(join(ROOT, 'teach', 'manifest.json'), 'utf8')) as {
	screenshots: Array<{ name: string; shows: string }>
}

describe('review.html', () => {
	it('exists, because make e2e writes it', () => {
		expect(existsSync(join(ROOT, 'review.html'))).toBe(true)
	})

	it('accounts for every screenshot the manifest names', () => {
		const page = readFileSync(join(ROOT, 'review.html'), 'utf8')
		const missing = manifest.screenshots.filter((shot) => !page.includes(`id="${shot.name}"`))
		expect(missing.map((shot) => shot.name)).toEqual([])
	})

	it('says what each picture is meant to show', () => {
		const page = readFileSync(join(ROOT, 'review.html'), 'utf8')
		const silent = manifest.screenshots.filter((shot) => !page.includes(shot.shows.replace(/&/g, '&amp;')))
		expect(silent.map((shot) => shot.name)).toEqual([])
	})
})
