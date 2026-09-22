/**
 * Stamp the part of the tree an end-to-end run actually exercises.
 *
 * `make score` treats a result whose stamp differs from the tree on disk as missing, so
 * a long run is never claimed for code that has changed since. The question this file
 * answers is which files "changed since" should mean.
 *
 * It used to mean everything except a pattern matching prose, which was wrong in both
 * directions. A file nobody had thought about was stamped by default, so a new teaching
 * page silently invalidated every recorded run, and adding a `book` target to the
 * Makefile cost a full rerun to re-certify a change that cannot reach the harness. The
 * question is now asked directly: what does `make e2e` load?
 *
 * Two lists, each entry carrying the reason it is on that side, and a test fails when a
 * tracked path matches neither. Nothing lands on a side by default.
 *
 * `--all` covers every tracked file, which is what the `make check` stamp uses: those
 * results come from a suite that reads the whole repository.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ROOT = join(import.meta.dirname, '..')

/** What an end-to-end run loads. A change to any of it can change what the run proves. */
export const STAMPED: ReadonlyArray<readonly [string, string]> = [
	['steps/', 'the harness itself: policy, routing, execution, gates, delivery'],
	['scripts/', 'the loop, the executors, the run report and every script the e2e recipe calls'],
	['e2e/', 'the specs, and the helpers they assert through'],
	['profiles/', 'the company shapes a spec writes into the repository under test'],
	['recordings/', 'the transcripts a recorded executor replays'],
	['fixtures/', 'the invented repository the harness is pointed at'],
	['skills/', 'procedures the context router hands to a task'],
	['package.json', 'the dependencies all of it runs under'],
	['bun.lock', 'the exact versions of them'],
	['bunfig.toml', 'how the runtime is configured'],
	['tsconfig.json', 'how the harness is compiled'],
]

/** What it does not. A change here cannot alter what a recorded run proved. */
export const NOT_STAMPED: ReadonlyArray<readonly [string, string]> = [
	['workbook.html', 'prose: the attendee workbook'],
	['guide.html', 'prose: the facilitator guide'],
	['design/', 'how both look in print: brand tokens, stylesheet, fonts, and the figure descriptions, two of which the run writes'],
	['teach/', 'the session list and the manifest the teaching tests read'],
	['review.html', 'prose: a generated contact sheet of the run'],
	['sources.json', 'prose: the citations those pages carry'],
	['tests/', 'the unit and structural suite, which `make check` runs and no spec loads'],
	['evidence/', 'written by the run itself, so it cannot be an input to it'],
	['artifacts/', 'written by the run itself'],
	['.github/', 'CI configuration'],
	['.githooks/', 'the pre-commit hook that rebuilds the PDFs'],
	['LICENSE', 'not code'],
	['.gitignore', 'not code'],
]

/**
 * Scripts that only `make check`, `make book` or a person runs. They live under
 * scripts/, which is stamped as a whole because the e2e recipe calls seven of them, so
 * the exceptions are named here rather than the rule being weakened.
 */
export const NOT_STAMPED_SCRIPTS: ReadonlyArray<readonly [string, string]> = [
	['scripts/tree-hash.ts', 'this file: stamping the stamper invalidates every stamp on every edit'],
	['scripts/rubric.ts', 'the scorecard, which reads results rather than producing them'],
	['scripts/score.ts', 'the scorer, same'],
	['scripts/junit.ts', 'how the scorer reads results'],
	['scripts/mutations.ts', 'the deliberate breakages `make prove` applies'],
	['scripts/prove-gates.ts', 'the prover that applies them'],
	['scripts/check-prose.ts', 'a `make check` step'],
	['scripts/prose-rules.json', 'the word lists that step reads'],
	['scripts/check-links.ts', 'a scheduled CI job'],
	['scripts/book.ts', 'what each PDF is built from'],
	['scripts/build-book.ts', 'renders the PDFs'],
	['scripts/contents.ts', 'generates the contents of a teaching page'],
	['scripts/diagram.mjs', 'draws the figures on the teaching pages'],
	['scripts/diagram.d.mts', 'the types tests read scripts/diagram.mjs through'],
	['scripts/highlight.mjs', 'colours the code blocks on the teaching pages'],
	['scripts/highlight.d.mts', 'the types tests read scripts/highlight.mjs through'],
	['scripts/tokens.ts', 'reads the brand tokens'],
	['scripts/build-tokens.ts', 'writes design/tokens.css'],
	['scripts/pdf-freshness.json', 'what the PDFs were built from'],
	['scripts/status.ts', 'counts what exists against the manifest'],
]

