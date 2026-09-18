/**
 * Step seven on stage: the same architecture, bought instead of built.
 *
 * Nothing runs a server here. The point is the mapping, and the mapping is
 * something to read side by side with what the room has already built.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { note, step, table, title, verdict } from '../lib/out.ts'
import { loadRepo } from '../lib/repo.ts'

const HERE = import.meta.dirname

const MAPPING: Array<[string, string, string]> = [
	['Boundary', ".factory/charter.md, read by policy.ts", 'transitionPolicy, allowing or rejecting a move'],
	['Context', '03-context/router.ts', 'the prompt an invokeSkill handler builds'],
	['Skills', 'skills/*.md, plus the repository own', 'invokeSkill with a skillName'],
	['Execution', '02-execution/worktree.ts', 'the sandbox callback, per session'],
	['Verification', '04-verification/gate.ts', 'a working phase plus a tool onResult rule'],
	['Delivery', '06-delivery/deliver.ts', 'the built-in Work and Review boards'],
]

title('The six layers, on a platform')
table(['layer', 'what you built', 'where it lands'], MAPPING.map(([a, b, c]) => [a, b, c]))
note('The names differ and the shape does not. That correspondence is what makes the buy decision an engineering decision.')

const repo = loadRepo()

title('The sentence that appears in both')
const charter = readFileSync(join(repo.root, '.factory', 'charter.md'), 'utf8')
const line = charter.split('\n').find((entry) => entry.includes('Nothing merges')) ?? ''
step(`charter: ${line.trim()}`)
const board = readFileSync(join(HERE, 'src', 'mastra', 'boards.ts'), 'utf8')
const policy = board.split('\n').find((entry) => entry.includes('Merging is never automated')) ?? ''
step(`board:   ${policy.trim().replace(/^reason: '|',$/g, '')}`)
note('Same rule, two substrates. Whichever you run, it is yours to state.')

title('What never transfers')
step('Which work may reach done without a person.')
step('Which work needs recorded acceptance before any code exists.')
step('Where the money path sits.')
note(`This repository is tier ${repo.charter.tier} with ${repo.charter.protectedPaths.length} protected paths. A platform has no opinion about any of them.`)

verdict('PASS', 'Read steps/07-mastra/README.md next to steps 01 to 06.')
process.exit(0)
