/**
 * Read a JUnit report written by `bun test --reporter=junit`.
 *
 * A test is identified by `<file relative to the repository root> > <name>`,
 * the same shape Playwright results use, so one scorecard can name both.
 *
 * The parser is deliberately small and strict: a report it cannot understand
 * raises rather than returning an empty map, because an empty map would read as
 * "nothing ran" and quietly score zero instead of saying the report is broken.
 */

import { readFileSync } from 'node:fs'

export type Status = 'passed' | 'failed' | 'skipped'

export interface JunitCase {
	file: string
	name: string
	status: Status
}

const SUITE = /<testsuite\b[^>]*\bfile="([^"]*)"[^>]*>([\s\S]*?)<\/testsuite>/g
const CASE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g
const NAME = /\bname="([^"]*)"/
const FILE = /\bfile="([^"]*)"/

function decode(value: string): string {
	return value
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'")
		.replaceAll('&amp;', '&')
}

export function parseJunit(xml: string): JunitCase[] {
	if (!xml.includes('<testsuites')) throw new Error('not a JUnit report')
	const cases: JunitCase[] = []
	for (const [, suiteFile, body] of xml.matchAll(SUITE)) {
		for (const [, attributes, selfClosing, inner] of (body as string).matchAll(CASE)) {
			const name = NAME.exec(attributes as string)?.[1]
			if (name === undefined) continue
			const file = FILE.exec(attributes as string)?.[1] ?? (suiteFile as string)
			const content = selfClosing === '/>' ? '' : ((inner as string) ?? '')
			const status: Status = content.includes('<skipped')
				? 'skipped'
				: content.includes('<failure') || content.includes('<error')
					? 'failed'
					: 'passed'
			cases.push({ file: decode(file), name: decode(name), status })
		}
	}
	return cases
}

export function idOf(entry: Pick<JunitCase, 'file' | 'name'>): string {
	return `${entry.file} > ${entry.name}`
}

export function readJunit(path: string): JunitCase[] {
	return parseJunit(readFileSync(path, 'utf8'))
}
