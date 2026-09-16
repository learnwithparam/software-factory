/**
 * Context: turning a task into the exact material that task should receive.
 *
 * The alternative is the instructions file that grows every time something goes
 * wrong. Each addition works, which is why it keeps happening, and accuracy
 * still falls: the sentence that matters is now competing with forty that do not
 * apply to this task.
 *
 * Routing is a calculation. What will this task touch, who owns those paths,
 * what rules govern them, and which skills does this kind of work need. Being
 * code rather than prose, it can be tested: give it a task and assert what came
 * back.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, reach } from '../lib/graph.ts'
import { loadCharter, type Charter } from '../01-boundary/policy.ts'

export const SKILLS = join(ROOT, 'steps/03-context/skills')
export const TASKS = join(ROOT, 'steps/03-context/tasks.json')

export interface Task {
	readonly id: string
	readonly title: string
	readonly kind: string
	readonly body: string
	readonly paths: readonly string[]
	readonly doneWhen: string
	readonly expect: 'build' | 'propose' | 'refuse'
}

export interface Skill {
	readonly name: string
	/** Glob deciding which tasks this skill applies to. */
	readonly when: string
	readonly outcome: string
	readonly body: string
}

export interface Rule {
	readonly source: string
	readonly text: string
}

export interface Context {
	readonly task: Task
	readonly rules: Rule[]
	readonly skills: Skill[]
	readonly commands: Array<{ target: string; name: string; command: string; cwd: string }>
	/** Everything the router deliberately left out, and why. */
	readonly withheld: Array<{ what: string; because: string }>
}

export function loadTasks(path: string = TASKS): Task[] {
	return (JSON.parse(readFileSync(path, 'utf8')) as { items: Task[] }).items
}

export function findTask(id: string, path: string = TASKS): Task {
	const task = loadTasks(path).find((candidate) => candidate.id === id)
	if (task === undefined) throw new Error(`no task ${id} in ${path}`)
	return task
}

export function loadSkills(dir: string = SKILLS): Skill[] {
	return readdirSync(dir)
		.filter((name) => name.endsWith('.md'))
		.map((name) => {
			const text = readFileSync(join(dir, name), 'utf8')
			const front = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
			if (front === null) throw new Error(`${name} has no frontmatter, so nothing can route it`)
			const fields = Object.fromEntries(
				(front[1] as string)
					.split('\n')
					.filter(Boolean)
					.map((line) => {
						const at = line.indexOf(':')
						return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
					}),
			)
			for (const required of ['name', 'when', 'outcome']) {
				if (!fields[required]) throw new Error(`${name} declares no ${required}`)
			}
			return {
				name: fields.name as string,
				when: fields.when as string,
				outcome: fields.outcome as string,
				body: (front[2] as string).trim(),
			}
		})
		.sort((a, b) => a.name.localeCompare(b.name))
}

function matches(glob: string, path: string): boolean {
	if (glob === '**') return true
	const source = glob
		.split('**')
		.map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('\\*', '[^/]*'))
		.join('.*')
	return new RegExp(`^${source}$`).test(path)
}

/**
 * Assemble what this task gets to see.
 *
 * What is withheld is recorded beside what is included, because the interesting
 * claim is not that the right rules arrived. It is that the money rules did not
 * arrive at a task that has no business reading them.
 */
export function route(task: Task, charter: Charter = loadCharter()): Context {
	const inside = task.paths
		.filter((path) => path.startsWith('target/'))
		.map((path) => path.slice('target/'.length))
	const answer = inside.length > 0 ? reach(inside) : { paths: [], unowned: [], targets: [] }
	const touched = new Set(
		inside.flatMap((path) =>
			answer.targets
				.filter((target) => path.startsWith(target.cwd === '.' ? '' : `${target.cwd}/`))
				.map((target) => target.name),
		),
	)

	const rules: Rule[] = [{ source: 'charter', text: `Tier is ${charter.tier}. Nothing merges without a person.` }]
	const withheld: Array<{ what: string; because: string }> = []

	for (const target of answer.targets) {
		if (touched.has(target.name)) {
			rules.push({ source: `target:${target.name}`, text: `${target.autonomy}. ${target.why}` })
		} else {
			withheld.push({
				what: `the rules for ${target.name}`,
				because: 'this task does not write there, it only has to keep its checks passing',
			})
		}
	}

	for (const entry of charter.protectedPaths) {
		const relevant = inside.some((path) => matches(entry.glob.replace(/^target\//, ''), path))
		if (relevant) rules.push({ source: 'protected', text: `${entry.glob}: ${entry.reason}` })
		else withheld.push({ what: `the protected rule for ${entry.glob}`, because: 'this task touches nothing under it' })
	}

	const skills = loadSkills().filter((skill) =>
		skill.when === '**' ? true : inside.some((path) => matches(skill.when, path)),
	)
	for (const skill of loadSkills()) {
		if (!skills.includes(skill)) {
			withheld.push({ what: `the ${skill.name} skill`, because: `it applies to ${skill.when}` })
		}
	}

	const commands = answer.targets.flatMap((target) =>
		Object.entries(target.commands).map(([name, command]) => ({
			target: target.name,
			name,
			command,
			cwd: target.cwd,
		})),
	)

	return { task, rules, skills, commands, withheld }
}

/** What the router assembled, as the text a task would actually receive. */
export function render(context: Context): string {
	const lines = [
		`# ${context.task.title}`,
		'',
		context.task.body,
		'',
		'## Done when',
		context.task.doneWhen,
		'',
		'## Rules that apply here',
		...context.rules.map((rule) => `- (${rule.source}) ${rule.text}`),
		'',
		'## Skills for this kind of work',
		...context.skills.map((skill) => `- ${skill.name}: ${skill.outcome}`),
		'',
		'## Checks that must pass',
		...context.commands.map((entry) => `- ${entry.target} ${entry.name}: (cd ${entry.cwd} && ${entry.command})`),
	]
	return lines.join('\n')
}
