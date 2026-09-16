/**
 * The six layers, expressed against Mastra Factory.
 *
 * This file is read, not run. It is written against `@mastra/factory`, which is
 * not a dependency of this repository: adding a third dependency tree for a step
 * that is taught by reading it would cost every student an install they do not
 * need. Copy it into a generated Factory project's `src/mastra/` and pass the
 * board in the `MastraFactory` constructor.
 *
 * Read it next to steps 01 to 06. The names differ and the shape does not.
 */

// @ts-nocheck: written against a dependency this repository deliberately does not install.
import { defineBoard } from '@mastra/factory'

/**
 * A quality board whose phases are the stages built by hand in steps 01 to 06.
 *
 * `resting` waits for a person or an event. `working` assigns an agent role.
 * `terminal` ends the work and releases the session's resources.
 */
export const factoryBoard = defineBoard({
	id: 'software-factory',
	title: 'Software Factory',
	initialPhase: 'intake',
	phases: {
		// Boundary. Nothing starts until policy has looked at it.
		intake: {
			title: 'Intake',
			kind: 'resting',
			outcomes: { accept: 'context', refuse: 'refused' },
		},

		// Context. The same calculation as steps/03-context/router.ts, expressed as
		// the prompt a skill invocation is given.
		context: {
			title: 'Context',
			kind: 'working',
			role: 'router',
			outcomes: { routed: 'building', blocked: 'refused' },
			onEnter: {
				issue: (ctx) => ({
					type: 'invokeSkill',
					idempotencyKey: `${ctx.ingress.id}:route`,
					role: 'router',
					skillName: 'route-context',
					prompt:
						'Read the ownership graph, select the targets this issue touches, and assemble only the rules and skills that govern them. Withhold everything else and say what you withheld.',
				}),
			},
		},

		// Execution. The sandbox callback is the platform's worktree.
		building: {
			title: 'Building',
			kind: 'working',
			role: 'doer',
			outcomes: { built: 'checking', failed: 'refused' },
		},

		// Verification. A separate role, so the writer never grades the work.
		checking: {
			title: 'Checking',
			kind: 'working',
			role: 'tester',
			outcomes: { pass: 'review', retry: 'building', escalate: 'refused' },
			onEnter: {
				manual: (ctx) => ({
					type: 'invokeSkill',
					idempotencyKey: `${ctx.ingress.id}:check`,
					role: 'tester',
					prompt:
						'Review the diff against the issue. You are not given any account of how the work was done. Run the gate script and quote its final line exactly. Report pass or fail and stop.',
				}),
			},
		},

		// Delivery. A person decides, which is the one thing that never moves.
		review: { title: 'Human review', kind: 'resting', outcomes: { merged: 'done', reopen: 'building' } },
		refused: { title: 'Refused', kind: 'terminal' },
		done: { title: 'Done', kind: 'terminal' },
	},

	/**
	 * The evidence rule, as a tool result handler.
	 *
	 * The gate's own output decides, not the agent's account of it. A command that
	 * returns a nonzero exit code is not necessarily a tool error, so the returned
	 * value is inspected as well.
	 */
	tools: {
		execute_command: {
			onResult: (ctx) => {
				if (ctx.item.stages[0] !== 'checking') return
				const output = String(ctx.result.value ?? '')
				if (!output.includes('VERDICT:')) return
				if (output.includes('VERDICT: MISCONFIGURED')) {
					return {
						type: 'notify',
						idempotencyKey: `${ctx.ingress.id}:misconfigured`,
						title: 'A required check is missing',
						body: 'The gate reported MISCONFIGURED, which is neither a pass nor a failure. Do not treat it as either.',
						level: 'warning',
					}
				}
			},
		},
	},

	/**
	 * Boundary, again, as the rule that cannot be talked around.
	 *
	 * Nothing reaches done without a person, on any tier. This is the same
	 * sentence as the one in CHARTER.md, and it is load bearing in both places.
	 */
	transitionPolicy: (ctx) => {
		if (ctx.toStage === 'done' && !ctx.isHumanTransition) {
			return {
				type: 'reject',
				code: 'approval_required',
				reason: 'Merging is never automated. A named engineer approves every change.',
			}
		}
		if (ctx.toStage === 'building' && !ctx.item.acceptedByHuman) {
			return {
				type: 'reject',
				code: 'acceptance_required',
				reason: 'Work marked propose needs recorded human acceptance before any code is written.',
			}
		}
	},
})
