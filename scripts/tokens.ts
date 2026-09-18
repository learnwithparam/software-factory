/**
 * Read design/tokens.json and render the CSS every surface imports.
 *
 * Both the teach surfaces and the console read a generated file rather than
 * importing across the factory and target boundary. tests/design.test.ts fails
 * when a generated file on disk differs from what this renders, so the copies
 * cannot drift apart without the gate saying so.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'

export interface Tokens {
	color: Record<string, { value: string; use: string; role: 'text' | 'surface' | 'border' | 'state' }>
	contrast: { pairs: Array<{ fg: string; bg: string; level: 'AA' | 'AAA' | 'AA-large' }> }
	font: Record<string, { value: string; use: string }>
	size: Record<string, string>
	/** Reading measures. Prose is read and takes the narrower one; furniture is scanned. */
	measure: Record<string, string>
	space: Record<string, string>
	radius: Record<string, string>
	surfaces: Array<{ name: string; out: string }>
}

export function tokens(): Tokens {
	return JSON.parse(readFileSync(join(ROOT, 'design/tokens.json'), 'utf8'))
}

export const MINIMUM_RATIO = { AA: 4.5, AAA: 7, 'AA-large': 3 } as const

function channel(hex: string, at: number): number {
	const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255
	return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** Relative luminance, WCAG 2.1 definition. */
export function luminance(hex: string): number {
	return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}

export function contrastRatio(foreground: string, background: string): number {
	const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
	return ((light as number) + 0.05) / ((dark as number) + 0.05)
}

export function renderCss(t: Tokens, surface: string): string {
	const lines: string[] = [
		`/* Generated from design/tokens.json for the ${surface} surface. Do not edit.`,
		' * Change design/tokens.json and run `make tokens`. A stale copy fails make check. */',
		':root {',
	]
	for (const [name, token] of Object.entries(t.color)) {
		lines.push(`\t--c-${name}: ${token.value}; /* ${token.use} */`)
	}
	for (const [name, token] of Object.entries(t.font)) {
		lines.push(`\t--font-${name}: ${token.value};`)
	}
	for (const [name, value] of Object.entries(t.size)) lines.push(`\t--${name}: ${value};`)
	for (const [name, value] of Object.entries(t.measure)) lines.push(`\t--measure-${name}: ${value};`)
	for (const [name, value] of Object.entries(t.space)) lines.push(`\t--space-${name}: ${value};`)
	for (const [name, value] of Object.entries(t.radius)) lines.push(`\t--radius-${name}: ${value};`)
	lines.push('}', '')
	return lines.join('\n')
}
