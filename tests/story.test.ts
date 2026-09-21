/**
 * The workbook is one chain of problems, told in plain words, and each picture says something the prose does not.
 *
 * Each concept opens with the problem, draws it, gives the fix and hands over to the next problem.
 * These tests hold that shape: a body may not restate its picture, no phrase is said twice, no
 * prose runs long without a picture, every bridge leads to the next heading, sentences stay short,
 * and every code block is an exact copy of a lab file.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../scripts/tree-hash.ts'

const MAX_OVERLAP = 0.45
const MAX_PROSE_RUN = 120
const MIN_SHARED = 2
const MAX_SENTENCE_WORDS = 22
const MIN_FLESCH = 55
const STOPWORDS = new Set(
	'this that with from what when which does have must will your then they them into each only than about there their would could should still being were been'.split(' '),
)

const page = readFileSync(join(ROOT, 'workbook.html'), 'utf8')

const unescape = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
export const text = (markup: string): string => unescape(markup.replace(/<[^>]+>/g, ' '))
/** A code block as written: markup out with no space put in, entities back. */
const code = (markup: string): string => unescape(markup.replace(/<[^>]+>/g, ''))
export const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9']+/g) ?? []
export const content = (s: string): Set<string> => new Set(words(s).filter((w) => w.length >= 4 && !STOPWORDS.has(w)))
const phrases = (s: string, n = 6): Set<string> => {
	const w = words(s)
	return new Set(Array.from({ length: Math.max(0, w.length - n + 1) }, (_, i) => w.slice(i, i + n).join(' ')))
}
export const sentences = (s: string): string[] => s.trim().split(/(?<=[.?!])\s+/).filter(Boolean)
const syllables = (w: string): number => {
	const n = (w.match(/[aeiouy]+/g) ?? []).length
	return Math.max(w.endsWith('e') && n > 1 ? n - 1 : n, 1)
}
export const flesch = (s: string): number => {
	const w = words(s)
	return 206.835 - (1.015 * w.length) / sentences(s).length - (84.6 * w.reduce((a, x) => a + syllables(x), 0)) / w.length
}

/** Every chapter heading and every concept, in the order a reader meets them. */
interface Item {
	readonly kind: 'chapter' | 'concept'
	readonly id: string
	readonly heading: string
	readonly html: string
}
function items(): Item[] {
	const out: Item[] = []
	const starts = [...page.matchAll(/<h2>(.*?)<\/h2>|<div class="concept" id="c-([a-z0-9-]+)"/g)]
	starts.forEach((m, i) => {
		const end = starts[i + 1]?.index ?? page.length
		const html = page.slice(m.index, end).split('</section>')[0] as string
		if (m[1] !== undefined) out.push({ kind: 'chapter', id: m[1], heading: text(m[1]), html })
		else out.push({ kind: 'concept', id: m[2] as string, heading: text(/<h3>(.*?)<\/h3>/.exec(html)?.[1] ?? ''), html })
	})
	return out
}
const concepts = (): Item[] => items().filter((item) => item.kind === 'concept')

function parts(html: string): Record<'heading' | 'hook' | 'captions' | 'body' | 'drawn', string> {
	const figures = [...html.matchAll(/<figure class="diagram" data-diagram="[a-z0-9-]+">[\s\S]*?<\/figure>/g)].map((m) => m[0])
	return {
		heading: text(/<h3>(.*?)<\/h3>/.exec(html)?.[1] ?? ''),
		hook: text([...html.matchAll(/<p class="hook">(.*?)<\/p>/g)].map((m) => m[1]).join(' ')),
		captions: text([...html.matchAll(/<figcaption>([\s\S]*?)<\/figcaption>/g)].map((m) => m[1]).join(' ')),
		body: text([...html.matchAll(/<div class="body">([\s\S]*?)<\/div>/g)].map((m) => m[1]).join(' ')),
		drawn: text(figures.flatMap((f) => [...f.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])).join(' ')),
	}
}

