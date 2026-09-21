/**
 * Every control the guide sends a presenter to is one that exists.
 *
 * Each session carries a click path, and they were written by reading
 * the interface. The first time anything drove one it timed out on a button that
 * was not on the card. A path nobody has walked is a guess, and a presenter
 * discovers that in front of a room.
 *
 * This is the cheap half: the names are spelled the way the interface spells
 * them. 11-click-paths.spec.ts is the half that opens the page and looks.
 */

import { describe, expect, it } from 'bun:test'
import { CONTROLS, isControl } from '../e2e/lib/controls.ts'
import { GUIDE, read, sessionText, sessions } from '../scripts/teach.ts'

/** The steps of the click path in one session, if it has one. */
function steps(key: string): string[] {
	const block = /<ul class="path">([\s\S]*?)<\/ul>/.exec(sessionText(read(GUIDE), key))
	if (block === null) return []
	return [...(block[1] as string).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
		.map((match) => (match[1] as string).replace(/<[^>]+>/g, '').trim())
		.filter((step) => step !== '' && step !== 'to')
}

describe('every click path', () => {
	it('names controls the interface actually has', () => {
		const unknown: string[] = []
		for (const session of sessions()) {
			for (const step of steps(session.key)) {
				if (isControl(step) && !CONTROLS.includes(step)) unknown.push(`${session.key}: ${step}`)
			}
		}
		expect(unknown).toEqual([])
	})

	it('exists at all, in every session', () => {
		const missing = sessions().filter((session) => steps(session.key).length === 0)
		expect(missing.map((session) => session.key)).toEqual([])
	})
})
