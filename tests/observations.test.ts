/**
 * The arithmetic behind every figure in the findings table.
 *
 * These numbers are the argument: a claim the agent honoured on some runs and
 * ignored on others is the whole reason the material stopped teaching that the
 * ownership graph is a gate. So the counting gets tested on its own, without a
 * factory running, including the two ways it could quietly inflate.
 */

import { describe, expect, it } from 'bun:test'
import { merge, runsCounted, uncounted, type Observation, type Record } from '../scripts/lib/observations.ts'

const asked = 'a propose target waits for a person'
const held = (yes: boolean): Observation => ({ route: 'cross-stack', asked, held: yes, saw: yes ? 'it waited' : 'it did not' })
const line = (yes: boolean): string => JSON.stringify(held(yes))

describe('counting a claim across runs', () => {
	it('records the first reading', () => {
		const findings = merge({ findings: [] }, [held(false)])
		expect(findings).toHaveLength(1)
		expect(findings[0]?.missedRuns).toBe(1)
		expect(findings[0]?.heldRuns).toBe(0)
	})

	it('keeps both sides when a later run behaves differently', () => {
		const findings = merge({ findings: merge({ findings: [] }, [held(false)]) }, [held(true)])
		expect(findings[0]?.missedRuns, 'the earlier miss is the finding and does not get cleared').toBe(1)
		expect(findings[0]?.heldRuns).toBe(1)
	})

	it('keeps what the missing run saw, even after a run that held', () => {
		const findings = merge({ findings: merge({ findings: [] }, [held(false)]) }, [held(true)])
		expect(findings[0]?.sawWhenMissed).toBe('it did not')
	})

	it('counts one reading per claim per run, not one per spec that recorded it', () => {
		// make finish reruns a spec inside the same run, which appends the claim
		// a second time. Counting both would report two runs where there was one.
		const findings = merge({ findings: [] }, [held(false), held(false)])
		expect(findings[0]?.missedRuns).toBe(1)
	})

	it('reports the runs a claim has actually been read on', () => {
		expect(runsCounted(merge({ findings: [] }, [held(true)]))).toBe(1)
		expect(runsCounted([])).toBe(0)
	})
})

describe('deciding which observations are new', () => {
	const counted = (lines: string[]): Record => ({ countedLines: lines.length, countedFirst: lines[0], findings: [] })

	it('takes only what was appended when a run is extended', () => {
		const first = [line(false), line(true)]
		const after = [...first, line(false)]
		expect(uncounted(counted(first), after)).toEqual([line(false)])
	})

	it('takes everything when the file was replaced by a new run', () => {
		// make e2e deletes the file before each sequence, so the first line changes.
		const first = [line(false), line(true)]
		const fresh = [line(true), line(true), line(false)]
		expect(uncounted(counted(first), fresh)).toEqual(fresh)
	})

	it('takes everything when a new run is longer than the count it replaces', () => {
		// The case length alone gets wrong: a longer sequence looks like an append
		// and its first readings would be dropped.
		const first = [line(false)]
		const fresh = [line(true), line(false), line(false)]
		expect(uncounted(counted(first), fresh)).toEqual(fresh)
	})

	it('takes everything the first time, when nothing has been counted', () => {
		expect(uncounted({ findings: [] }, [line(false)])).toEqual([line(false)])
	})

	it('takes nothing when the file has not changed', () => {
		const first = [line(false), line(true)]
		expect(uncounted(counted(first), first)).toEqual([])
	})
})
