/**
 * Phase 3: the teaching surfaces hold one copy of each idea, and everything they
 * tell a facilitator to run is real.
 *
 * These tests are written before the content they check, so authoring the run
 * sheets is driven by them rather than audited after the fact.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
	PARTS,
	SHINGLE,
	SPINE,
	attributeValues,
	citedConcepts,
	declaredConcepts,
	namedMakeTargets,
	read,
	sessions,
	sheetPath,
	shingles,
	teachFiles,
} from '../scripts/teach.ts'
import { ROOT } from '../scripts/tree-hash.ts'

const makefile = readFileSync(join(ROOT, 'Makefile'), 'utf8')
const makeTargets = new Set([...makefile.matchAll(/^([a-z][a-z0-9-]*):/gm)].map((m) => m[1] as string))

it('every session has exactly one run sheet', () => {
	const missing = sessions()
		.filter((session) => !existsSync(join(ROOT, sheetPath(session))))
		.map(sheetPath)
	expect(missing, 'sessions declared with no run sheet').toEqual([])

	// And no orphan sheet, which would be a session nobody is scheduled to teach.
	const expected = new Set(sessions().map(sheetPath))
	const onDisk = readdirSync(join(ROOT, 'teach'))
		.filter((name) => name.endsWith('.html'))
		.map((name) => `teach/${name}`)
	expect(onDisk.filter((file) => !expected.has(file)), 'run sheets with no session').toEqual([])
})

it('every concept a run sheet cites is declared by the spine', () => {
	const declared = declaredConcepts(read(SPINE))
	expect(declared.size, 'the spine declares no concepts').toBeGreaterThan(0)

	const dangling: string[] = []
	for (const session of sessions()) {
		const file = sheetPath(session)
		for (const concept of citedConcepts(read(file))) {
			if (!declared.has(concept)) dangling.push(`${file} cites ${concept}`)
		}
		for (const concept of session.covers) {
			if (!declared.has(concept)) dangling.push(`sessions.json says ${session.key} covers ${concept}`)
		}
	}
	expect(dangling).toEqual([])
})

it('every concept the spine declares is taught by a session', () => {
	// A concept no session covers is an explanation nobody delivers.
	const covered = new Set(sessions().flatMap((session) => session.covers))
	const orphans = [...declaredConcepts(read(SPINE))].filter((concept) => !covered.has(concept))
	expect(orphans).toEqual([])
})

it('every run sheet segment is complete', () => {
	const incomplete: string[] = []
	for (const session of sessions()) {
		const text = read(sheetPath(session))
		const segments = [...text.matchAll(/data-segment="([^"]+)"([\s\S]*?)(?=data-segment="|$)/g)]
		if (segments.length === 0) {
			incomplete.push(`${sheetPath(session)} has no segments`)
			continue
		}
		for (const [, name, body] of segments) {
			const present = new Set(
				[...(body as string).matchAll(/data-part="([a-z]+)"/g)].map((m) => m[1] as string),
			)
			const absent = PARTS.filter((part) => !present.has(part))
			if (absent.length > 0) {
				incomplete.push(`${sheetPath(session)} segment ${name} lacks ${absent.join(', ')}`)
			}
		}
	}
	expect(incomplete).toEqual([])
})

it('every command and file a teach surface names exists', () => {
	const problems: string[] = []
	for (const file of teachFiles()) {
		const text = read(file)
		for (const target of namedMakeTargets(text)) {
			if (!makeTargets.has(target)) problems.push(`${file} names make ${target}`)
		}
		for (const cited of attributeValues(text, 'data-file')) {
			if (!existsSync(join(ROOT, cited))) problems.push(`${file} cites ${cited}`)
		}
	}
	expect(problems).toEqual([])
})

it('no prose is duplicated across teach surfaces', () => {
	// One resolver per concept, applied to writing. An explanation belongs to the
	// spine; a run sheet points at it. Code and commands are exempt.
	const seen = new Map<string, string>()
	const duplicates: string[] = []
	for (const file of teachFiles()) {
		for (const phrase of shingles(read(file)).keys()) {
			const owner = seen.get(phrase)
			if (owner && owner !== file) {
				duplicates.push(`${file} repeats ${SHINGLE} words from ${owner}: "${phrase}"`)
			} else if (!owner) {
				seen.set(phrase, file)
			}
		}
	}
	expect(duplicates.slice(0, 5)).toEqual([])
})
