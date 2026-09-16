/**
 * One deliberate break per scored check, so every gate can be shown to fail.
 *
 * `make prove` copies the repository to a scratch directory, applies each
 * mutation there, and asserts the named test goes red. A gate nobody has seen
 * fail is not a gate, and this is what stops that from being a promise in a
 * markdown file. tests/gate.test.ts fails when a scored unit check has no entry
 * here, so adding a point to the rubric forces adding its proof.
 */

export interface Mutation {
	/** Path relative to the repository root. */
	readonly file: string
	/** Exact text or pattern to replace. Must occur in the file. */
	readonly find: string
	/** What to put in its place. */
	readonly replace: string
	/** Why this break should make the named test fail. */
	readonly because: string
}

export const MUTATIONS: Record<string, Mutation> = {
	'tests/gate.test.ts > every make target the docs name exists': {
		file: 'Makefile',
		find: 'demo: ##',
		replace: 'demo-run: ##',
		because: 'the demo target the rest of the repository names is gone',
	},
	'tests/gate.test.ts > CI runs make check': {
		file: '.github/workflows/check.yml',
		find: '      - run: make check',
		replace: '      - run: echo skipping',
		because: 'CI stops running the gate it exists to run',
	},
	'tests/gate.test.ts > every scored check exists': {
		file: 'scripts/rubric.ts',
		find: "\t'1 Gate': [",
		replace: "\t'1 Gate': [\n\t\tunit('tests/gate.test.ts > a test nobody wrote', 0),",
		because: 'the scorecard names a test that does not exist',
	},
	'tests/gate.test.ts > every scored check has a proof that it fails': {
		file: 'scripts/mutations.ts',
		find: "'tests/gate.test.ts > CI runs make check': {",
		replace: "'tests/gate.test.ts > CI runs something else': {",
		because: 'a scored check is left with no deliberate break behind it',
	},
	'tests/gate.test.ts > the prose check is wired into make check': {
		file: 'Makefile',
		find: '\tnode scripts/check-prose.ts\n',
		replace: '',
		because: 'the prose rule stops being run by anything',
	},
	'tests/gate.test.ts > the tree stamp excludes prose and includes code': {
		file: 'scripts/tree-hash.ts',
		find: 'const PROSE = /\\.(md|html)$/',
		replace: 'const PROSE = /^$/',
		because: 'the two stamps stop differing, so any e2e result looks fresh',
	},
	// A mutation only has to make its own test fail. Some also trip a neighbour,
	// which is fine: a palette claim that is false is false in more than one way.
	'tests/design.test.ts > every declared contrast pair reaches the level it claims': {
		file: 'design/tokens.json',
		find: '{ "fg": "wait", "bg": "bg", "level": "AA" }',
		replace: '{ "fg": "wait", "bg": "bg", "level": "AAA" }',
		because: 'a colour claims a level its ratio does not reach',
	},
	'tests/design.test.ts > every text and state colour has a contrast pair': {
		file: 'design/tokens.json',
		find: '{ "fg": "refuse", "bg": "bg", "level": "AA" },\n      ',
		replace: '',
		because: 'a colour that renders words has no pair checking it',
	},
	'tests/design.test.ts > every generated stylesheet matches the token source': {
		file: 'teach/tokens.css',
		find: '\t--c-accent:',
		replace: '\t--c-accent-edited-by-hand: #000;\n\t--c-accent:',
		because: 'a generated stylesheet is edited by hand and drifts from its source',
	},
	'tests/design.test.ts > the accent colour is never claimed as body text': {
		file: 'design/tokens.json',
		find: '{ "fg": "accent", "bg": "bg", "level": "AA-large" }',
		replace: '{ "fg": "accent", "bg": "bg", "level": "AA" }',
		because: 'the palette claims a large-text-only colour is safe for body text',
	},
}
