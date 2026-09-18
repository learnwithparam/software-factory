/**
 * The scorecard. Every point is bound to one test that already exists.
 *
 * A `unit` id is `<file relative to the repository root> > <full test name>`.
 * A `pw` id is `<spec file name> > <test title>` from Playwright.
 *
 * tests/gate.test.ts fails when an id here names a test that does not exist, and
 * again when a scored check has no deliberate break behind it in mutations.ts.
 * Adding a point therefore forces adding both the test and its proof.
 */

export type Source = 'unit' | 'pw'

export interface Check {
	readonly source: Source
	readonly id: string
	readonly points: number
}

const unit = (id: string, points: number): Check => ({ source: 'unit', id, points })

export const PHASES: Record<string, readonly Check[]> = {
	'1 Gate': [
		unit('tests/gate.test.ts > every make target the docs name exists', 1),
		unit('tests/gate.test.ts > CI runs make check', 2),
		unit('tests/gate.test.ts > every scored check exists', 2),
		unit('tests/gate.test.ts > every scored check has a proof that it fails', 2),
		unit('tests/gate.test.ts > the scorecard never declares more points than the total', 1),
		unit('tests/gate.test.ts > CI stops tolerating unbound points once every point is bound', 1),
		unit('tests/gate.test.ts > the prose check is wired into make check', 1),
		unit('tests/gate.test.ts > the tree stamp excludes prose and includes code', 1),
	],
	'2 Design system': [
		unit('tests/design.test.ts > every declared contrast pair reaches the level it claims', 2),
		unit('tests/design.test.ts > every text and state colour has a contrast pair', 1),
		unit('tests/design.test.ts > every generated stylesheet matches the token source', 2),
		unit('tests/design.test.ts > the accent colour is never claimed as body text', 1),
	],
	'3 Teach surfaces': [
		unit('tests/teach.test.ts > every session has exactly one run sheet', 2),
		unit('tests/teach.test.ts > every concept a run sheet cites is declared by the spine', 2),
		unit('tests/teach.test.ts > every concept the spine declares is taught by a session', 2),
		unit('tests/teach.test.ts > every run sheet segment is complete', 1),
		unit('tests/teach.test.ts > every command and file a teach surface names exists', 2),
		unit('tests/teach.test.ts > no prose is duplicated across teach surfaces', 1),
	],
	'4 Reading a repository': [
		unit('tests/repo.test.ts > a repository is described entirely by its own .factory directory', 1),
		unit('tests/repo.test.ts > a repository with no .factory is refused rather than given defaults', 1),
		unit('tests/repo.test.ts > a charter that cannot be parsed refuses everything rather than permitting it', 2),
		unit('tests/repo.test.ts > every protected path carries the reason it is protected', 1),
		unit('tests/repo.test.ts > a path no target claims has no owner, rather than a guessed one', 1),
		unit('tests/repo.test.ts > every file in the repository is claimed by exactly one target', 1),
		unit('tests/repo.test.ts > a change to a shared target reaches everything built on it', 1),
		unit('tests/repo.test.ts > a repository skill replaces a shipped one of the same name', 1),
	],
	'5 Boundary': [
		unit('tests/boundary.test.ts > a task on a protected path is refused before any file is touched', 2),
		unit('tests/boundary.test.ts > a task spanning two targets takes the stricter autonomy', 2),
		unit('tests/boundary.test.ts > a target that only has to be rechecked does not change the task kind', 1),
		unit('tests/boundary.test.ts > a path no target owns is refused rather than guessed at', 1),
		unit('tests/boundary.test.ts > a task that names no path is refused, because nothing can assess it', 1),
		unit('tests/boundary.test.ts > the review queue cap stops production when it is full', 2),
	],
	'6 Execution': [
		unit('tests/execution.test.ts > a branch name is derived from the item, never generated', 1),
		unit('tests/execution.test.ts > a task gets a workspace and the repository is left exactly as it was', 2),
		unit('tests/execution.test.ts > the workspace lives outside the repository being changed', 1),
		unit('tests/execution.test.ts > creating the same workspace twice resumes instead of failing', 1),
		unit('tests/execution.test.ts > removing a workspace leaves nothing behind', 1),
		unit('tests/execution.test.ts > two runs on one item, and only the first push wins', 2),
		unit('tests/execution.test.ts > a write that climbs out of the workspace is refused on the resolved path', 1),
		unit('tests/execution.test.ts > a command that is not on the list is refused before it runs', 1),
	],
	'7 Context': [
		unit('tests/context.test.ts > a task is never routed the rules for an area it does not touch', 1),
		unit('tests/context.test.ts > a task is never routed a skill that does not apply to it', 1),
		unit('tests/context.test.ts > a task is routed the checks of every target its change reaches', 2),
		unit('tests/context.test.ts > what was withheld is recorded beside what was included', 1),
		unit('tests/context.test.ts > two different tasks in one repository receive different material', 1),
	],
	'8 Verification': [
		unit('tests/verification.test.ts > the gate runs the commands the repository declares and passes', 2),
		unit('tests/verification.test.ts > a missing test command is misconfigured, which is neither a pass nor a failure', 2),
		unit('tests/verification.test.ts > a path no target owns is misconfigured rather than quietly skipped', 1),
		unit('tests/verification.test.ts > a pass with no reverted proof is downgraded', 2),
		unit('tests/verification.test.ts > a test that stayed green while its subject was broken fails the run', 1),
		unit('tests/verification.test.ts > a quoted gate line that does not match the real one is downgraded', 1),
		unit('tests/verification.test.ts > weakening an existing assertion is caught as a property of the diff', 2),
	],
	'9 Self-healing': [
		unit('tests/loop.test.ts > the second attempt is given the first attempt failure', 2),
		unit('tests/loop.test.ts > attempts are bounded, and running out is a result rather than a fault', 1),
		unit('tests/loop.test.ts > a stage past its budget stops the run before the attempts are used up', 1),
		unit('tests/loop.test.ts > human wait is recorded and never bounded', 1),
	],
	'10 Delivery': [
		unit('tests/delivery.test.ts > an allowed item runs every stage in order and ends in a draft pull request', 1),
		unit('tests/delivery.test.ts > a protected item is refused before any stage runs at all', 2),
		unit('tests/delivery.test.ts > every verdict in the record is the line its source wrote, never a summary', 1),
		unit('tests/delivery.test.ts > the record names which repository the run worked on', 1),
		unit('tests/delivery.test.ts > the pull request body carries the evidence a reviewer needs', 1),
		unit('tests/delivery.test.ts > a missing recording is an error rather than an empty answer', 1),
	],
	'11 Platform mapping': [
		unit('tests/platform.test.ts > every layer built by hand is mapped onto the platform', 1),
		unit('tests/platform.test.ts > every file the mapping cites still exists', 1),
		unit('tests/platform.test.ts > the rule that nothing merges itself is stated on both substrates', 1),
	],
	'12 Example repository': [
		unit('tests/example-repo.test.ts > claims every file it contains', 1),
		unit('tests/example-repo.test.ts > gives every target a test command and a reason for its autonomy', 1),
		unit('tests/example-repo.test.ts > protects the files that decide what every other rule means', 2),
		unit('tests/example-repo.test.ts > carries a work item of every shape a session needs', 2),
		unit('tests/example-repo.test.ts > has at least one item whose change reaches more than one target', 1),
		unit('tests/example-repo.test.ts > passes its own gate for a change to a target the factory may build', 2),
	],
	'13 Evidence': [
		unit('tests/screenshot-guard.test.ts > is refused when the interface says it is loading', 1),
		unit('tests/review-page.test.ts > accounts for every screenshot the manifest names', 1),
		unit('tests/figures.test.ts > shows exactly what the record says', 1),
		// The page may not drop a finding that reflects badly on the product. Worth a
		// point taken from file ownership, because a surface that hides a measured
		// failure is a worse fault than an example repository missing an owner line.
		unit('tests/findings.test.ts > that did not hold on some run, appears on the page', 1),
	],
}

export const TOTAL_POINTS = 100

export function allChecks(): Check[] {
	return Object.values(PHASES).flat()
}

export function declaredPoints(): number {
	return allChecks().reduce((sum, check) => sum + check.points, 0)
}
