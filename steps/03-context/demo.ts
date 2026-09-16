/**
 * Step three on stage: routing beats piling.
 *
 * `route <item>`   what one task receives, and what it does not
 * `compare`        two tasks side by side, which is where the point lands
 * `skills`         the procedures that are reused rather than retyped
 */

import { allowed, note, refused, step, table, title, verdict } from '../lib/out.ts'
import { findTask, loadSkills, loadTasks, render, route } from './router.ts'

function doRoute(id: string): number {
	const context = route(findTask(id))
	title(`What task ${id} receives`)
	console.log(render(context))

	title('And what it does not')
	for (const entry of context.withheld) refused(`${entry.what}, because ${entry.because}`)
	note('A task that never sees the money rules cannot be talked into applying them.')

	verdict('PASS', `${context.rules.length} rules and ${context.skills.length} skills, chosen rather than piled.`)
	return 0
}

function doCompare(): number {
	const tasks = loadTasks().slice(0, 2)
	const contexts = tasks.map((task) => route(task))

	title('Two tasks, two different bundles')
	table(
		['task', 'kind', 'targets it writes', 'rules', 'skills', 'withheld'],
		contexts.map((context) => [
			context.task.id,
			context.task.kind,
			context.task.paths.length.toString(),
			context.rules.length.toString(),
			context.skills.map((skill) => skill.name).join(', '),
			context.withheld.length.toString(),
		]),
	)

	const display = contexts[0]
	const contract = contexts[1]
	if (display === undefined || contract === undefined) {
		verdict('FAIL', 'The lab needs at least two tasks to compare.')
		return 1
	}

	title('The claim worth checking')
	const displaySawContractSkill = display.skills.some((skill) => skill.when.includes('contracts'))
	const contractSawContractSkill = contract.skills.some((skill) => skill.when.includes('contracts'))

	if (!displaySawContractSkill) allowed('the display task was never shown the contract procedure')
	else refused('the display task was shown a procedure it has no use for')

	if (contractSawContractSkill) allowed('the contract task was')
	else refused('the contract task was not shown the procedure it needs')

	const held = !displaySawContractSkill && contractSawContractSkill
	verdict(held ? 'PASS' : 'FAIL', held ? 'Routed, not piled.' : 'The router is not selecting on anything.')
	return held ? 0 : 1
}

function doSkills(): number {
	title('Skills')
	table(
		['skill', 'applies to', 'outcome'],
		loadSkills().map((skill) => [skill.name, skill.when, skill.outcome]),
	)
	note('A skill states the outcome and the evidence. Scripting every keystroke produces something worse than the agent had already.')
	step('Each one is a file. Improving it improves every task that receives it.')
	verdict('PASS', `${loadSkills().length} procedures kept out of prompts.`)
	return 0
}

const [command = 'compare', argument] = process.argv.slice(2)

const commands: Record<string, () => number> = {
	route: () => doRoute(argument ?? '12'),
	compare: doCompare,
	skills: doSkills,
}

const chosen = commands[command]
if (chosen === undefined) {
	console.error(`unknown command: ${command}`)
	console.error('usage: demo.ts [route <item>|compare|skills]')
	process.exit(2)
}
process.exit(chosen())
