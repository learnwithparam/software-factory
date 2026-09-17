/**
 * The controls a run sheet may send a presenter to.
 *
 * A click path is written as a list of steps. A step that starts with a capital
 * is a control in the interface and has to exist; a step in lower case is a
 * description for the person following along, like "a card in Building", and is
 * not something a test can look for.
 *
 * That convention was already in the sheets by accident. Writing it down makes
 * it checkable, which matters because these paths were composed by reading the
 * interface rather than driving it, and the first click anything attempted timed
 * out on a button that was not there.
 */

export const NAV = ['Work', 'Review', 'Settings', 'Overview', 'Supervisor', 'Activity', 'Audit log'] as const
export const COLUMNS = ['Intake', 'Triage', 'Planning', 'Building', 'Review', 'Done', 'Canceled'] as const
export const BUTTONS = ['Investigate', 'Open session', 'Build', 'Work'] as const
export const SWITCHES = ['Auto-start runs', 'Auto-approve plans'] as const

/** Everything a sheet may name in capitals. */
export const CONTROLS: readonly string[] = [
	...NAV,
	...COLUMNS,
	...BUTTONS,
	...SWITCHES,
	// Pull request surfaces, which are GitHub's rather than the Factory's.
	'Conversation',
	'Files changed',
	'Commits',
	'Checks',
]

/** A step is a control when it starts with a capital letter. */
export function isControl(step: string): boolean {
	return /^[A-Z]/.test(step.trim())
}
