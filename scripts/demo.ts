/**
 * `make demo STEP=nn` runs one step's demonstration.
 *
 * Every step is runnable on its own, so a session can start anywhere without a
 * branch switch and without the six before it having been run first.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './tree-hash.ts'

const STEPS = join(ROOT, 'steps')

function available(): Array<{ number: string; name: string; path: string }> {
	return readdirSync(STEPS)
		.filter((name) => /^\d\d-/.test(name))
		.sort()
		.map((name) => ({
			number: name.slice(0, 2),
			name,
			path: join(STEPS, name, 'demo.ts'),
		}))
		.filter((step) => existsSync(step.path))
}

const [wanted, ...rest] = process.argv.slice(2)

if (wanted === undefined || wanted === '') {
	console.log('Pick a step:\n')
	for (const step of available()) console.log(`  make demo STEP=${step.number}   ${step.name}`)
	console.log('\nAdd arguments after a double dash: make demo STEP=06 -- refused')
	process.exit(available().length === 0 ? 1 : 0)
}

const step = available().find((candidate) => candidate.number === wanted.padStart(2, '0'))
if (step === undefined) {
	console.error(`no step ${wanted}. Available: ${available().map((s) => s.number).join(', ')}`)
	process.exit(2)
}

const result = Bun.spawnSync(['bun', step.path, ...rest], { cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'] })
process.exit(result.exitCode ?? 1)
