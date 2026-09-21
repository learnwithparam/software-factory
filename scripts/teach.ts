/**
 * Read the teaching documents.
 *
 * Two documents with one copy of each idea. `workbook.html` is the attendee workbook
 * and the only place an explanation is written. `guide.html` is the facilitator guide:
 * one part per session, carrying the talk track and the commands, pointing at ideas by
 * id rather than restating them.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'

export const WORKBOOK = 'workbook.html'
export const GUIDE = 'guide.html'

export type SessionKind = 'lesson' | 'module' | 'workshop' | 'office-hours'

export interface Session {
	readonly key: string
	readonly kind: SessionKind
	readonly title: string
	readonly minutes: number
	/** Concept ids this session is responsible for teaching. */
	readonly covers: readonly string[]
	/** Step directories it demonstrates, empty for a session that demos nothing. */
	readonly steps: readonly string[]
}

/** Parts every guide segment must carry. */
export const PARTS = ['when', 'goal', 'say', 'run', 'expect', 'ask'] as const

export function sessions(): Session[] {
	const raw = JSON.parse(readFileSync(join(ROOT, 'teach/sessions.json'), 'utf8'))
	return raw.sessions
}

export function teachFiles(): string[] {
	return [WORKBOOK, GUIDE]
}

export function read(file: string): string {
	return readFileSync(join(ROOT, file), 'utf8')
}

/** Concept ids declared by the workbook. */
export function declaredConcepts(text: string): Set<string> {
	return new Set([...text.matchAll(/id="c-([a-z0-9-]+)"/g)].map((m) => m[1] as string))
}

/** Concept ids cited anywhere through data-concept. */
export function citedConcepts(text: string): Set<string> {
	return new Set([...text.matchAll(/data-concept="([a-z0-9-]+)"/g)].map((m) => m[1] as string))
}

/** The part of the guide that belongs to one session, from its opening to the next one. */
export function sessionText(guide: string, key: string): string {
	const start = guide.indexOf(`id="s-${key}"`)
	if (start === -1) return ''
	const next = guide.indexOf('class="session opens"', start)
	return guide.slice(start, next === -1 ? undefined : next)
}

export function attributeValues(text: string, attribute: string): Set<string> {
	const pattern = new RegExp(`${attribute}="([^"]+)"`, 'g')
	return new Set([...text.matchAll(pattern)].map((m) => m[1] as string))
}

/**
 * Make targets a surface tells the reader to run.
 *
 * Only code and terminal blocks are scanned. Ordinary prose contains "make sure"
 * and "make sense", and treating those as commands produced a check that cried
 * wolf, which is the fastest way to get a check ignored.
 */
export function namedMakeTargets(text: string): Set<string> {
	const blocks = [...text.matchAll(/<(pre|code)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2] as string)
	const found = new Set<string>()
	for (const block of blocks) {
		for (const match of block.matchAll(/\bmake ([a-z][a-z0-9-]*)/g)) found.add(match[1] as string)
	}
	return found
}

const TAGS = /<(script|style|pre|code)[\s\S]*?<\/\1>|<[^>]+>/g
const PUNCTUATION = /[^a-z0-9' ]+/g

/** Visible prose, with markup, code and commands removed. */
export function prose(text: string): string[] {
	return text
		.replace(TAGS, ' ')
		.toLowerCase()
		.replace(PUNCTUATION, ' ')
		.split(/\s+/)
		.filter(Boolean)
}

export const SHINGLE = 12

/** Every SHINGLE-word sequence in a surface's prose. */
export function shingles(text: string): Map<string, number> {
	const words = prose(text)
	const found = new Map<string, number>()
	for (let i = 0; i + SHINGLE <= words.length; i += 1) {
		const phrase = words.slice(i, i + SHINGLE).join(' ')
		found.set(phrase, (found.get(phrase) ?? 0) + 1)
	}
	return found
}
