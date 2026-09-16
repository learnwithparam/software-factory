/**
 * A screenshot is the one artefact a test cannot check by reading.
 *
 * Four of the first eight pictures this suite produced were the Mastra spinner
 * or the words "Loading boards...", and every assertion around them passed,
 * because `waitUntil: 'domcontentloaded'` returns long before that interface has
 * drawn anything. Nothing caught it until a person opened the file.
 *
 * So the refusal lives in shot(), and this is what proves the refusal works.
 */

import { describe, expect, it } from 'bun:test'
import { looksUnfinished } from '../e2e/lib/shot.ts'

describe('a picture of a loading page', () => {
	it('is refused when the interface says it is loading', () => {
		expect(looksUnfinished('Loading boards...')).toBe(true)
		expect(looksUnfinished('Overview\nSupervisor\nLoading boards...')).toBe(true)
		expect(looksUnfinished('Loading…')).toBe(true)
	})

	it('is refused when nothing rendered at all', () => {
		// The spinner page: a logo, no text. This is the one that produced a 6.5K
		// screenshot of a blank background.
		expect(looksUnfinished('')).toBe(true)
		expect(looksUnfinished('   \n  ')).toBe(true)
	})

	it('allows a board that has actually drawn', () => {
		expect(looksUnfinished('Intake\nTriage\nPlanning\nBuilding\nReview\nDone')).toBe(false)
	})
})
