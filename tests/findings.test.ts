/**
 * The page may not quietly drop a finding it finds inconvenient.
 *
 * workbook.html teaches that a rule written in a prompt is a request and a rule
 * written in a gate is a limit. That lesson is only worth anything if the page
 * carries every instruction the run ignored, including the ones that make the
 * product look worse, so this test reads evidence/prompt-vs-gate.json and
 * insists on two things: nothing quoted on the page is invented, and nothing
 * the run recorded is missing from it.
 *
 * The second half is the one that matters. Every other gate here catches a
 * claim the code cannot support; this one catches a truth the page left out,
 * which is the failure mode of anybody writing up their own demo.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../scripts/tree-hash.ts'

interface Finding {
	readonly route: string
	readonly asked: string
	readonly heldRuns: number
	readonly missedRuns: number
}

const RECORD = join(ROOT, 'evidence', 'prompt-vs-gate.json')
const present = existsSync(RECORD)

describe.if(present)('every prompt-level finding', () => {
	const { findings } = JSON.parse(readFileSync(RECORD, 'utf8')) as { findings: Finding[] }
	const page = readFileSync(join(ROOT, 'workbook.html'), 'utf8')
	const quoted = [...page.matchAll(/data-finding="([^"]+)"/g)].map((match) => match[1] as string)

	it('is recorded against a route the run actually took', () => {
		expect(findings.length).toBeGreaterThan(0)
		const routes = new Set(findings.map((finding) => finding.route))
		expect([...routes].filter((route) => route.trim() === '')).toEqual([])
	})

	it('that the page quotes, resolves in the record', () => {
		const unknown = quoted.filter((key) => !findings.some((finding) => finding.route === key))
		expect(unknown, 'workbook.html cites a finding no run recorded').toEqual([])
	})

	// Ever missed, not missed most recently. A claim the agent honoured on the
	// latest run and ignored on the one before is the finding, not an old result
	// to be cleared: a later green run is evidence that the behaviour varies,
	// which is a stronger thing to teach than a failure that repeats.
	it('that did not hold on some run, appears on the page', () => {
		const broke = findings.filter((finding) => finding.missedRuns > 0).map((finding) => finding.route)
		const missing = [...new Set(broke)].filter((route) => !quoted.includes(route))
		expect(missing, 'a run recorded an instruction the model ignored and the page does not say so').toEqual([])
	})

	it('is described on the page in the words the run used', () => {
		const broke = findings.filter((finding) => finding.missedRuns > 0 && quoted.includes(finding.route))
		const undescribed = broke.filter((finding) => !page.includes(finding.asked))
		expect(undescribed.map((finding) => finding.route), 'the page cites a finding without saying what was asked for').toEqual([])
	})

	it('that varies between runs is told as varying, not as settled', () => {
		// The strongest evidence in the material is a claim with runs on both
		// sides of it, so the page may not describe one as if it always fails.
		const both = findings.filter((finding) => finding.heldRuns > 0 && finding.missedRuns > 0)
		if (both.length === 0) return
		expect(page, 'a claim held on some runs and not others, and the page never says the behaviour varies')
			.toMatch(/on one run|some runs|run to run|not always/i)
	})
})
