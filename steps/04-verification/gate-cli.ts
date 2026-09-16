/** Command line over gate.ts. See gates.sh for usage. */

import { loadRepo, filesIn, changedSince } from '../lib/repo.ts'
import { runGate } from './gate.ts'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
	const at = argv.indexOf(`--${name}`)
	return at === -1 ? undefined : argv[at + 1]
}

const repo = loadRepo(flag('repo'))
const paths = argv.includes('--all')
	? filesIn(repo.root)
	: flag('paths') !== undefined
		? (flag('paths') as string).split(',').filter(Boolean)
		: changedSince(repo.root, flag('since') ?? 'HEAD~1')

const result = runGate(repo, paths, {
	withoutTests: argv.includes('--without-tests'),
	onCheck: (target, name) => console.log(`run   ${target} ${name}`),
})

for (const run of result.runs) {
	if (run.skipped === true) console.log(`skip  ${run.target} ${run.name}`)
	else if (!run.passed) {
		for (const line of run.output.trim().split('\n').slice(-20)) console.log(`      ${line}`)
	}
}

console.log(`\n${result.line}`)
process.exit(result.exitCode)