export const overlap = (body: string, picture: string): number => {
	const mine = new Set(words(body).filter((w) => w.length >= 4))
	const theirs = new Set(words(picture))
	return mine.size === 0 ? 0 : [...mine].filter((w) => theirs.has(w)).length / mine.size
}

/** What a reader reads as sentences: the hook, the body paragraphs and the bridge. */
const story = (html: string): string =>
	[...html.matchAll(/<p class="(?:hook|next)">(.*?)<\/p>|<div class="body">([\s\S]*?)<\/div>/g)].map((m) => text(m[1] ?? m[2] ?? '')).join(' ')

describe('a concept does not say its picture twice', () => {
	it('uses under 45% of its body words from its own figures and captions', () => {
		const over: Record<string, number> = {}
		for (const { id, html } of concepts()) {
			const p = parts(html)
			if (!html.includes('data-diagram="')) continue
			const share = overlap(p.body, `${p.drawn} ${p.captions}`)
			if (share >= MAX_OVERLAP) over[id] = Math.round(share * 100) / 100
		}
		expect(over, 'bodies that mostly restate their figure').toEqual({})
	})

	it('never repeats a six word phrase between heading, hook, captions, body and drawn text', () => {
		const repeated: Record<string, string[]> = {}
		for (const { id, html } of concepts()) {
			const p = Object.entries(parts(html)).map(([k, v]) => [k, phrases(v)] as const)
			p.forEach(([a, pa], i) => {
				for (const [b, pb] of p.slice(i + 1)) {
					const shared = [...pa].find((x) => pb.has(x))
					if (shared) (repeated[id] ??= []).push(`${a} and ${b}: ${shared}`)
				}
			})
		}
		expect(repeated, 'the same thing stated in two places').toEqual({})
	})

	it('never runs prose past 120 words without a figure, table, code block or heading', () => {
		const long: [string, number][] = []
		for (const { id, html } of concepts()) {
			for (const run of html.split(/<figure\b[\s\S]*?<\/figure>|<pre\b[\s\S]*?<\/pre>|<table\b[\s\S]*?<\/table>|<h[1-4]\b[\s\S]*?<\/h[1-4]>/)) {
				const n = words(text(run)).length
				if (n > MAX_PROSE_RUN) long.push([id, n])
			}
		}
		expect(long).toEqual([])
	})
})

describe('the story is one chain of problems in plain words', () => {
	it('ends every concept by naming the problem the next heading asks', () => {
		// Chapter headings sit in the chain, so the last concept of a chapter leads to the next chapter.
		const all = items()
		const broken: string[] = []
		all.forEach((item, i) => {
			if (item.kind !== 'concept') return
			const bridge = /<p class="next">(.*?)<\/p>/.exec(item.html)
			const following = all[i + 1]
			if (following === undefined) {
				if (bridge) broken.push(`${item.id}: the last concept has nothing to hand over to`)
				return
			}
			if (!bridge) broken.push(`${item.id}: no bridge to "${following.heading}"`)
			else {
				const have = content(text(bridge[1] as string))
				const shared = [...content(following.heading)].filter((w) => have.has(w))
				if (shared.length < MIN_SHARED) broken.push(`${item.id}: its bridge does not lead to "${following.heading}"`)
			}
		})
		expect(broken).toEqual([])
	})

	it('uses short sentences in plain words', () => {
		const hard: Record<string, string> = {}
		for (const { id, html } of concepts()) {
			const s = story(html)
			const longest = Math.max(...sentences(s).map((x) => words(x).length))
			const ease = flesch(s)
			if (longest > MAX_SENTENCE_WORDS || ease < MIN_FLESCH) hard[id] = `longest sentence ${longest} words, reading ease ${Math.round(ease)}`
		}
		expect(hard, `max ${MAX_SENTENCE_WORDS} words a sentence, reading ease ${MIN_FLESCH} or more`).toEqual({})
	})

	it('bites: each gate fails on the thing it exists to stop', () => {
		expect(content('Which ideas are published?').size).toBeGreaterThan(0)
		const bridge = [...content('Which ideas are published?')].filter((w) => content('Where are ideas published').has(w))
		expect(bridge.length).toBe(2)
		expect(flesch('The cat sat on the mat. It was warm.')).toBeGreaterThan(MIN_FLESCH)
		expect(flesch('Notwithstanding organisational heterogeneity, instrumentation necessitates standardisation.')).toBeLessThan(MIN_FLESCH)
		expect(overlap('routing decides which skills every task receives', 'Routing decides which skills every task receives')).toBeGreaterThanOrEqual(MAX_OVERLAP)
		expect(overlap('the pager wakes someone eventually', 'Router skills')).toBeLessThan(MAX_OVERLAP)
		const phrase = 'one two three four five six seven'
		expect([...phrases(phrase)].filter((x) => phrases('zero one two three four five six').has(x)).length).toBe(1)
	})
})

