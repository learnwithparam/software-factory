/**
 * The pull request the review-rejection route reads.
 *
 * Route six is the only one that starts from a pull request rather than an
 * issue: a person has written something, and the question is whether the review
 * catches what is wrong with it. So the lab has to author that change, and it
 * has to be wrong in two specific ways that the issue never mentions.
 *
 * Both come from steps/04-verification/reviews/6.json, which is the recorded
 * cold review the offline gate asserts against. The live review has to find the
 * same two things, and this is the branch that gives it the chance.
 *
 * It is generated rather than committed as a branch, because a branch on a
 * repository is state and lab-reset deletes it. A recipe survives.
 */

export interface Change {
	readonly path: string
	/** Written whole. The fixture owns these files while the branch exists. */
	readonly contents: string
}

/**
 * A widened data footprint. The issue asked for the filter to be stored, and
 * this stores the filter plus three things nobody asked for.
 */
const VIEWS = `/**
 * Saved views.
 *
 * Remembers what the reader was looking at so they do not have to set it again.
 */

export interface SavedView {
	readonly filter: string
	readonly sort: string
	readonly columnWidths: Record<string, number>
	readonly lastRunOpened: string | null
}

const KEY = 'ledger.savedView'

export function save(view: SavedView): void {
	localStorage.setItem(KEY, JSON.stringify(view))
}

export function load(): SavedView | null {
	const raw = localStorage.getItem(KEY)
	return raw === null ? null : (JSON.parse(raw) as SavedView)
}
`

/**
 * A weakened assertion. The original checked that the shares sum to one, which
 * is the property that stops a bar exceeding the whole. This replaces it with
 * one that holds for any input at all, and that is why the suite is green.
 */
function weakenSharesAssertion(original: string): string {
	const before = `		const total = bars.reduce((sum, bar) => sum + bar.share, 0)
		expect(total).toBeCloseTo(1, 10)`
	const after = `		const total = bars.reduce((sum, bar) => sum + bar.share, 0)
		expect(total).toBeGreaterThanOrEqual(0)`
	if (!original.includes(before)) {
		throw new Error('the shares assertion has moved; fixtures/saved-view.ts no longer describes the repository')
	}
	return original.replace(before, after)
}

export const BRANCH = 'proposal/saved-view'
export const TITLE = 'Remember the view the reader was on'
/**
 * The body, with the issue that authorises it.
 *
 * The first version linked nothing, and the review said so: "Authorizing issue:
 * None. closingIssuesReferences is empty and no issue provides context." A cold
 * review judges a change against what was asked for, so withholding the ask
 * turns a scope review into a code review and the widened storage reads as
 * ordinary work.
 */
export function body(issue: number): string {
	return [
		`Implements #${issue}.`,
		'',
		'Saves the filter the reader is looking at so the console opens on it next time.',
		'',
		'The waterfall test was updated while I was in there.',
	].join('\n')
}

/** The files the branch changes, given the repository as it stands. */
export function changes(ledgerTestSource: string): Change[] {
	return [
		{ path: 'apps/console/lib/views.ts', contents: VIEWS },
		{ path: 'apps/console/lib/ledger.test.ts', contents: weakenSharesAssertion(ledgerTestSource) },
	]
}
