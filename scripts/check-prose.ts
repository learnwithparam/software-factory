/**
 * Fail on em or en dashes and filler words in learner-facing prose.
 *
 * The word lists copy learnwithparam's house rules, so CI enforces them without
 * the author's machine. With no arguments it checks every tracked markdown and
 * HTML file, which is what `make check` runs: a rule that only fires on files
 * someone remembered to list is a rule that stops firing.
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ROOT, trackedFiles } from './tree-hash.ts'

const DASHES: ReadonlyArray<readonly [string, string]> = [
	['—', 'em dash'],
	['–', 'en dash'],
]

const WORDS = [
	'crucial', 'cutting-edge', 'delve', 'game-changer', 'landscape', 'leverage', 'notably',
	'paradigm', 'realm', 'revolutionize', 'robust', 'seamless', 'straightforward', 'unleash',
]

const PHRASES = [
	"as an ai", "let's dive in", "in today's world", 'buckle up', "here's the thing",
	'the reality is', "it's worth noting", "it's important to note", 'it should be noted',
	'at its core', 'in the ever-evolving', 'without further ado', 'a testament to',
	'navigate the complexities', 'stands out as', 'serves as a',
]

const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
	[/&mdash;|&#8212;|&#x2014;/gi, '—'],
	[/&ndash;|&#8211;|&#x2013;/gi, '–'],
	[/&amp;/gi, '&'],
]

function unescapeHtml(text: string): string {
	return ENTITIES.reduce((out, [pattern, char]) => out.replace(pattern, char), text)
}

export function violations(text: string): string[] {
	const found: string[] = []
	unescapeHtml(text)
		.split('\n')
		.forEach((line, index) => {
			const lineNumber = index + 1
			const lower = line.toLowerCase()
			for (const [char, name] of DASHES) {
				if (line.includes(char)) found.push(`${lineNumber}: ${name}`)
			}
			for (const word of WORDS) {
				if (new RegExp(`\\b${word.replace('-', '\\-')}\\b`).test(lower)) {
					found.push(`${lineNumber}: '${word}'`)
				}
			}
			for (const phrase of PHRASES) {
				if (lower.includes(phrase)) found.push(`${lineNumber}: '${phrase}'`)
			}
		})
	return found
}

export function proseFiles(): string[] {
	return trackedFiles().filter((file) => /\.(md|html)$/.test(file) && !file.startsWith('node_modules/'))
}

if (process.argv[1] === import.meta.filename) {
	const paths = process.argv.slice(2)
	const files = paths.length > 0 ? paths : proseFiles()
	let failed = false
	for (const file of files) {
		for (const violation of violations(readFileSync(isAbsolute(file) ? file : join(ROOT, file), 'utf8'))) {
			console.log(`${file}:${violation}`)
			failed = true
		}
	}
	if (!failed) console.log(`prose clean: ${files.length} files`)
	process.exit(failed ? 1 : 0)
}
