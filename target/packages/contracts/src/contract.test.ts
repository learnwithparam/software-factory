import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import {
	BUDGET_FIELDS,
	RUN_FIELDS,
	STAGE_FIELDS,
	STAGE_ORDER,
	durationMs,
	formatMinor,
} from './index.ts'

const schemaDir = join(import.meta.dirname, '..', 'schema')

function schema(file: string): { properties: Record<string, unknown>; required: string[] } {
	return JSON.parse(readFileSync(join(schemaDir, file), 'utf8'))
}

const CASES = [
	['run.schema.json', RUN_FIELDS],
	['stage.schema.json', STAGE_FIELDS],
	['budget.schema.json', BUDGET_FIELDS],
] as const

describe('the TypeScript types match the shared schema', () => {
	it.each(CASES)('%s has exactly the fields the schema declares', (file, fields) => {
		expect([...fields].sort()).toEqual(Object.keys(schema(file).properties).sort())
	})

	it.each(CASES)('%s makes every field required', (file) => {
		const s = schema(file)
		expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort())
	})

	it('the stage order covers every stage name the schema allows', () => {
		const allowed = (schema('stage.schema.json').properties as { name: { enum: string[] } }).name.enum
		expect([...STAGE_ORDER].sort()).toEqual([...allowed].sort())
	})
})

describe('durations', () => {
	it('measures a stage in milliseconds', () => {
		expect(durationMs('2026-09-16T10:00:00Z', '2026-09-16T10:00:12Z')).toBe(12_000)
	})

	it('refuses a stage that ended before it started', () => {
		expect(() => durationMs('2026-09-16T10:00:12Z', '2026-09-16T10:00:00Z')).toThrow(
			/ended before it started/,
		)
	})

	it('refuses an instant it cannot parse rather than reporting zero', () => {
		expect(() => durationMs('yesterday', '2026-09-16T10:00:00Z')).toThrow(/unparseable/)
	})
})

describe('money', () => {
	it('keeps the cents that float division would lose', () => {
		expect(formatMinor(1999, 'EUR')).toBe('€19.99')
		expect(formatMinor(5, 'USD')).toBe('$0.05')
		expect(formatMinor(0, 'EUR')).toBe('€0.00')
	})

	it('puts the sign before the symbol', () => {
		expect(formatMinor(-250, 'EUR')).toBe('-€2.50')
	})
})
