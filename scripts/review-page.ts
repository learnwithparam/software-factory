/**
 * The page for reading a run without re-running it.
 *
 * `make e2e` costs model spend and around half an hour. Reviewing what it
 * produced should cost neither, so this turns the evidence into one page: every
 * screenshot in the order the run took them, what it is meant to show, and the
 * assertion that proves it.
 *
 * Generated rather than written. A page of screenshots maintained by hand goes
 * stale the first time a spec changes, and a stale review page is worse than
 * none because it looks like evidence.
 *
 * It reports a missing picture as missing rather than omitting it. The gap is
 * the useful part: it is the difference between a run that covered everything
 * and a run that stopped early.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'

interface Shot {
	readonly name: string
	readonly spec: string
	readonly shows: string
	readonly mustShow?: string
}

interface Manifest {
	readonly screenshots: Shot[]
	readonly specs: string[]
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'teach', 'manifest.json'), 'utf8')) as Manifest

function escape(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** What the page said when the picture was taken, captured beside it by shot(). */
function said(name: string): string | undefined {
	const path = join(ROOT, 'evidence', 'screens', `${name}.txt`)
	return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

function card(shot: Shot): string {
	const png = join(ROOT, 'evidence', 'screens', `${shot.name}.png`)
	const text = said(shot.name)
	const taken = existsSync(png)
	const proves = shot.mustShow === undefined || (text !== undefined && text.includes(shot.mustShow))

	const verdict = !taken
		? { className: 'missing', label: 'not taken' }
		: text === undefined
			? { className: 'unproven', label: 'no page text beside it' }
			: proves
				? { className: 'proven', label: 'shows what it claims' }
				: { className: 'unproven', label: `the page never said ${shot.mustShow}` }

	const picture = taken
		? `<img src="evidence/screens/${escape(shot.name)}.png" alt="${escape(shot.shows)}" loading="lazy">`
		: `<p class="gap">This run did not take it. A gap here is the difference between a run that covered everything and one that stopped early.</p>`

	const claim = shot.mustShow === undefined
		? '<p class="claim">No page text is asserted for this one.</p>'
		: `<p class="claim">Asserted on screen: <code>${escape(shot.mustShow)}</code></p>`

	return `<figure class="shot ${verdict.className}" id="${escape(shot.name)}">
	${picture}
	<figcaption>
		<h3>${escape(shot.shows)}</h3>
		<p class="meta"><code>${escape(shot.name)}</code> &middot; taken by <code>${escape(shot.spec)}</code> &middot; <span class="verdict">${escape(verdict.label)}</span></p>
		${claim}
	</figcaption>
</figure>`
}

const bySpec = new Map<string, Shot[]>()
for (const shot of manifest.screenshots) {
	const list = bySpec.get(shot.spec) ?? []
	list.push(shot)
	bySpec.set(shot.spec, list)
}

const order = manifest.specs.filter((spec) => bySpec.has(spec))
const taken = manifest.screenshots.filter((shot) => existsSync(join(ROOT, 'evidence', 'screens', `${shot.name}.png`))).length
const proven = manifest.screenshots.filter((shot) => {
	const text = said(shot.name)
	return existsSync(join(ROOT, 'evidence', 'screens', `${shot.name}.png`)) && (shot.mustShow === undefined || (text !== undefined && text.includes(shot.mustShow)))
}).length

const sections = order
	.map((spec) => {
		const shots = bySpec.get(spec) ?? []
		return `<section>
<h2>${escape(spec)}</h2>
<div class="shots">
${shots.map(card).join('\n')}
</div>
</section>`
	})
	.join('\n')

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Software Factory: what the run produced</title>
<meta name="description" content="Every screenshot the end-to-end run took, in the order it took them, with what each is meant to show and whether the page said so.">
<link rel="stylesheet" href="teach/teach.css">
<style>
.shots { display: grid; gap: 2rem; }
.shot { margin: 0; border: 1px solid var(--c-line); border-radius: 6px; overflow: hidden; background: var(--c-bg); }
.shot img { display: block; width: 100%; height: auto; border-bottom: 1px solid var(--c-line); }
.shot figcaption { padding: 1rem 1.25rem; }
.shot h3 { margin: 0 0 .35rem; font-size: 1rem; }
.shot .meta, .shot .claim { margin: .2rem 0; color: var(--c-ink-muted); font-size: .85rem; }
.shot .gap { margin: 0; padding: 2rem 1.25rem; background: var(--c-bg-inset); color: var(--c-ink-muted); }
.verdict { font-weight: 600; }
.proven .verdict { color: var(--c-pass); }
.unproven .verdict, .missing .verdict { color: var(--c-fail); }
.tally { display: flex; gap: 2rem; padding: 1rem 1.25rem; background: var(--c-bg-inset); border-radius: 6px; }
.tally b { display: block; font-size: 1.6rem; }
</style>
</head>
<body>
<main>
<h1>What the run produced</h1>
<p>Every picture the end-to-end run took, in the order the specs take them. Each one carries what it
is meant to show and the phrase the page had to be saying when it was taken, so a screenshot of a
loading spinner or an empty board is reported rather than displayed as evidence.</p>

<div class="tally">
<div><b>${proven}</b> show what they claim</div>
<div><b>${taken - proven}</b> taken but unproven</div>
<div><b>${manifest.screenshots.length - taken}</b> not taken</div>
</div>

${sections}
</main>
</body>
</html>
`

writeFileSync(join(ROOT, 'review.html'), page)
console.log(`review.html: ${proven} proven, ${taken - proven} unproven, ${manifest.screenshots.length - taken} missing`)
