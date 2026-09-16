/**
 * Context: turning a work item into the exact material it should receive.
 *
 * The alternative is the instructions file that grows every time something goes
 * wrong. Each addition works, which is why it keeps happening, and accuracy
 * still falls: the sentence that matters is now competing with forty that do
 * not apply.
 *
 * Routing is a calculation over the repository's own declarations. What will
 * this touch, who owns it, what governs them, which skills apply. Being code
 * rather than prose, it can be tested: give it a task and assert what came back.
 */

import type { Issue } from '../lib/issues.ts'
import { affected, matcher, ownerOf, type Repo, type Skill, type Target } from '../lib/repo.ts'

export interface Rule {
	readonly source: string
	readonly text: string
}

export interface Command {
	readonly target: string
	readonly name: string
	readonly command: string
	readonly cwd: string
}

export interface Context {
	readonly issue: Issue
	readonly rules: Rule[]
	readonly skills: Skill[]
	readonly commands: Command[]
	/** What the router deliberately left out, and why. */
	readonly withheld: Array<{ what: string; because: string }>
}

/**
 * Assemble what this task gets to see.
 *
 * What is withheld is recorded beside what is included, because the interesting
 * claim is not that the right rules arrived. It is that the rules governing a
 * protected area did not arrive at a task with no business reading them.
 */
export function route(repo: Repo, issue: Issue): Context {
	const rules: Rule[] = [
		{ source: 'charter', text: `Tier is ${repo.charter.tier}. Nothing merges without a person.` },
	]
	const withheld: Array<{ what: string; because: string }> = []

	const written = new Set<Target>()
	for (const path of issue.paths) {
		const owner = ownerOf(path, repo.targets)
		if (owner !== undefined) written.add(owner)
	}

	const reached = affected(issue.paths, repo.targets)
	for (const target of reached) {
		if (written.has(target)) {
			rules.push({ source: `target:${target.name}`, text: `${target.autonomy}. ${target.why}` })
		} else {
			withheld.push({
				what: `the rules for ${target.name}`,
				because: 'this task does not write there, it only has to keep its checks passing',
			})
		}
	}

	for (const entry of repo.charter.protectedPaths) {
		const relevant = issue.paths.some((path) => matcher(entry.glob)(path))
		if (relevant) rules.push({ source: 'protected', text: `${entry.glob}: ${entry.reason}` })
		else {
			withheld.push({
				what: `the protected rule for ${entry.glob}`,
				because: 'this task touches nothing under it',
			})
		}
	}

	const skills: Skill[] = []
	for (const skill of repo.skills) {
		const applies = skill.when === '**' || issue.paths.some((path) => matcher(skill.when)(path))
		if (applies) skills.push(skill)
		else withheld.push({ what: `the ${skill.name} skill`, because: `it applies to ${skill.when}` })
	}

	const commands: Command[] = reached.flatMap((target) =>
		Object.entries(target.commands).map(([name, command]) => ({
			target: target.name,
			name,
			command,
			cwd: target.cwd,
		})),
	)

	return { issue, rules, skills, commands, withheld }
}

/** What the router assembled, as the text a task would actually receive. */
export function render(context: Context): string {
	return [
		`# ${context.issue.title}`,
		'',
		context.issue.body,
		'',
		'## Done when',
		context.issue.doneWhen,
		'',
		'## Files this task may touch',
		...context.issue.paths.map((path) => `- ${path}`),
		'',
		'## Rules that apply here',
		...context.rules.map((rule) => `- (${rule.source}) ${rule.text}`),
		'',
		'## Skills for this kind of work',
		...context.skills.map((skill) => `- ${skill.name}: ${skill.outcome}`),
		'',
		'## Checks that must pass',
		...context.commands.map((entry) => `- ${entry.target} ${entry.name}: (cd ${entry.cwd} && ${entry.command})`),
	].join('\n')
}
