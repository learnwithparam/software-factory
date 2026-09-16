/**
 * Holdout checks for the ledger.
 *
 * Deliberately not a *.test.ts file and deliberately outside the target, so
 * neither the target's own suite nor the context router picks it up. The
 * verifier runs it against the finished change.
 */

export interface HoldoutResult {
	readonly name: string
	readonly passed: boolean
	readonly detail: string
}

async function json(url: string): Promise<unknown> {
	const response = await fetch(url, { signal: AbortSignal.timeout(4000) })
	if (!response.ok) throw new Error(`${url} answered ${response.status}`)
	return response.json()
}

type Check = { name: string; run: (base: string) => Promise<string | undefined> }

const CHECKS: Check[] = [
	{
		name: 'a run list is bounded even when nobody asks for a limit',
		run: async (base) => {
			const runs = (await json(`${base}/runs`)) as unknown[]
			if (!Array.isArray(runs)) return 'the list is not an array'
			if (runs.length > 200) return `returned ${runs.length} rows with no limit applied`
			return undefined
		},
	},
	{
		name: 'an absurd limit is refused rather than served',
		run: async (base) => {
			const response = await fetch(`${base}/runs?limit=100000`, { signal: AbortSignal.timeout(4000) })
			if (response.status !== 400) return `answered ${response.status} instead of refusing`
			const body = (await response.json()) as { code?: string }
			if (typeof body.code !== 'string') return 'refused without a machine-readable code'
			return undefined
		},
	},
	{
		name: 'a missing run is a not-found with a code, never an empty success',
		run: async (base) => {
			const response = await fetch(`${base}/runs/definitely-not-a-run`, {
				signal: AbortSignal.timeout(4000),
			})
			if (response.status !== 404) return `answered ${response.status}`
			const body = (await response.json()) as { code?: string }
			if (body.code !== 'run_not_found') return `code was ${String(body.code)}`
			return undefined
		},
	},
	{
		name: 'stages come back in loop order, whatever order they were recorded',
		run: async (base) => {
			const runs = (await json(`${base}/runs`)) as Array<{ id: string }>
			const first = runs.find((run) => run.id === 'run-101')
			if (first === undefined) return 'the seeded run is missing'
			const detail = (await json(`${base}/runs/${first.id}`)) as { stages: Array<{ name: string }> }
			const order = ['claim', 'context', 'implement', 'gates', 'verify', 'human']
			const seen = detail.stages.map((stage) => order.indexOf(stage.name))
			const sorted = [...seen].sort((a, b) => a - b)
			if (JSON.stringify(seen) !== JSON.stringify(sorted)) {
				return `stages arrived as ${detail.stages.map((stage) => stage.name).join(', ')}`
			}
			return undefined
		},
	},
	{
		name: 'every seeded outcome the contract allows is represented, refusal included',
		run: async (base) => {
			const runs = (await json(`${base}/runs`)) as Array<{ outcome: string }>
			const outcomes = new Set(runs.map((run) => run.outcome))
			if (!outcomes.has('refused')) return 'no refused run, so the refusal path is never exercised'
			return undefined
		},
	},
]

export async function runHoldout(base: string): Promise<HoldoutResult[]> {
	const results: HoldoutResult[] = []
	for (const check of CHECKS) {
		try {
			const problem = await check.run(base)
			results.push({
				name: check.name,
				passed: problem === undefined,
				detail: problem ?? 'held',
			})
		} catch (error) {
			results.push({
				name: check.name,
				passed: false,
				detail: error instanceof Error ? error.message : String(error),
			})
		}
	}
	return results
}

export const HOLDOUT_COUNT = CHECKS.length
