/**
 * How much of the workshop exists.
 *
 * `make score` measures whether what exists is proven. This measures whether it
 * exists at all, by comparing `teach/manifest.json` against the files on disk.
 *
 * The two are kept apart on purpose. Coverage rising while proof does not means
 * things are being written and not checked. Proof rising while coverage does not
 * means effort is going somewhere the plan did not ask for. Either way the
 * divergence is visible in one command, which is the only defence against
 * finishing something nobody asked for.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bold, dim, failed, note, table, title, waiting } from '../steps/lib/out.ts'
import { sessions, type Session } from './teach.ts'
import { ROOT } from './tree-hash.ts'

interface Manifest {
	diagrams: Array<{ id: string; shows: string }>
	patterns: string[]
	screenshots: Array<{ name: string; spec: string; shows: string; mustShow?: string }>
	specs: string[]
	profiles: string[]
	surfaces: string[]
}

export function manifest(): Manifest {
	return JSON.parse(readFileSync(join(ROOT, 'teach/manifest.json'), 'utf8')) as Manifest
}

export interface Deliverable {
	readonly group: string
	readonly name: string
	readonly done: boolean
	readonly detail: string
}

const spine = (): string => (existsSync(join(ROOT, 'teach.html')) ? readFileSync(join(ROOT, 'teach.html'), 'utf8') : '')

function specFiles(): Set<string> {
	const dir = join(ROOT, 'e2e/specs')
	if (!existsSync(dir)) return new Set()
	return new Set(readdirSync(dir).map((name) => name.replace(/\.spec\.ts$/, '')))
}

function shotsCaptured(): Set<string> {
	const dir = join(ROOT, 'e2e/specs')
	if (!existsSync(dir)) return new Set()
	const captured = new Set<string>()
	for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
		const text = readFileSync(join(dir, file), 'utf8')
		// shot, shotOf and shotTerminal all take the name second. Matching only
		// `shot(` missed every terminal picture and reported none of them captured.
		for (const match of text.matchAll(/\bshot(?:Of|Terminal)?\([^,]+,\s*['"]([\w-]+)['"]/g)) {
			captured.add(match[1] as string)
		}
	}
	return captured
}

/** Everything the manifest asks for, and whether it is there. */
export function deliverables(): Deliverable[] {
	const m = manifest()
	const out: Deliverable[] = []
	const text = spine()
	const specs = specFiles()
	const captured = shotsCaptured()

	for (const diagram of m.diagrams) {
		out.push({
			group: 'diagram',
			name: diagram.id,
			done: text.includes(`data-diagram="${diagram.id}"`),
			detail: diagram.shows,
		})
	}

	for (const pattern of m.patterns) {
		out.push({
			group: 'pattern',
			name: pattern,
			done: text.includes(`id="p-${pattern}"`),
			detail: 'stated with its forces, its cost, and where it appears in both systems',
		})
	}

	for (const spec of m.specs) {
		out.push({ group: 'spec', name: spec, done: specs.has(spec), detail: 'e2e/specs' })
	}

	for (const shot of m.screenshots) {
		// Captured by a spec, present on disk, and showing what it claims are three
		// different failures. The third is the one that cost this repository the
		// most: a picture of a loading spinner and a picture of an empty board both
		// sit on disk looking exactly like evidence.
		const takes = captured.has(shot.name)
		const onDisk = existsSync(join(ROOT, 'evidence/screens', `${shot.name}.png`))
		const beside = join(ROOT, 'evidence/screens', `${shot.name}.txt`)
		const said = existsSync(beside) ? readFileSync(beside, 'utf8') : undefined
		const shows = shot.mustShow === undefined || (said !== undefined && said.includes(shot.mustShow))

		out.push({
			group: 'screenshot',
			name: shot.name,
			done: takes && onDisk && shows,
			detail: !takes
				? 'no spec takes it'
				: !onDisk
					? 'a spec takes it, the run has not happened'
					: said === undefined
						? 'taken before the page text was recorded, so it proves nothing'
						: shows
							? shot.shows
							: `the page never said ${JSON.stringify(shot.mustShow)}`,
		})
	}

	for (const profile of m.profiles) {
		out.push({
			group: 'profile',
			name: profile,
			done: existsSync(join(ROOT, 'profiles', profile, 'charter.md')),
			detail: 'charter, targets and board settings',
		})
	}

	for (const surface of m.surfaces) {
		out.push({ group: 'surface', name: surface, done: existsSync(join(ROOT, surface)), detail: '' })
	}

	for (const session of sessions()) {
		out.push({
			group: 'session',
			name: session.key,
			done: sessionReady(session),
			detail: session.title,
		})
	}

	return out
}

/** A session is ready when its run sheet exists and shows what it promises. */
function sessionReady(session: Session): boolean {
	const path = join(ROOT, `teach/${session.key}.html`)
	if (!existsSync(path)) return false
	const text = readFileSync(path, 'utf8')
	// Every run sheet must show at least one screenshot, which is what makes it a
	// sheet for a session rather than a page of notes.
	return /src="\.\.\/evidence\/screens\//.test(text)
}

if (import.meta.main) {
	const all = deliverables()
	const groups = [...new Set(all.map((entry) => entry.group))]

	title('What exists')
	table(
		['group', 'done', 'of', 'missing'],
		groups.map((group) => {
			const mine = all.filter((entry) => entry.group === group)
			const done = mine.filter((entry) => entry.done)
			const missing = mine.filter((entry) => !entry.done).map((entry) => entry.name)
			return [
				group,
				String(done.length),
				String(mine.length),
				missing.slice(0, 3).join(', ') + (missing.length > 3 ? ` and ${missing.length - 3} more` : ''),
			]
		}),
	)

	const next = all.find((entry) => !entry.done)
	if (next !== undefined) {
		title('Next')
		waiting(`${next.group}: ${next.name}`)
		note(next.detail)
	}

	const done = all.filter((entry) => entry.done).length
	console.log(`\n${bold(`Delivered: ${done} / ${all.length}`)} ${dim('(make score measures whether it is proven)')}`)
	if (done < all.length) failed(`${all.length - done} deliverables to go`)
	process.exit(done === all.length ? 0 : 1)
}
