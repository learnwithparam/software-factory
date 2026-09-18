/**
 * What the runs actually took, written down so a page cannot disagree with it.
 *
 * Every decision the project holds, not only the last sequence. A median over
 * one run of each route is a sample of one, and the figures are captioned as
 * medians across every recorded run because that is what they are. Nothing
 * here filters by time, deliberately.
 *
 * teach.html says every figure it quotes is read from this record by a test.
 * That sentence was false when it was written: the stage waterfall carried
 * numbers somebody made up, which is exactly the failure the rest of this
 * repository exists to argue against.
 *
 * Every decision the factory made carries the moment it was created and the
 * moment it finished, so the durations here are the product's own record rather
 * than a stopwatch held beside it. The human wait is the interesting one: it is
 * measured from a decision finishing to the next one starting, which is the gap
 * a person stood in.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { session } from './factory-connect.ts'
import { merge, runsCounted, uncounted, type Observation, type Record } from './lib/observations.ts'
import { ROOT } from './tree-hash.ts'

const BASE = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'

interface Decision {
	readonly id: string
	readonly workItemId: string
	readonly role: string | null
	readonly status: string
	readonly attempts: number
	readonly createdAt: string
	readonly completedAt: string | null
}

export interface Stage {
	readonly role: string
	readonly runs: number
	readonly medianMs: number
	readonly label: string
}

export interface RunReport {
	readonly takenAt: string
	readonly model: string
	readonly decisions: number
	readonly retried: number
	readonly stages: Stage[]
	readonly humanWaitMs: number
	readonly humanWaitLabel: string
}

/** Minutes and seconds, the way the diagrams read them. */
export function label(ms: number): string {
	const total = Math.round(ms / 1000)
	const minutes = Math.floor(total / 60)
	const seconds = total % 60
	return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function median(values: number[]): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0 ? Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2) : (sorted[middle] as number)
}

async function json<T>(path: string, cookie: string): Promise<T> {
	const response = await fetch(`${BASE}${path}`, { headers: { cookie, accept: 'application/json' } })
	if (!response.ok) throw new Error(`${path} answered ${response.status}`)
	return (await response.json()) as T
}

const cookie = await session()
const { projects } = await json<{ projects: Array<{ id: string; defaultModelId: string | null }> }>('/web/factory/projects', cookie)
const project = projects[0]
if (project === undefined) throw new Error('no factory project exists')

const { decisions } = await json<{ decisions: Decision[] }>(`/web/factory/projects/${project.id}/decisions`, cookie)

const finished = decisions.filter((d) => d.status === 'succeeded' && d.completedAt !== null && d.role !== null)
const took = (d: Decision) => Date.parse(d.completedAt as string) - Date.parse(d.createdAt)

const ROLES = ['triage', 'plan', 'work', 'review'] as const
const stages: Stage[] = ROLES.map((role) => {
	const mine = finished.filter((d) => d.role === role).map(took).filter((ms) => ms > 0)
	const ms = median(mine)
	return { role, runs: mine.length, medianMs: ms, label: label(ms) }
}).filter((stage) => stage.runs > 0)

// The gap a person stood in: from one decision finishing to the next starting,
// on the same item. Anything over an hour is somebody going home and is not a
// measurement of this system, so it is left out rather than quietly averaged in.
const waits: number[] = []
const byItem = new Map<string, Decision[]>()
for (const decision of finished) {
	byItem.set(decision.workItemId, [...(byItem.get(decision.workItemId) ?? []), decision])
}
for (const list of byItem.values()) {
	const ordered = [...list].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
	for (let index = 1; index < ordered.length; index += 1) {
		const gap = Date.parse((ordered[index] as Decision).createdAt) - Date.parse((ordered[index - 1] as Decision).completedAt as string)
		if (gap > 0 && gap < 60 * 60 * 1000) waits.push(gap)
	}
}
const humanWaitMs = median(waits)

const report: RunReport = {
	takenAt: new Date().toISOString(),
	model: project.defaultModelId ?? 'unknown',
	decisions: decisions.length,
	retried: decisions.filter((d) => d.attempts > 1).length,
	stages,
	humanWaitMs,
	humanWaitLabel: label(humanWaitMs),
}

mkdirSync(join(ROOT, 'evidence'), { recursive: true })
writeFileSync(join(ROOT, 'evidence', 'factory-run.json'), `${JSON.stringify(report, null, '\t')}\n`)
console.log(`factory-run.json: ${stages.length} stages from ${finished.length} finished decisions, human wait ${report.humanWaitLabel}`)

/**
 * What the prompts asked for, against what the runs did.
 *
 * The suite asserts everything the engine enforces and records everything only
 * a prompt requests, because those two fail for different reasons and a stack
 * trace cannot tell them apart. This carries the second kind into evidence, so
 * teach.html quotes measurements rather than recollection and a test can hold
 * the page to them.
 *
 * Counted across runs rather than overwritten, which is the whole point. Two
 * sequences against the same issues disagreed: on one the agent followed the
 * branch convention, opened a pull request and named the path it refused, and
 * on the other it did none of the three. A record holding only the latest
 * reading would show a clean run and teach that everything is fine. What is
 * worth teaching is that the same instruction is obeyed sometimes, so every
 * claim carries how many runs held it and how many did not.
 *
 * Printed as well as written. A finding buried in a JSON file nobody opens is
 * the same decoration as a gate wired to no command, so make e2e ends by saying
 * out loud which instructions the model did not follow.
 */
const OBSERVED = join(ROOT, 'artifacts', 'observations.json')
const RECORD = join(ROOT, 'evidence', 'prompt-vs-gate.json')

const lines: string[] = existsSync(OBSERVED)
	? readFileSync(OBSERVED, 'utf8').split('\n').filter((line) => line.trim() !== '')
	: []

{
	const held: Record = existsSync(RECORD)
		? (JSON.parse(readFileSync(RECORD, 'utf8')) as Record)
		: { findings: [] }
	const before = held.findings

	// Only the lines written since this file was last counted. The observations
	// file is append-only within a run and deleted by make e2e at the start of
	// the next, so an offset says exactly what is new. Counting the whole file
	// again would fold the sequence's readings into the rerun's and report two
	// runs of everything where there was one of each, which is a fabricated
	// number under a page that exists to stop fabricated numbers.
	const observations = uncounted(held, lines).map((line) => JSON.parse(line) as Observation)
	if (observations.length === 0) {
		console.log(`prompt-vs-gate.json: nothing observed since it was last counted, left at ${before.length} claims`)
		process.exit(0)
	}

	const findings = merge(held, observations)
	const runs = runsCounted(findings)
	writeFileSync(
		RECORD,
		`${JSON.stringify(
			{ takenAt: report.takenAt, model: report.model, runs, countedLines: lines.length, countedFirst: lines[0], findings },
			null,
			'\t',
		)}\n`,
	)

	const everMissed = findings.filter((finding) => finding.missedRuns > 0)
	console.log(`prompt-vs-gate.json: ${findings.length} prompt-level claims over ${runs} run(s), ${everMissed.length} not always honoured`)
	for (const finding of everMissed) {
		console.log(`  ${finding.route}: ${finding.asked}`)
		console.log(`    held ${finding.heldRuns}, missed ${finding.missedRuns}: ${finding.sawWhenMissed ?? finding.saw}`)
	}
}
