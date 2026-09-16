/**
 * The scorecard. Every point is bound to one test that already exists.
 *
 * A `unit` id is `<file relative to the repo root> > <full test name>` from vitest.
 * A `pw` id is `<spec file name> > <test title>` from Playwright.
 * tests/gate.test.ts fails when an id here names a test that does not exist, so a
 * point cannot be awarded by a check nobody wrote.
 *
 * Phases land in build order. A phase whose work has not started carries its
 * points and scores zero, which is why the score is honest before it is high.
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
		unit('tests/gate.test.ts > every make target the docs name exists', 2),
		unit('tests/gate.test.ts > CI runs make check', 2),
		unit('tests/gate.test.ts > every scored check exists', 2),
		unit('tests/gate.test.ts > every scored check has a proof that it fails', 3),
		unit('tests/gate.test.ts > the prose check is wired into make check', 1),
		unit('tests/gate.test.ts > the tree stamp excludes prose and includes code', 2),
	],
	'2 Design system': [
		unit('tests/design.test.ts > every declared contrast pair reaches the level it claims', 3),
		unit('tests/design.test.ts > every text and state colour has a contrast pair', 2),
		unit('tests/design.test.ts > every generated stylesheet matches the token source', 2),
		unit('tests/design.test.ts > the accent colour is never claimed as body text', 1),
	],
}

export const TOTAL_POINTS = 100

export function allChecks(): Check[] {
	return Object.values(PHASES).flat()
}

export function declaredPoints(): number {
	return allChecks().reduce((sum, check) => sum + check.points, 0)
}
