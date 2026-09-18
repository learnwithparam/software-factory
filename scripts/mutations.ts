/**
 * One deliberate break per scored check, so every gate can be shown to fail.
 *
 * `make prove` copies the repository to a scratch directory, applies each
 * mutation there, and asserts the named test goes red. A gate nobody has seen
 * fail is not a gate, and this is what stops that being a promise in a markdown
 * file. tests/gate.test.ts fails when a scored check has no entry here, so
 * adding a point forces adding its proof.
 *
 * A mutation only has to make its own test fail. Some also trip a neighbour,
 * which is fine: a claim that is false is usually false in more than one way.
 */

export interface Edit {
	/** Path relative to the repository root, or `example:` inside the example. */
	readonly file: string
	/** Exact text to replace. Must occur in the file. */
	readonly find: string
	/** What to put in its place. */
	readonly replace: string
}

export interface Mutation extends Partial<Edit> {
	/**
	 * More than one edit, for a claim defended in more than one place.
	 *
	 * Some rules are deliberately enforced twice, so breaking one leaves the
	 * other holding. Proving such a check means removing every defence, and
	 * saying so here is more honest than weakening the code until one edit is
	 * enough.
	 */
	readonly edits?: readonly Edit[]
	/** Why this break should make the named test fail. */
	readonly because: string
}

/** Every edit a mutation applies, whether it declared one or several. */
export function editsOf(mutation: Mutation): Edit[] {
	if (mutation.edits !== undefined) return [...mutation.edits]
	const { file, find, replace } = mutation
	if (file === undefined || find === undefined || replace === undefined) {
		throw new Error('a mutation needs either file/find/replace or a list of edits')
	}
	return [{ file, find, replace }]
}

const CHARTER = 'tests/fixtures/sample/.factory/charter.md'
const TARGETS = 'tests/fixtures/sample/.factory/targets.json'

