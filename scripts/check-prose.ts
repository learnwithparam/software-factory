/**
 * Fail on em or en dashes and filler words in learner-facing prose.
 *
 * The word lists are scripts/prose-rules.json, a committed copy of learnwithparam's
 * house rules, so CI enforces them without the author's machine. With no arguments it checks every tracked markdown and
 * HTML file, which is what `make check` runs: a rule that only fires on files
 * someone remembered to list is a rule that stops firing.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { ROOT, trackedFiles } from './tree-hash.ts'

const DASHES: ReadonlyArray<readonly [string, string]> = [
	['—', 'em dash'],
	['–', 'en dash'],
]

const RULES_FILE = join(ROOT, 'scripts/prose-rules.json')
const HOUSE_RULES = join(homedir(), '.claude/skills/lwp-shared/scripts/house_rules.py')
const RULES: { words: string[]; phrases: string[] } = JSON.parse(readFileSync(RULES_FILE, 'utf8'))
const WORDS = RULES.words
const PHRASES = RULES.phrases

/**
 * The lists are a committed copy of the house rules. Where the rules live, prove the copy
 * matches them. CI has no home directory, so it passes there: drift is caught on a
 * developer machine only.
 */
export function rulesStale(): string | null {
	if (!existsSync(HOUSE_RULES)) {
		console.log('prose rules: not compared with the house rules, none on this machine')
		return null
	}
	const current = JSON.parse(execFileSync('python3', [HOUSE_RULES, '--vendor'], { encoding: 'utf8' }))
	if (JSON.stringify(current) === JSON.stringify(RULES)) return null
	return 'scripts/prose-rules.json is out of date: run house_rules.py --vendor > scripts/prose-rules.json'
}

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
	const stale = rulesStale()
	if (stale) {
		console.log(stale)
		failed = true
	}
	for (const file of files) {
		for (const violation of violations(readFileSync(isAbsolute(file) ? file : join(ROOT, file), 'utf8'))) {
			console.log(`${file}:${violation}`)
			failed = true
		}
	}
	if (!failed) console.log(`prose clean: ${files.length} files`)
	process.exit(failed ? 1 : 0)
}
