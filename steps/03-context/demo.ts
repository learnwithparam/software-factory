/**
 * Step three on stage: routing beats piling.
 *
 * `route <item>`   what one task receives, and what it does not
 * `compare`        two tasks side by side, which is where the point lands
 * `skills`         the procedures that are reused rather than retyped
 */

import { allowed, note, refused, step, table, title, verdict } from '../lib/out.ts'
import { issue, issuesIn } from '../lib/issues.ts'
import { loadRepo } from '../lib/repo.ts'
import { render, route } from './router.ts'

const repo = loadRepo()

function doRoute(id: string): number {
	const context = route(repo, issue(repo.root, id))
	title(`What task ${id} receives`)
	console.log(render(context))

	title('And what it does not')
	for (const entry of context.withheld) refused(`${entry.what}, because ${entry.because}`)
	note('A task that never sees the money rules cannot be talked into applying them.')

	verdict('PASS', `${context.rules.length} rules and ${context.skills.length} skills, chosen rather than piled.`)
	return 0
}

function doCompare(): number {
	const contexts = issuesIn(repo.root)
		.slice(0, 2)
		.map((item) => route(repo, item))

	title('Two tasks, two different bundles')
	table(
		['item', 'paths', 'checks', 'rules', 'skills', 'withheld'],
		contexts.map((context) => [
			context.issue.id,
			context.issue.paths.length.toString(),
			context.commands.length.toString(),
			context.rules.length.toString(),
			context.skills.map((skill) => skill.name).join(', '),
			context.withheld.length.toString(),
		]),
	)

	const [first, second] = contexts
	if (first === undefined || second === undefined) {
		verdict('FAIL', 'This repository needs at least two work items to compare.')
		return 1
	}

	title('The claim worth checking')
	const differ = render(first) !== render(second)
	const withheld = first.withheld.length > 0 && second.withheld.length > 0
	if (differ) allowed('the two items received different material')
	else refused('both items received the same text, which is piling by another name')
	if (withheld) allowed('each one records what it was not shown, and why')
	else refused('nothing records what was left out, so the claim is unverifiable')

	for (const entry of first.withheld.slice(0, 4)) note(`item ${first.issue.id} never saw ${entry.what}`)

	const held = differ && withheld
	verdict(held ? 'PASS' : 'FAIL', held ? 'Routed, not piled.' : 'The router is not selecting on anything.')
	return held ? 0 : 1
}

function doSkills(): number {
	title('Skills')
	table(
		['skill', 'applies to', 'outcome'],
		repo.skills.map((skill) => [skill.name, `${skill.when} (${skill.origin})`, skill.outcome]),
	)
	note('A skill states the outcome and the evidence. Scripting every keystroke produces something worse than the agent had already.')
	step('Each one is a file. Improving it improves every task that receives it.')
	note('A skill the repository ships replaces one of the same name from the factory.')
	verdict('PASS', `${repo.skills.length} procedures kept out of prompts.`)
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