export const MUTATIONS: Record<string, Mutation> = {
	// 1 Gate
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
	'tests/gate.test.ts > the scorecard never declares more points than the total': {
		file: 'scripts/rubric.ts',
		find: 'export const TOTAL_POINTS = 100',
		replace: 'export const TOTAL_POINTS = 10',
		because: 'the scorecard can award more points than its own maximum',
	},
	'tests/gate.test.ts > CI stops tolerating unbound points once every point is bound': {
		file: '.github/workflows/check.yml',
		find: '      - run: make score\n',
		replace: '      - run: make score SCORE_ARGS=--allow-unbound\n',
		// This mutation had to be turned around the day the last point was bound.
		// While phases were missing, the break was taking the flag away; now that
		// every point is bound, the break is putting it back, because the
		// permission it grants has become a hole rather than an allowance.
		because: 'CI goes back to tolerating an unbound point, which now means a mistake rather than a phase nobody has built',
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

	// 2 Design system
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

	// 3 Teach surfaces
	'tests/teach.test.ts > every session has exactly one run sheet': {
		file: 'teach/sessions.json',
		find: '"sessions": [',
		replace:
			'"sessions": [\n    { "key": "ghost", "kind": "lesson", "title": "Unwritten", "minutes": 60, "covers": [], "steps": [] },',
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
		find: 'data-file="steps/01-boundary/policy.ts"',
		replace: 'data-file="steps/01-boundary/rules.ts"',
		because: 'a run sheet sends the facilitator to a file that is not there',
	},
	'tests/teach.test.ts > no prose is duplicated across teach surfaces': {
		file: 'teach/office-hours.html',
		find: '<p>Contributes one line each',
		replace:
			'<p>Boundary says what may be attempted. Context says what the task gets to know. Contributes one line each',
		because: 'an explanation is restated in a run sheet instead of being pointed at',
	},
	'tests/teach.test.ts > no surface states how many issues or items there are': {
		file: 'profiles/README.md',
		find: 'The same issues, the same factory',
		replace: 'The same six issues, the same factory',
		because: 'a count the repository can grow is written into teaching copy, where it goes stale in silence',
	},

	// 4 Reading a repository
	'tests/repo.test.ts > a repository is described entirely by its own .factory directory': {
		file: CHARTER,
		find: '`TIER: supervised`',
		replace: 'TIER is whatever feels right',
		because: 'the charter stops declaring the one field every decision reads',
	},
	'tests/repo.test.ts > a repository with no .factory is refused rather than given defaults': {
		file: 'steps/lib/repo.ts',
		find: '	return {\n\t\troot,\n\t\tcharter: readCharter(root),',
		replace:
			"	if (!isConfigured(root)) {\n\t\treturn { root, charter: { tier: 'permissive', reviewQueueCap: 99, protectedPaths: [] }, targets: [], skills: [] }\n\t}\n\treturn {\n\t\troot,\n\t\tcharter: readCharter(root),",
		because: 'an unconfigured repository is handed a policy nobody chose',
	},
	'tests/repo.test.ts > a charter that cannot be parsed refuses everything rather than permitting it': {
		file: 'steps/lib/repo.ts',
		find: "	if (block === undefined) throw new NotConfigured(root, 'the charter declares no protected block')",
		replace: '	if (block === undefined) return { tier, reviewQueueCap: Number(cap), protectedPaths: [] }',
		because: 'a charter missing its protected list protects nothing instead of refusing',
	},
	'tests/repo.test.ts > every protected path carries the reason it is protected': {
		file: CHARTER,
		find: 'secrets/**            # credentials, and nothing an agent does here is recoverable',
		replace: 'secrets/**            # x',
		because: 'a path is protected without saying why',
	},
	'tests/repo.test.ts > a path no target claims has no owner, rather than a guessed one': {
		file: 'steps/lib/repo.ts',
		find: '	return best?.target',
		replace: '	return best?.target ?? targets[0]',
		because: 'an unclaimed path is silently handed to whichever target happens to be first',
	},
	'tests/repo.test.ts > every file in the repository is claimed by exactly one target': {
		file: TARGETS,
		find: '"paths": [".factory/**", "README.md"]',
		replace: '"paths": [".factory/**"]',
		because: 'a file in the repository is left with no owner',
	},
	'tests/repo.test.ts > a change to a shared target reaches everything built on it': {
		file: TARGETS,
		find: '"dependsOn": ["lib"]',
		replace: '"dependsOn": []',
		because: 'a dependency edge is dropped, so one suite runs and the break ships',
	},
	'tests/repo.test.ts > a repository skill replaces a shipped one of the same name': {
		file: 'steps/lib/repo.ts',
		find: "	const repo = readSkillsFrom(join(root, FACTORY_DIR, 'skills'), 'repo')",
		replace: '	const repo: Skill[] = []',
		because: 'the repository stops being read for skills, so only shipped ones apply',
	},

	// 5 Boundary
	'tests/boundary.test.ts > a task on a protected path is refused before any file is touched': {
		file: CHARTER,
		find: 'secrets/**            #',
		replace: 'secrets-elsewhere/**  #',
		because: 'the protected glob stops matching the path it exists to protect',
	},
	'tests/boundary.test.ts > a task spanning two targets takes the stricter autonomy': {
		file: 'steps/01-boundary/policy.ts',
		find: '		STRICTNESS[target.autonomy] > STRICTNESS[worst.autonomy] ? target : worst,',
		replace: '		STRICTNESS[target.autonomy] < STRICTNESS[worst.autonomy] ? target : worst,',
		because: 'the most permissive target wins instead of the strictest',
	},
	'tests/boundary.test.ts > a target that only has to be rechecked does not change the task kind': {
		file: 'steps/01-boundary/policy.ts',
		find: '		const owner = ownerOf(path, repo.targets)\n\t\tif (owner !== undefined && !written.includes(owner)) written.push(owner)',
		replace: '		for (const owner of affected([path], repo.targets)) if (!written.includes(owner)) written.push(owner)',
		because: 'a target that only has to be rechecked starts governing the task',
	},
	'tests/boundary.test.ts > a path no target owns is refused rather than guessed at': {
		file: 'steps/01-boundary/policy.ts',
		find: '	const orphan = unowned(task.paths, repo.targets)[0]',
		replace: '	const orphan = undefined as string | undefined',
		because: 'an unowned path proceeds with no checks and no autonomy rule',
	},
	'tests/boundary.test.ts > a task that names no path is refused, because nothing can assess it': {
		file: 'steps/01-boundary/policy.ts',
		find: '	if (task.paths.length === 0) {',
		replace: '	if (false) {',
		because: 'a task naming no paths is assessed against nothing and allowed',
	},
	'tests/boundary.test.ts > the review queue cap stops production when it is full': {
		file: 'steps/01-boundary/policy.ts',
		find: '	if (awaitingReview >= cap) {',
		replace: '	if (awaitingReview > cap * 100) {',
		because: 'the cap stops binding, so production continues past review capacity',
	},

	// 6 Execution
	'tests/execution.test.ts > a branch name is derived from the item, never generated': {
		file: 'steps/02-execution/worktree.ts',
		find: '	return `fq-${slug}`',
		replace: '	return `fq-${slug}-${Math.random().toString(36).slice(2, 6)}`',
		because: 'two runs on one item compute different names, so neither can lose the race',
	},
	'tests/execution.test.ts > a task gets a workspace and the repository is left exactly as it was': {
		file: 'steps/02-execution/worktree.ts',
		find: "	mkdirSync(join(WORKTREES, basename(repo)), { recursive: true })",
		replace: "	mkdirSync(join(WORKTREES, basename(repo)), { recursive: true })\n\tBun.write(join(repo, 'factory-was-here.txt'), 'oops')",
		because: 'the harness leaves something behind in the repository it is changing',
	},
	'tests/execution.test.ts > the workspace lives outside the repository being changed': {
		file: 'steps/02-execution/worktree.ts',
		find: "	return { item: String(item), branch, repo, path: join(WORKTREES, basename(repo), branch) }",
		replace: "	return { item: String(item), branch, repo, path: join(repo, '.worktrees', branch) }",
		because: 'workspaces are scattered through the project being worked on',
	},
	'tests/execution.test.ts > creating the same workspace twice resumes instead of failing': {
		file: 'steps/02-execution/worktree.ts',
		find: '	if (existsSync(workspace.path)) return workspace',
		replace: "	if (existsSync(workspace.path)) throw new Error('already exists')",
		because: 'a retried delivery cannot resume the work it already started',
	},
	'tests/execution.test.ts > removing a workspace leaves nothing behind': {
		file: 'steps/02-execution/worktree.ts',
		find: "	if (existsSync(workspace.path)) git(['worktree', 'remove', '--force', workspace.path], repo)",
		replace: '	if (false) void 0',
		because: 'cleanup stops happening, so every run leaves a directory behind',
	},
	'tests/execution.test.ts > two runs on one item, and only the first push wins': {
		file: 'steps/02-execution/claim.ts',
		find: "		git(['push', remote, `refs/heads/${branch}:refs/heads/${branch}`], cwd)",
		replace: "		git(['push', '--force', remote, `refs/heads/${branch}:refs/heads/${branch}`], cwd)",
		because: 'the push is forced, so both runs believe they own the item',
	},
	'tests/execution.test.ts > a write that climbs out of the workspace is refused on the resolved path': {
		file: 'steps/02-execution/limits.ts',
		find: '	const absolute = resolve(workspace, path)\n\tconst inside = relative(workspace, absolute)',
		replace: '	const inside = path',
		because: 'the path is checked as written, so parent segments walk straight out',
	},
	'tests/execution.test.ts > a command that is not on the list is refused before it runs': {
		file: 'steps/02-execution/limits.ts',
		find: '	if (!limits.commands.includes(program)) {',
		replace: '	if (false) {',
		because: 'any command may run, whatever the profile says',
	},

	// 7 Context
	'tests/context.test.ts > a task is never routed the rules for an area it does not touch': {
		file: 'steps/03-context/router.ts',
		find: '		const relevant = issue.paths.some((path) => matcher(entry.glob)(path))',
		replace: '		const relevant = true',
		because: 'every rule is piled onto every task again',
	},
	'tests/context.test.ts > a task is never routed a skill that does not apply to it': {
		file: 'steps/03-context/router.ts',
		find: "		const applies = skill.when === '**' || issue.paths.some((path) => matcher(skill.when)(path))",
		replace: '		const applies = true',
		because: 'a task receives procedures that have nothing to do with it',
	},
	'tests/context.test.ts > a task is routed the checks of every target its change reaches': {
		file: 'steps/03-context/router.ts',
		find: '	const commands: Command[] = reached.flatMap((target) =>',
		replace: '	const commands: Command[] = reached.slice(0, 1).flatMap((target) =>',
		because: 'a task is told about one suite when its change reaches several',
	},
	'tests/context.test.ts > what was withheld is recorded beside what was included': {
		file: 'steps/03-context/router.ts',
		find: '	return { issue, rules, skills, commands, withheld }',
		replace: '	return { issue, rules, skills, commands, withheld: [] }',
		because: 'nothing records what the router left out, so the claim is unverifiable',
	},
	'tests/context.test.ts > two different tasks in one repository receive different material': {
		file: 'steps/03-context/router.ts',
		find: 'export function render(context: Context): string {',
		replace:
			"export function render(_context: Context): string {\n\treturn 'do the task'\n}\n\nfunction renderProperly(context: Context): string {",
		because: 'every task receives the same text, which is piling by another name',
	},

	// 8 Verification
	'tests/verification.test.ts > the gate runs the commands the repository declares and passes': {
		file: 'steps/04-verification/gate.ts',
		find: "			const spawned = Bun.spawnSync(['bash', '-lc', command], {",
		replace: "			const spawned = Bun.spawnSync(['bash', '-lc', 'exit 1'], {",
		because: 'the gate stops running the commands the repository declared',
	},
	'tests/verification.test.ts > a missing test command is misconfigured, which is neither a pass nor a failure': {
		file: 'steps/04-verification/gate.ts',
		find: '	if (!ranATest) {',
		replace: '	if (false) {',
		because: 'a run with no test command reports a pass',
	},
	'tests/verification.test.ts > a path no target owns is misconfigured rather than quietly skipped': {
		file: 'steps/04-verification/gate.ts',
		find: '	if (orphan !== undefined) {',
		replace: '	if (false) {',
		because: 'an unowned path is checked by nothing and reported as fine',
	},
	'tests/verification.test.ts > a pass with no reverted proof is downgraded': {
		file: 'steps/04-verification/verifier.ts',
		find: '	if (evidence.negativeProof === undefined) {',
		replace: '	if (false) {',
		because: 'a pass is accepted with no test shown to fail without the change',
	},
	'tests/verification.test.ts > a test that stayed green while its subject was broken fails the run': {
		file: 'steps/04-verification/verifier.ts',
		find: '	} else if (!evidence.negativeProof.redWithoutChange) {',
		replace: '	} else if (false) {',
		because: 'a test that proves nothing is treated as if it proved something',
	},
	'tests/verification.test.ts > a quoted gate line that does not match the real one is downgraded': {
		file: 'steps/04-verification/verifier.ts',
		find: '	if (claimed.gateLine.trim() !== evidence.gateLine.trim()) {',
		replace: '	if (false) {',
		because: 'a paraphrase of the verdict is accepted in place of the verdict',
	},
	'tests/verification.test.ts > weakening an existing assertion is caught as a property of the diff': {
		file: 'steps/04-verification/verifier.ts',
		find: '		if (file !== \'\' && TEST_PATTERN.test(file) && removed > added) {',
		replace: '		if (false) {',
		because: 'a suite edited into passing goes unnoticed',
	},

	// 9 Self-healing
	'tests/loop.test.ts > the second attempt is given the first attempt failure': {
		file: 'steps/05-loop/loop.ts',
		find: '		previous = attempt.failure',
		replace: '		previous = undefined',
		because: 'the next attempt starts from nothing and repeats the same mistake',
	},
	'tests/loop.test.ts > attempts are bounded, and running out is a result rather than a fault': {
		file: 'steps/05-loop/loop.ts',
		find: '	for (let number = 1; number <= budget.attempts.max; number += 1) {',
		replace: '	for (let number = 1; number <= budget.attempts.max + 5; number += 1) {',
		because: 'the attempt limit stops binding, so a hopeless item keeps spending',
	},
	'tests/loop.test.ts > a stage past its budget stops the run before the attempts are used up': {
		file: 'steps/05-loop/loop.ts',
		find: '		const blown = attempt.stages.find((stage) => stage.overBudget)',
		replace: '		const blown = undefined',
		because: 'a stage may run forever and nothing notices',
	},
	'tests/loop.test.ts > human wait is recorded and never bounded': {
		file: 'steps/05-loop/loop.ts',
		find: '	return seconds > 0 && ms > seconds * 1000',
		replace: '	return ms > seconds * 1000',
		because: 'waiting on a person is treated as a run that overran',
	},

	// 10 Delivery
	'tests/delivery.test.ts > an allowed item runs every stage in order and ends in a draft pull request': {
		file: 'steps/06-delivery/deliver.ts',
		find: "			pullRequest: { branch: workspace.branch, draft: true },",
		replace: "			pullRequest: { branch: workspace.branch, draft: false },",
		because: 'work a machine produced arrives as if a person stood behind it',
	},
	'tests/delivery.test.ts > a protected item is refused before any stage runs at all': {
		file: 'steps/06-delivery/deliver.ts',
		find: '	const permitted = decide(repo, { id: issue.id, paths: issue.paths })\n\tif (!permitted.allowed) {',
		replace: '	const permitted = decide(repo, { id: issue.id, paths: issue.paths })\n\tif (false) {',
		because: 'boundary is consulted and then ignored',
	},
	'tests/delivery.test.ts > every verdict in the record is the line its source wrote, never a summary': {
		file: 'steps/06-delivery/deliver.ts',
		find: "		verdicts.push({ from: 'gate', line: gate.line })",
		replace: "		verdicts.push({ from: 'gate', line: 'checks looked fine' })",
		because: 'a verdict is summarised instead of quoted',
	},
	'tests/delivery.test.ts > the record names which repository the run worked on': {
		file: 'steps/06-delivery/deliver.ts',
		find: '			repo: repo.root,',
		replace: "			repo: '',",
		because: 'a record no longer says which codebase it describes',
	},
	'tests/delivery.test.ts > the pull request body carries the evidence a reviewer needs': {
		file: 'steps/06-delivery/record.ts',
		find: "		'## Evidence',",
		replace: "		'## Notes',",
		because: 'the reviewer is handed a change with no evidence section at all',
	},
	'tests/delivery.test.ts > a missing recording is an error rather than an empty answer': {
		file: 'steps/lib/executor.ts',
		find: '			if (!existsSync(path)) {',
		replace: '			if (false) {',
		because: 'a missing recording becomes an empty answer, so the loop tests nothing',
	},

	// 11 Platform mapping
	'tests/platform.test.ts > every layer built by hand is mapped onto the platform': {
		file: 'steps/07-mastra/README.md',
		find: '| Verification |',
		replace: '| Checking |',
		because: 'a layer stops being accounted for in the mapping',
	},
	'tests/platform.test.ts > every file the mapping cites still exists': {
		file: 'steps/07-mastra/README.md',
		find: '`steps/03-context/router.ts`',
		replace: '`steps/03-context/routing.ts`',
		because: 'the mapping points at a file that moved',
	},
	'tests/platform.test.ts > the rule that nothing merges itself is stated on both substrates': {
		file: 'steps/07-mastra/src/mastra/boards.ts',
		find: "				reason: 'Merging is never automated. A named engineer approves every change.',",
		replace: "				reason: 'Please do not merge without checking.',",
		because: 'the one rule that never moves is softened on one substrate',
	},

	// 13 Evidence
	'tests/screenshot-guard.test.ts > is refused when the interface says it is loading': {
		file: 'e2e/lib/shot.ts',
		find: 'const STILL_LOADING = [/Loading boards/i, /Loading\\u2026/i, /Loading\\.\\.\\./i]',
		replace: 'const STILL_LOADING: RegExp[] = []',
		because: 'a picture of a spinner becomes admissible evidence again',
	},

	'tests/review-page.test.ts > accounts for every screenshot the manifest names': {
		file: 'review.html',
		find: 'id="factory-intake"',
		replace: 'id="factory-intake-removed"',
		because: 'the review page silently stops listing one of the pictures it is meant to account for',
	},

	'tests/figures.test.ts > shows exactly what the record says': {
		file: 'evidence/factory-run.json',
		find: '"humanWaitLabel"',
		replace: '"humanWaitLabelMoved"',
		because: 'the record stops carrying a figure the page is quoting, so the page is quoting nothing',
	},

	'tests/observations.test.ts > takes everything when a new run is longer than the count it replaces': {
		file: 'scripts/lib/observations.ts',
		find: 'record.countedFirst === lines[0] && ',
		replace: '',
		because: 'a new run is told from an appended one by length alone, so a sequence longer than the running total loses its first readings and the findings table under-reports',
	},
	'tests/observations.test.ts > keeps both sides when a later run behaves differently': {
		file: 'scripts/lib/observations.ts',
		find: '(prior?.missedRuns ?? 0) + (entry.held ? 0 : 1)',
		replace: '(entry.held ? 0 : 1)',
		because: 'a later run that behaves clears the record of the one that did not, which is how a demonstration comes to teach that everything is fine',
	},

	'tests/platform.test.ts > uses no runtime-specific path helper that breaks under Node': {
		file: 'steps/lib/executor.ts',
		find: 'join(import.meta.dirname,',
		replace: 'join(import.meta.dir,',
		because: 'a library file returns to the Bun-only path helper, which is undefined under the Node that runs the Playwright suite',
	},

	'tests/findings.test.ts > that did not hold on some run, appears on the page': {
		edits: [
			{ file: 'teach.html', find: '<tr data-finding="question">\n<td class="k">question</td>\n<td>an underspecified issue', replace: '<tr data-omitted="question">\n<td class="k">question</td>\n<td>an underspecified issue' },
			{ file: 'teach.html', find: '<tr data-finding="question">\n<td class="k">question</td>\n<td>an unanswered question', replace: '<tr data-omitted="question">\n<td class="k">question</td>\n<td>an unanswered question' },
		],
		because: 'the page drops the one finding the record has watched fail on every run it counted, which is the failure mode of anybody writing up their own demonstration',
	},
	'tests/findings.test.ts > is described on the page in the words the run used': {
		file: 'teach.html',
		find: 'an agent changes only paths the ownership graph allows it to change',
		replace: 'an agent behaves itself around the ownership graph',
		because: 'the page softens what was asked for until the finding it recorded no longer says anything',
	},

	// 12 Example repository
	'tests/example-repo.test.ts > claims every file it contains': {
		file: 'example:.factory/targets.json',
		find: '        "LICENSE"\n',
		replace: '',
		because: 'a file in the example repository is left with no owner',
	},
	'tests/example-repo.test.ts > gives every target a test command and a reason for its autonomy': {
		file: 'example:.factory/targets.json',
		find: '"test": "go test ./...",',
		replace: '',
		because: 'a target is left with no way to check it at all',
	},
	'tests/example-repo.test.ts > protects the files that decide what every other rule means': {
		// Protected twice on purpose: once by the charter and once by the target
		// that owns the configuration. Both have to go for the claim to fall.
		edits: [
			{
				file: 'example:.factory/charter.md',
				// The prose names the same file above the block, and a plain string
				// replace takes the first match, so the anchor includes the comment.
				find: '.factory/targets.json     #',
				replace: 'nothing-in-particular     #',
			},
			{
				file: 'example:.factory/targets.json',
				find: '        ".factory/**",\n',
				replace: '',
			},
		],
		because: 'the example stops protecting the graph that defines every other rule',
	},
	'tests/example-repo.test.ts > holds the baseline graph, not one of the four company shapes': {
		file: 'fixtures/ledger-baseline/targets.json',
		find: '"autonomy": "propose"',
		replace: '"autonomy": "build"',
		because: 'the baseline the lab restores no longer matches the example, so a run starts on a graph nobody chose',
	},
	'tests/example-repo.test.ts > carries a work item of every shape a session needs': {
		file: 'example:.factory/targets.json',
		find: '"autonomy": "propose"',
		replace: '"autonomy": "build"',
		because: 'no work item needs a person to accept the plan any more',
	},
	'tests/example-repo.test.ts > has at least one item whose change reaches more than one target': {
		// Both of them. This was one edit and the comment called issue four "the
		// only item that spans several areas", which stopped being true the day the
		// plan-revision issue was added. The mutation still applied, the test still
		// passed, and make prove went to 73 of 74 on a clean clone while passing
		// here. Adding teaching material weakened a proof, quietly.
		edits: [
			{
				file: 'example:.factory/issues/04-tool-calls-total.md',
				find: '  - packages/contracts/schema/run.schema.json\n  - packages/contracts/src/index.ts\n  - services/ingest/run.go\n  - apps/console/app/page.tsx',
				replace: '  - apps/console/app/page.tsx',
			},
			{
				file: 'example:.factory/issues/07-retention-window.md',
				find: '  - services/ingest/store.go\n  - apps/console/app/page.tsx',
				replace: '  - apps/console/app/page.tsx',
			},
		],
		because: 'no item spans more than one area, so nothing in the example needs the graph',
	},
	'tests/example-repo.test.ts > passes its own gate for a change to a target the factory may build': {
		// Broken on the factory side rather than the example's, because this check
		// runs the repository's real build and a copied tree cannot: its bundler
		// refuses a linked node_modules outside the project root, and copying the
		// installed tree would make one proof slower than all the others together.
		file: 'steps/04-verification/gate.ts',
		find: '			const passed = spawned.exitCode === 0',
		replace: '			const passed = false',
		because: 'no check can ever pass, so no repository can clear its own gate',
	},
}
