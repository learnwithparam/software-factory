/**
 * The run record.
 *
 * One file per run: what was attempted, which files changed, every verdict, the
 * timings, the cost. Appended to, never rewritten, because the value is in
 * comparing the tenth run to the first.
 *
 * It is also what the console in target/ displays, which is the point of the
 * lab building a ledger: the factory measures itself into the product the
 * factory is working on.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StageName } from '../05-loop/loop.ts'

export const RECORDS = process.env.FACTORY_RUNS ?? join(import.meta.dir, '..', '..', '.factory-runs')

export type Outcome = 'passed' | 'failed' | 'refused' | 'escalated'

export interface StageRecord {
	readonly name: StageName
	readonly startedAt: string
	readonly endedAt: string
	readonly toolCalls: number
}

export interface RunRecord {
	readonly id: string
	/** Absolute path of the repository this run worked on. */
	readonly repo: string
	readonly item: string
	readonly title: string
	readonly outcome: Outcome
	readonly startedAt: string
	readonly endedAt: string
	readonly tokensIn: number
	readonly tokensOut: number
	readonly costMinor: number
	readonly currency: 'EUR' | 'USD'
	readonly stages: StageRecord[]
	/** Every verdict, quoted rather than summarised. */
	readonly verdicts: Array<{ from: string; line: string }>
	readonly changedFiles: string[]
	readonly refusal?: { rule: string; reason: string }
	readonly pullRequest?: { branch: string; draft: boolean }
}

export function write(record: RunRecord): string {
	mkdirSync(RECORDS, { recursive: true })
	const path = join(RECORDS, `${record.id}.json`)
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`)
	return path
}

export function read(id: string): RunRecord {
	return JSON.parse(readFileSync(join(RECORDS, `${id}.json`), 'utf8')) as RunRecord
}

export function all(): RunRecord[] {
	try {
		return readdirSync(RECORDS)
			.filter((name) => name.endsWith('.json'))
			.map((name) => JSON.parse(readFileSync(join(RECORDS, name), 'utf8')) as RunRecord)
			.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
	} catch {
		return []
	}
}

/** The body of the pull request: everything a reviewer needs, and nothing it has to be told. */
export function pullRequestBody(record: RunRecord): string {
	const lines = [
		`Closes #${record.item}.`,
		'',
		'## What changed',
		...record.changedFiles.map((file) => `- \`${file}\``),
		'',
		'## Evidence',
		'',
		'| Check | Result |',
		'|---|---|',
		...record.verdicts.map((entry) => `| ${entry.from} | \`${entry.line}\` |`),
		'',
		'## Where the time went',
		'',
		'| Stage | Took | Tool calls |',
		'|---|---:|---:|',
		...record.stages.map((stage) => {
			const ms = Date.parse(stage.endedAt) - Date.parse(stage.startedAt)
			return `| ${stage.name} | ${Math.round(ms / 1000)}s | ${stage.toolCalls} |`
		}),
		'',
		`Tokens: ${record.tokensIn + record.tokensOut}. Cost: ${(record.costMinor / 100).toFixed(2)} ${record.currency}.`,
		'',
		'## What a person still decides',
		'',
		'This is a draft. A machine produced it and nobody has stood behind it yet.',
		'Merging is not automated, on any tier.',
	]
	return lines.join('\n')
}
