/**
 * Work items.
 *
 * A real factory reads GitHub or Linear. The lab reads `.factory/issues/*.md`
 * so it runs with no network and no credentials, and the shape is the same: an
 * identifier, a title, the paths the work is expected to touch, and a checkable
 * condition for being finished.
 *
 * The paths matter more than they look. They are what boundary decides on and
 * what context routes from, and a task that names none of them cannot be
 * assessed at all, which is why that is an error rather than a default.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FACTORY_DIR } from './repo.ts'

export interface Issue {
	readonly id: string
	readonly title: string
	readonly paths: readonly string[]
	readonly doneWhen: string
	readonly body: string
}

function parse(text: string, file: string): Issue {
	const front = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
	if (front === null) throw new Error(`${file} has no frontmatter`)

	const lines = (front[1] as string).split('\n')
	const fields: Record<string, string> = {}
	const paths: string[] = []
	let inPaths = false

	for (const line of lines) {
		if (/^\s*-\s+/.test(line) && inPaths) {
			paths.push(line.replace(/^\s*-\s+/, '').trim())
			continue
		}
		const at = line.indexOf(':')
		if (at === -1) continue
		const key = line.slice(0, at).trim()
		const value = line.slice(at + 1).trim()
		inPaths = key === 'paths'
		if (!inPaths) fields[key] = value
	}

	for (const required of ['id', 'title', 'doneWhen']) {
		if (!fields[required]) throw new Error(`${file} declares no ${required}`)
	}
	if (paths.length === 0) {
		throw new Error(`${file} names no paths, so no rule can decide whether it may proceed`)
	}

	return {
		id: fields.id as string,
		title: fields.title as string,
		doneWhen: fields.doneWhen as string,
		paths,
		body: (front[2] as string).trim(),
	}
}

export function issuesIn(root: string): Issue[] {
	const dir = join(root, FACTORY_DIR, 'issues')
	if (!existsSync(dir)) return []
	return readdirSync(dir)
		.filter((name) => name.endsWith('.md'))
		.map((name) => parse(readFileSync(join(dir, name), 'utf8'), join(dir, name)))
		.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

export function issue(root: string, id: string): Issue {
	const found = issuesIn(root).find((candidate) => candidate.id === id)
	if (found === undefined) throw new Error(`no issue ${id} in ${root}/${FACTORY_DIR}/issues`)
	return found
}
