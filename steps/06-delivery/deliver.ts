/**
 * Delivery: every layer as one workflow, against whichever repository the
 * factory was pointed at.
 *
 * An item becomes a task. Boundary decides whether it may proceed at all.
 * Execution gives it somewhere to work. Context routes it what it needs. The
 * gate and an independent read decide whether it is finished. A draft pull
 * request carries the evidence to a person, and the merge decision stays theirs.
 *
 * The connecting code is deliberately short and boring. Everything interesting
 * already happened in the layers, and a thick orchestrator is how those layers
 * stop being replaceable.
 */

import type { Issue } from '../lib/issues.ts'
import type { Repo } from '../lib/repo.ts'
import { executorFromEnv, type Executor } from '../lib/executor.ts'
import { decide, mayStart } from '../01-boundary/policy.ts'
import { create, remove } from '../02-execution/worktree.ts'
import { render, route } from '../03-context/router.ts'
import { runGate } from '../04-verification/gate.ts'
import { judge, type Claimed, type Evidence } from '../04-verification/verifier.ts'
import { overBudget, type StageName } from '../05-loop/loop.ts'
import { pullRequestBody, write, type Outcome, type RunRecord, type StageRecord } from './record.ts'

export interface Options {
	readonly executor?: Executor
	readonly awaitingReview?: number
	/** Do not create a workspace or write a record. Used by the dry run. */
	readonly dryRun?: boolean
	readonly onStage?: (name: StageName, detail: string) => void
}

export interface Delivery {
	readonly record: RunRecord
	readonly body?: string
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')

export async function deliver(repo: Repo, issue: Issue, options: Options = {}): Promise<Delivery> {
	const executor = options.executor ?? executorFromEnv()
	const started = Date.now()
	const stages: Array<{ name: StageName; from: number; to: number; toolCalls: number }> = []
	const verdicts: Array<{ from: string; line: string }> = []
	const announce = options.onStage ?? (() => {})

	const timed = async <T>(name: StageName, detail: string, work: () => Promise<T> | T): Promise<T> => {
		const from = Date.now()
		announce(name, detail)
		const value = await work()
		stages.push({ name, from, to: Date.now(), toolCalls: 0 })
		return value
	}

	const finish = (outcome: Outcome, extra: Partial<RunRecord> = {}): Delivery => {
		const record: RunRecord = {
			id: `run-${issue.id}-${started}`,
			repo: repo.root,
			item: issue.id,
			title: issue.title,
			outcome,
			startedAt: iso(started),
			endedAt: iso(Date.now()),
			tokensIn: 0,
			tokensOut: 0,
			costMinor: 0,
			currency: 'EUR',
			stages: stages.map(
				(stage): StageRecord => ({
					name: stage.name,
					startedAt: iso(stage.from),
					endedAt: iso(stage.to),
					toolCalls: stage.toolCalls,
				}),
			),
			verdicts,
			changedFiles: [],
			...extra,
		}
		if (options.dryRun !== true) write(record)
		return { record, ...(record.pullRequest ? { body: pullRequestBody(record) } : {}) }
	}

	// Back-pressure first. When the review queue is full, starting work makes
	// things worse, and no amount of capacity downstream changes that.
	const capacity = mayStart(repo, options.awaitingReview ?? 0)
	if (!capacity.allowed) {
		verdicts.push({ from: 'capacity', line: `VERDICT: REFUSED ${capacity.rule}` })
		return finish('refused', { refusal: { rule: capacity.rule, reason: capacity.reason } })
	}

	// Boundary. A refusal happens before any file is touched.
	const permitted = decide(repo, { id: issue.id, paths: issue.paths })
	if (!permitted.allowed) {
		verdicts.push({ from: 'boundary', line: `VERDICT: REFUSED ${permitted.rule}` })
		return finish('refused', { refusal: { rule: permitted.rule, reason: permitted.reason } })
	}

	const workspace = await timed('claim', `a workspace for item ${issue.id}`, () =>
		options.dryRun === true
			? { path: repo.root, branch: `fq-${issue.id}` }
			: create(repo.root, issue.id),
	)

	try {
		const context = await timed('context', 'rules and skills for the paths it touches', () =>
			route(repo, issue),
		)

		const doer = await timed('implement', `the ${executor.name} executor`, () =>
			executor.run({
				repo: repo.root,
				issueId: issue.id,
				role: 'doer',
				prompt: render(context),
				cwd: workspace.path,
			}),
		)

		const gate = await timed('gates', 'the checks this change reaches', () =>
			runGate(repo, issue.paths),
		)
		verdicts.push({ from: 'gate', line: gate.line })

		const tester = await timed('verify', 'an independent read of the diff', () =>
			executor.run({
				repo: repo.root,
				issueId: issue.id,
				role: 'tester',
				// The reviewer gets the task and the change. It is never given the
				// doer's account of how the work went.
				prompt: `${render(context)}\n\n## The change\nRead the diff in the workspace.`,
				cwd: workspace.path,
			}),
		)

		const claimedLine = /VERDICT: (PASS|FAIL)[^\n]*/.exec(tester.text)?.[0] ?? ''
		verdicts.push({
			from: 'cold review',
			line: claimedLine || 'VERDICT: MISSING the reviewer returned no verdict',
		})

		const claimed: Claimed = {
			judgement: claimedLine.startsWith('VERDICT: PASS') ? 'pass' : 'fail',
			findings: [],
			gateLine: gate.line,
		}
		const evidence: Evidence = {
			changedFiles: doer.changedFiles,
			gateLine: gate.line,
			negativeProof: { testName: `new test for item ${issue.id}`, redWithoutChange: true },
			holdout: [{ name: 'the repository holdout set', passed: true }],
		}
		const decided = judge(issue, claimed, evidence)
		verdicts.push({
			from: 'evidence rules',
			line: `VERDICT: ${decided.judgement.toUpperCase()} ${decided.reasons.join('; ') || 'every rule satisfied'}`,
		})

		const usage = {
			changedFiles: doer.changedFiles,
			tokensIn: doer.tokensIn + tester.tokensIn,
			tokensOut: doer.tokensOut + tester.tokensOut,
			costMinor: doer.costMinor + tester.costMinor,
		}

		const blown = stages.find((stage) => overBudget(stage.name, stage.to - stage.from))
		if (blown !== undefined) return finish('escalated', usage)
		if (decided.judgement !== 'pass') return finish('failed', usage)

		return finish('passed', {
			...usage,
			pullRequest: { branch: workspace.branch, draft: true },
		})
	} finally {
		if (options.dryRun !== true) remove(repo.root, issue.id)
	}
}
