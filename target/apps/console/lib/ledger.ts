/**
 * Reading the ledger.
 *
 * The console owns no numbers. Runs and stages come from the ingest service and
 * the money comes from the budget engine, so a figure on this page is always a
 * figure something else computed. That is the rule the whole app is built on:
 * one resolver per concept, and the view is never the resolver.
 */

import type { Budget, Run, Stage, StageName } from '@ledger/contracts'
import { STAGE_ORDER, durationMs } from '@ledger/contracts'

export interface RunDetail {
	run: Run
	stages: Stage[]
}

export interface StageBar {
	name: StageName
	ms: number
	/** Share of the run's measured time, 0 to 1. */
	share: number
	toolCalls: number
}

const INGEST = process.env.INGEST_URL ?? 'http://127.0.0.1:8081'

/** Every outbound call is bounded. `fetch` has no default timeout. */
async function get<T>(path: string, timeoutMs = 4000): Promise<T> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const response = await fetch(`${INGEST}${path}`, {
			signal: controller.signal,
			cache: 'no-store',
		})
		if (!response.ok) throw new Error(`ingest answered ${response.status} for ${path}`)
		return (await response.json()) as T
	} finally {
		clearTimeout(timer)
	}
}

export function listRuns(limit = 50): Promise<Run[]> {
	return get<Run[]>(`/runs?limit=${limit}`)
}

export function readRun(id: string): Promise<RunDetail> {
	return get<RunDetail>(`/runs/${encodeURIComponent(id)}`)
}

/**
 * Turn a run's stages into a waterfall.
 *
 * Shares are computed against the measured total rather than the run's own
 * start and end, because a gap between stages is real and pretending otherwise
 * would make the bars sum to more than the whole.
 */
export function waterfall(stages: Stage[]): StageBar[] {
	const measured = stages.map((stage) => ({
		name: stage.name,
		ms: durationMs(stage.startedAt, stage.endedAt),
		toolCalls: stage.toolCalls,
	}))
	const total = measured.reduce((sum, stage) => sum + stage.ms, 0)
	const ordered = [...measured].sort(
		(a, b) => STAGE_ORDER.indexOf(a.name) - STAGE_ORDER.indexOf(b.name),
	)
	return ordered.map((stage) => ({ ...stage, share: total === 0 ? 0 : stage.ms / total }))
}

/** The stage that took longest, which is the one worth attacking. */
export function slowestStage(bars: StageBar[]): StageBar | undefined {
	return bars.reduce<StageBar | undefined>(
		(worst, bar) => (worst === undefined || bar.ms > worst.ms ? bar : worst),
		undefined,
	)
}

/** Human duration. Seconds below a minute, then minutes and seconds. */
export function humanMs(ms: number): string {
	const seconds = Math.round(ms / 1000)
	if (seconds < 60) return `${seconds}s`
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

export type { Budget, Run, Stage, StageName }