describe('every code block in the workbook', () => {
	const blocks = [...page.matchAll(/<pre data-lang="([a-z]+)"( data-from="[^"]*")?>([\s\S]*?)<\/pre>/g)]
	it('names the lab file it is copied from', () => {
		expect(blocks.filter((m) => m[2] === undefined).map((m) => code(m[3] as string).split('\n')[0])).toEqual([])
	})
	it('is an exact copy of lines in that file', () => {
		const off: string[] = []
		for (const m of blocks) {
			const file = /data-from="([^"]*)"/.exec(m[2] ?? '')?.[1] ?? ''
			const path = join(ROOT, file)
			if (!existsSync(path)) {
				off.push(`${file} does not exist`)
				continue
			}
			const want = code(m[3] as string).replace(/^\n/, '').replace(/\n$/, '').split('\n')
			const have = readFileSync(path, 'utf8').split('\n')
			const found = have.some((_, i) => {
				const win = have.slice(i, i + want.length)
				if (win.length < want.length) return false
				const cut = Math.min(...win.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length))
				return win.every((l, k) => l.slice(cut).trimEnd() === (want[k] as string).trimEnd())
			})
			if (!found) off.push(`${file}: "${want[0]}" is not there as written`)
		}
		expect(off).toEqual([])
	})
})

describe('what the facilitator reads aloud', () => {
	// Goal, Say and Ask are spoken, so they get the workbook's rule for sentences.
	const guide = readFileSync(join(ROOT, 'guide.html'), 'utf8')
	const spoken = [...guide.matchAll(/<div class="part (?:goal|say|ask)" data-part="(?:goal|say|ask)">([\s\S]*?)(?=<div class="part |<\/section>)/g)].map((m) => text(m[1] as string).replace(/^\s*(Goal|Say|Ask)\s+/, ''))
	it('is read from every segment', () => {
		expect(spoken.length).toBeGreaterThan(200)
	})
	it('keeps every sentence to 22 words', () => {
		const long = spoken.flatMap((part) => sentences(part).filter((x) => words(x).length > MAX_SENTENCE_WORDS))
		expect(long).toEqual([])
	})
	it('reads easily as a whole', () => {
		expect(flesch(spoken.join(' '))).toBeGreaterThanOrEqual(MIN_FLESCH)
	})
})

describe('the latency budget figure', () => {
	it('draws the seconds steps/05-loop/budget.json allows each stage', () => {
		const budget = JSON.parse(readFileSync(join(ROOT, 'steps/05-loop/budget.json'), 'utf8')) as { stages: Record<string, { seconds: number }> }
		const spec = JSON.parse(readFileSync(join(ROOT, 'design/diagrams/stage-budget.json'), 'utf8')) as { rows: { label: string; cells: (string | { text: string })[] }[] }
		const drawn = Object.fromEntries(spec.rows.map((r) => [r.label.toLowerCase(), typeof r.cells[0] === 'string' ? r.cells[0] : r.cells[0]?.text]))
		for (const [name, { seconds }] of Object.entries(budget.stages)) {
			expect(drawn[name], `${name} in stage-budget.json`).toBe(seconds === 0 ? 'not bounded' : String(seconds))
		}
	})
})
