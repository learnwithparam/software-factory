/**
 * Counting what the prompts asked for against what the runs did.
 *
 * Kept apart from run-report.ts because that file talks to the board the moment
 * it is imported, and this arithmetic is the thing every figure in the findings
 * table rests on. It is worth a test that does not need a factory running.
 */

export interface Observation {
	readonly route: string
	readonly asked: string
	readonly held: boolean
	readonly saw: string
}

export interface Finding extends Observation {
	/** Runs in which this claim held. */
	readonly heldRuns: number
	/** Runs in which it did not. Anything above zero has to appear on the page. */
	readonly missedRuns: number
	/** What the most recent run that missed it saw, kept even once a later run passes. */
	readonly sawWhenMissed?: string
}

export interface Record {
	/** How many observation lines have already been counted into this file. */
	readonly countedLines?: number
	/** The first of them, which says whether the file is the same one or a new run's. */
	readonly countedFirst?: string
	readonly findings: Finding[]
}

const key = (entry: Observation): string => `${entry.route}/${entry.asked}`

/**
 * The lines not yet counted.
 *
 * make e2e deletes the observations file before each sequence, so a first line
 * that still matches means make finish appended to the run already counted, and
 * anything else is a new run to be counted whole. Length alone is not enough: a
 * sequence longer than the accumulated total would look like an append and lose
 * its first readings.
 */
export function uncounted(record: Record, lines: readonly string[]): string[] {
	const already = record.countedLines ?? 0
	const sameFile = record.countedFirst !== undefined && record.countedFirst === lines[0] && lines.length >= already
	return sameFile ? lines.slice(already) : [...lines]
}

/**
 * Fold one run's observations into the record.
 *
 * One reading per claim per run: a spec rerun within the same run records the
 * same claim twice, and counting both would report two runs where there was one.
 */
export function merge(record: Record, observations: readonly Observation[]): Finding[] {
	const merged = new Map(record.findings.map((finding) => [key(finding), finding]))
	for (const [id, entry] of new Map(observations.map((entry) => [key(entry), entry]))) {
		const prior = merged.get(id)
		merged.set(id, {
			...entry,
			heldRuns: (prior?.heldRuns ?? 0) + (entry.held ? 1 : 0),
			missedRuns: (prior?.missedRuns ?? 0) + (entry.held ? 0 : 1),
			sawWhenMissed: entry.held ? prior?.sawWhenMissed : entry.saw,
		})
	}
	return [...merged.values()].sort((a, b) => a.route.localeCompare(b.route) || a.asked.localeCompare(b.asked))
}

/** The highest number of runs any one claim has been read on. */
export function runsCounted(findings: readonly Finding[]): number {
	return findings.reduce((most, finding) => Math.max(most, finding.heldRuns + finding.missedRuns), 0)
}
