/**
 * What the engine guarantees, against what only a prompt asked for.
 *
 * Two kinds of claim run through this suite and they are not the same kind of
 * thing. That a refusal leaves no branch on the money path is enforced: the
 * boundary layer decides it and code can hold it to that. That the refusal also
 * says why is an instruction in AGENTS.md, and an instruction is a request made
 * of a model, not a rule the engine keeps.
 *
 * Asserting both with expect() taught the wrong lesson twice over. A red suite
 * read as broken plumbing when the plumbing was fine, and the honest finding
 * (the instruction was ignored) was buried in a stack trace. Deleting the weak
 * ones would have been worse: the page would still claim the ownership graph
 * decides what an agent may attempt, with nothing left to contradict it.
 *
 * So a prompt-level claim is recorded rather than asserted. It lands in
 * artifacts/observations.json, make e2e prints the ones that did not hold, and
 * evidence/prompt-vs-gate.json carries them into workbook.html, where a test binds
 * the page to this record the same way figures are bound to the run.
 *
 * The rule for choosing: if you can name the file that enforces it, use
 * expect(). If the only thing asking for it is English in a prompt, observe it.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './shot.ts'

export const OBSERVATIONS = join(ROOT, 'artifacts', 'observations.json')

export interface Observation {
	/** The route that was running, matching the frontmatter in .factory/issues. */
	route: string
	/** What the prompt asked the agent to do, in one sentence. */
	asked: string
	/** Whether the run showed it happening. */
	held: boolean
	/** What the run showed instead, quoted or counted, never summarised. */
	saw: string
}

/**
 * Record a prompt-level claim and move on.
 *
 * Appended as one JSON object per line, because several spec files write this
 * concurrently and a rewritten array loses whichever write lost the race.
 */
export function observe(observation: Observation): void {
	mkdirSync(join(ROOT, 'artifacts'), { recursive: true })
	appendFileSync(OBSERVATIONS, `${JSON.stringify(observation)}\n`)
	const verdict = observation.held ? 'held' : 'DID NOT HOLD'
	console.log(`observed  ${observation.route}: ${observation.asked}: ${verdict}: ${observation.saw}`)
}

/** Every observation this run recorded, in the order it recorded them. */
export function observations(): Observation[] {
	if (!existsSync(OBSERVATIONS)) return []
	return readFileSync(OBSERVATIONS, 'utf8')
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => JSON.parse(line) as Observation)
}
