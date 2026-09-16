/**
 * Output for a room, not for a log.
 *
 * Every demo prints through here so the sessions look like one product, and so a
 * verdict is never a bare line of prose an agent could paraphrase. Colour is
 * dropped when the output is not a terminal, which keeps recorded transcripts
 * readable and keeps tests comparing text rather than escape codes.
 */

const ESC = String.fromCharCode(27)
const COLOUR = process.stdout.isTTY && process.env.NO_COLOR === undefined

const code = (open: string) => (text: string) =>
	COLOUR ? `${ESC}[${open}m${text}${ESC}[0m` : text

export const dim = code('2')
export const bold = code('1')
export const green = code('32')
export const red = code('31')
export const yellow = code('33')
export const violet = code('35')
export const cyan = code('36')

const RULE = String.fromCharCode(0x2500)
const ARROW = String.fromCharCode(0x2192)
const TICK = String.fromCharCode(0x2713)
const CROSS = String.fromCharCode(0x2717)
const CIRCLE = String.fromCharCode(0x25cb)
const SLASHED = String.fromCharCode(0x2298)
const DASH = String.fromCharCode(0x2014)

export const EM_DASH = DASH

export function title(text: string): void {
	console.log(`\n${bold(text)}`)
	console.log(dim(RULE.repeat(Math.min(text.length, 72))))
}

export function step(text: string): void {
	console.log(`${dim(ARROW)} ${text}`)
}

export function note(text: string): void {
	console.log(dim(`  ${text}`))
}

export function allowed(text: string): void {
	console.log(`${green(TICK)} ${text}`)
}

export function refused(text: string): void {
	console.log(`${violet(SLASHED)} ${text}`)
}

export function failed(text: string): void {
	console.log(`${red(CROSS)} ${text}`)
}

export function waiting(text: string): void {
	console.log(`${yellow(CIRCLE)} ${text}`)
}

/** A left-aligned table that stays readable at projector width. */
export function table(headers: string[], rows: string[][]): void {
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map((row) => (row[index] ?? '').length)),
	)
	const line = (cells: string[], paint: (text: string) => string) =>
		cells.map((cell, index) => paint(cell.padEnd(widths[index] ?? 0))).join('  ')
	console.log(line(headers, (text) => dim(text.toUpperCase())))
	for (const row of rows) console.log(line(row, (text) => text))
}

export type VerdictState = 'PASS' | 'FAIL' | 'MISCONFIGURED' | 'REFUSED'

/**
 * The one line a verdict is allowed to be.
 *
 * Nothing downstream may restate it. An agent reporting that everything passed
 * is a claim; this line is evidence, and the two are not interchangeable.
 */
export function verdict(state: VerdictState, detail: string): void {
	const paint = { PASS: green, FAIL: red, MISCONFIGURED: yellow, REFUSED: violet }[state]
	console.log(`\n${paint(bold(`VERDICT: ${state}`))} ${detail}`)
}
