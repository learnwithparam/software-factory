/**
 * Phase 6: the router routes, and records what it withheld.
 *
 * The interesting claim is not that the right rules arrived. It is that the
 * rules governing a protected area did not arrive at a task with no business
 * reading them.
 */

import { expect, it } from 'bun:test'
import { join } from 'node:path'
import { render, route } from '../steps/03-context/router.ts'
import { issue } from '../steps/lib/issues.ts'
import { loadRepo } from '../steps/lib/repo.ts'

const SAMPLE = join(import.meta.dirname, 'fixtures', 'sample')
const repo = loadRepo(SAMPLE)

const local = route(repo, issue(SAMPLE, '1'))
const shared = route(repo, issue(SAMPLE, '2'))

it('a task is never routed the rules for an area it does not touch', () => {
	expect(render(local)).not.toContain('secrets/')
	expect(local.withheld.some((entry) => entry.what.includes('secrets'))).toBe(true)
})

it('a task is never routed a skill that does not apply to it', () => {
	expect(local.skills.map((skill) => skill.name)).not.toContain('local-convention')
	expect(local.withheld.some((entry) => entry.what.includes('local-convention'))).toBe(true)
})

it('a task is routed the skill that does apply to it', () => {
	expect(shared.skills.map((skill) => skill.name)).toContain('local-convention')
})

it('a task is routed the checks of every target its change reaches', () => {
	const targets = new Set(shared.commands.map((entry) => entry.target))
	expect([...targets].sort()).toEqual(['app', 'lib'])
})

it('the routed text names the files the task may touch', () => {
	const text = render(local)
	expect(text).toContain('## Files this task may touch')
	for (const path of local.issue.paths) expect(text).toContain(path)
})

it('the routed text names the checks that must pass', () => {
	expect(render(local)).toContain('## Checks that must pass')
})

it('what was withheld is recorded beside what was included', () => {
	// Without this, the claim that context was routed rather than piled is
	// something you take on trust.
	expect(local.withheld.length).toBeGreaterThan(0)
	for (const entry of local.withheld) expect(entry.because.length).toBeGreaterThan(10)
})

it('two different tasks in one repository receive different material', () => {
	expect(render(local)).not.toBe(render(shared))
})