/**
 * The Makefile is the one file with mixed concerns: the same file carries the command
 * that runs the harness against a real repository and the command that prints a PDF.
 * Hashing all of it made an unrelated target cost a rerun, so only the recipe an
 * end-to-end run executes is stamped.
 */
export const E2E_RECIPES = ['e2e'] as const

export function trackedFiles(): string[] {
	const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
		cwd: ROOT,
		encoding: 'utf8',
	})
	// git lists a file it still tracks after it is deleted on disk. Every caller
	// wants the files that are actually here, and reading one that is not is how
	// an ordinary rename turned into a crash in three separate scripts.
	return out
		.split('\n')
		.filter(Boolean)
		.filter((file) => existsSync(join(ROOT, file)))
		.sort()
}

const matches = (file: string, prefix: string): boolean => file === prefix || file.startsWith(prefix)

/** Whether an end-to-end run loads this file. The Makefile is handled separately. */
export function isStamped(file: string): boolean {
	if (file === 'Makefile') return false
	if (NOT_STAMPED_SCRIPTS.some(([prefix]) => matches(file, prefix))) return false
	return STAMPED.some(([prefix]) => matches(file, prefix))
}

/** Tracked files neither list claims. A test fails on anything in here. */
export function unclassified(files: string[]): string[] {
	const known = [...STAMPED, ...NOT_STAMPED, ...NOT_STAMPED_SCRIPTS].map(([prefix]) => prefix)
	return files.filter(
		(file) =>
			file !== 'Makefile' &&
			!/\.(md|pdf)$/.test(file) &&
			!known.some((prefix) => matches(file, prefix)),
	)
}

/** The recipes `make e2e` runs, plus the variables above them, and nothing else. */
export function makefileSlice(): string {
	const text = readFileSync(join(ROOT, 'Makefile'), 'utf8')
	const head = text.split(/^[a-z][a-z0-9-]*:/m)[0] ?? ''
	const blocks = [head]
	for (const target of E2E_RECIPES) {
		// The end of the recipe is the next target, or the end of the file. `$` in
		// multiline mode is the end of a LINE, which cut every recipe to its first
		// line and left a stamp that looked healthy while covering one heading.
		const found = new RegExp(`^${target}:[\\s\\S]*?(?=^[a-zA-Z0-9_./-]+:|$(?![\\s\\S]))`, 'm').exec(text)
		if (found === null) {
			throw new Error(`Makefile has no ${target} target, so the stamp would silently cover less than it claims`)
		}
		blocks.push(found[0])
	}
	return blocks.join('')
}

export function treeHash(includeProse: boolean): string {
	const hash = createHash('sha256')
	const files = trackedFiles().filter((file) =>
		includeProse ? !file.startsWith('artifacts/') : isStamped(file),
	)
	for (const file of files) {
		hash.update(file)
		hash.update('\0')
		hash.update(readFileSync(join(ROOT, file)))
		hash.update('\0')
	}
	// Included whole for the check stamp, by recipe for the e2e stamp.
	hash.update('Makefile')
	hash.update(includeProse ? readFileSync(join(ROOT, 'Makefile')) : makefileSlice())
	return hash.digest('hex')
}

if (process.argv[1] === import.meta.filename) {
	process.stdout.write(treeHash(process.argv.includes('--all')))
}
