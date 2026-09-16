/** Write every surface's generated token stylesheet. Run by `make tokens`. */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { renderCss, tokens } from './tokens.ts'
import { ROOT } from './tree-hash.ts'

const t = tokens()
for (const surface of t.surfaces) {
	const path = join(ROOT, surface.out)
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, renderCss(t, surface.name))
	console.log(`wrote ${surface.out}`)
}
