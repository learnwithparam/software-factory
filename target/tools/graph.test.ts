import { describe, expect, it } from 'bun:test'
import { affected, files, loadGraph, matcher, ownerOf, unowned } from './graph.ts'

const targets = loadGraph()

describe('the graph', () => {
	it('gives every target a test command, so nothing is unchecked by design', () => {
		const untested = targets.filter((target) => target.commands.test === undefined)
		expect(untested.map((target) => target.name)).toEqual([])
	})

	it('names only targets that exist in dependsOn', () => {
		const names = new Set(targets.map((target) => target.name))
		const dangling = targets.flatMap((target) =>
			target.dependsOn.filter((name) => !names.has(name)).map((name) => `${target.name} -> ${name}`),
		)
		expect(dangling).toEqual([])
	})

	it('has no dependency cycle', () => {
		const byName = new Map(targets.map((target) => [target.name, target]))
		const state = new Map<string, 'visiting' | 'done'>()
		const cycles: string[] = []
		const walk = (name: string, trail: string[]): void => {
			if (state.get(name) === 'done') return
			if (state.get(name) === 'visiting') {
				cycles.push([...trail, name].join(' -> '))
				return
			}
			state.set(name, 'visiting')
			for (const next of byName.get(name)?.dependsOn ?? []) walk(next, [...trail, name])
			state.set(name, 'done')
		}
		for (const target of targets) walk(target.name, [])
		expect(cycles).toEqual([])
	})

	it('gives every target a reason for its autonomy level', () => {
		const silent = targets.filter((target) => target.why.trim().length < 20)
		expect(silent.map((target) => target.name)).toEqual([])
	})
})

describe('ownership', () => {
	it('claims every file in the repository', () => {
		// A directory nobody owns has no checks and no autonomy rule. The build
		// fails rather than guessing, because a wrong guess is silent.
		expect(unowned(files(), targets)).toEqual([])
	})

	it('finds the owner of a path', () => {
		expect(ownerOf('services/ingest/http.go', targets)?.name).toBe('ingest')
		expect(ownerOf('apps/console/app/page.tsx', targets)?.name).toBe('console')
	})

	it('returns nothing for a path no target claims', () => {
		expect(ownerOf('services/nobody/main.go', targets)).toBeUndefined()
	})
})

describe('affected', () => {
	it('selects every dependant when the shared contract changes', () => {
		const names = affected(['packages/contracts/schema/run.schema.json'], targets).map((t) => t.name)
		expect(names).toContain('contracts')
		expect(names).toContain('ingest')
		expect(names).toContain('budget')
		expect(names).toContain('console')
	})

	it('selects one target when the change is local to it', () => {
		expect(affected(['apps/console/app/page.tsx'], targets).map((t) => t.name)).toEqual(['console'])
	})

	it('selects nothing when nothing changed', () => {
		expect(affected([], targets)).toEqual([])
	})
})

describe('matcher', () => {
	it('matches a directory tree but not a sibling with a shared prefix', () => {
		const match = matcher('services/ingest/**')
		expect(match('services/ingest/http.go')).toBe(true)
		expect(match('services/ingest/cmd/server/main.go')).toBe(true)
		expect(match('services/ingest-extra/http.go')).toBe(false)
	})

	it('matches an exact path with no wildcard', () => {
		expect(matcher('project-graph.json')('project-graph.json')).toBe(true)
		expect(matcher('project-graph.json')('a/project-graph.json')).toBe(false)
	})
})
