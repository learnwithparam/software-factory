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
		find: '\tbun scripts/check-prose.ts\n',
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
	'tests/teach.test.ts > every session has exactly one run sheet': {
		file: 'teach/sessions.json',
		find: '"sessions": [',
		replace: '"sessions": [\n    { "key": "ghost", "kind": "lesson", "title": "Unwritten", "minutes": 60, "covers": [], "steps": [] },',
		because: 'a session is scheduled with no run sheet behind it',
	},
	'tests/teach.test.ts > every concept a run sheet cites is declared by the spine': {
		file: 'teach/lesson-2-execution.html',
		find: 'data-concept="worktree"',
		replace: 'data-concept="worktrees-plural"',
		because: 'a run sheet points at an explanation that was never written',
	},
	'tests/teach.test.ts > every concept the spine declares is taught by a session': {
		file: 'teach/sessions.json',
		find: '"evidence-rule", "contract-drift"',
		replace: '"evidence-rule"',
		because: 'an explanation exists that no session is responsible for delivering',
	},
	'tests/teach.test.ts > every run sheet segment is complete': {
		file: 'teach/module-5-loop.html',
		find: '<div class="part ask" data-part="ask"><h3>Ask</h3><p>Which stage would you attack first',
		replace: '<div class="part ask"><h3>Ask</h3><p>Which stage would you attack first',
		because: 'a segment loses the question the facilitator is meant to put to the room',
	},
	'tests/teach.test.ts > every command and file a teach surface names exists': {
		file: 'teach/module-1-boundary.html',
		find: 'data-file="steps/01-boundary/CHARTER.md"',
		replace: 'data-file="steps/01-boundary/POLICY.md"',
		because: 'a run sheet sends the facilitator to a file that is not there',
	},
	'tests/teach.test.ts > no prose is duplicated across teach surfaces': {
		file: 'teach/office-hours.html',
		find: '<p>Contributes one line each',
		replace: '<p>Boundary says what may be attempted. Context says what the task gets to know. Contributes one line each',
		because: 'an explanation is restated in a run sheet instead of being pointed at',
	},
}
