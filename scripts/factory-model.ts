/**
 * Give the factory a model, without a key ever reaching a terminal.
 *
 * The provider key is read from the secrets file and sent straight to the
 * server, which encrypts it at rest with the credential encryption key. Nothing
 * is printed but the provider name and the model chosen.
 *
 * Students run the same command with their own provider. The model is a setting
 * rather than a code change, which is the whole argument for the executor being
 * an interface.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { allowed, failed, note, step, table, title, verdict } from '../steps/lib/out.ts'
import { session } from './factory-connect.ts'

const BASE = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'
const SECRETS = join(homedir(), '.config', 'lwp-secrets', 'factory.env')
const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

/** Provider, the secret that unlocks it, and the model the sessions use. */
const CHOICE = {
	provider: process.env.FACTORY_PROVIDER ?? 'openrouter',
	secret: process.env.FACTORY_PROVIDER_SECRET ?? 'OPENROUTER_API_KEY',
	model: process.env.FACTORY_MODEL ?? 'deepseek/deepseek-v4-flash',
}

function secret(name: string): string | undefined {
	return readFileSync(SECRETS, 'utf8')
		.split('\n')
		.map((line) => new RegExp(`^${name}=(.*)$`).exec(line.trim())?.[1])
		.find((value): value is string => value !== undefined)
		?.replace(/^["'](.*)["']$/, '$1')
}

title('Giving the factory a model')
step(`provider: ${CHOICE.provider}`)
step(`model:    ${CHOICE.model}`)

const key = secret(CHOICE.secret)
if (key === undefined || key === '') {
	failed(`${CHOICE.secret} is not in ${SECRETS}`)
	verdict('MISCONFIGURED', 'Put the key there. It is never passed on a command line.')
	process.exit(2)
}

const cookie = await session()

const set = await fetch(`${BASE}/web/config/providers/${CHOICE.provider}/key`, {
	method: 'PUT',
	headers: { 'content-type': 'application/json', origin: BASE, cookie },
	body: JSON.stringify({ key }),
	signal: AbortSignal.timeout(20_000),
})
if (!set.ok) {
	failed(`the server answered ${set.status} storing the key`)
	note((await set.text()).slice(0, 300))
	verdict('FAIL', 'The key was not stored.')
	process.exit(1)
}
allowed('key stored, encrypted at rest by the server')

const listed = await fetch(`${BASE}/web/config/models`, { headers: { cookie, accept: 'application/json' } })
const { models } = (await listed.json()) as { models: Array<{ id?: string; modelId?: string }> }
const ids = models.map((m) => m.id ?? m.modelId ?? '').filter(Boolean)

if (ids.length === 0) {
	failed('the provider is configured and offers no models')
	verdict('FAIL', 'Check the key is valid for this provider.')
	process.exit(1)
}
allowed(`${ids.length} models available`)

const wanted = ids.find((id) => id === CHOICE.model || id.endsWith(`/${CHOICE.model}`) || id === `${CHOICE.provider}/${CHOICE.model}`)
if (wanted === undefined) {
	failed(`${CHOICE.model} is not among them`)
	table(['closest matches'], ids.filter((id) => id.includes('deepseek')).slice(0, 8).map((id) => [id]))
	verdict('FAIL', 'Pick one the provider actually offers.')
	process.exit(1)
}

allowed(`${wanted} is available`)

/**
 * Select it as the project default.
 *
 * Storing the key is not enough: a project with no defaultModelId falls back to
 * openai, and the first triage dies with "No usable openai credential is
 * configured". That failure cost a run, so this step is no longer a sentence
 * telling somebody to click Settings.
 */
const projects = await fetch(`${BASE}/web/factory/projects`, { headers: { cookie, accept: 'application/json' } })
if (!projects.ok) {
	failed(`the server answered ${projects.status} listing projects`)
	verdict('FAIL', 'The model was not selected.')
	process.exit(1)
}
const { projects: found } = (await projects.json()) as { projects: Array<{ id: string; name: string; defaultModelId: string | null }> }
const project = found.find((p) => p.name === REPO.split('/')[1]) ?? found[0]
if (project === undefined) {
	failed('no factory project exists yet')
	verdict('NEEDS REVIEW', 'Run make factory-connect and create the factory first.')
	process.exit(1)
}

const patched = await fetch(`${BASE}/web/factory/projects/${project.id}`, {
	method: 'PATCH',
	headers: { 'content-type': 'application/json', origin: BASE, cookie },
	body: JSON.stringify({ defaultModelId: wanted }),
	signal: AbortSignal.timeout(20_000),
})
if (!patched.ok) {
	failed(`the server answered ${patched.status} selecting the model`)
	note((await patched.text()).slice(0, 300))
	verdict('FAIL', 'The model was not selected.')
	process.exit(1)
}

// Read it back. A 200 is the server's claim; this is the fact.
const confirm = await fetch(`${BASE}/web/factory/projects/${project.id}`, { headers: { cookie, accept: 'application/json' } })
const { project: saved } = (await confirm.json()) as { project: { defaultModelId: string | null } }
if (saved.defaultModelId !== wanted) {
	failed(`the project still reads ${saved.defaultModelId ?? 'no model'}`)
	verdict('FAIL', 'The model was not selected.')
	process.exit(1)
}

table(['project', 'default model'], [[project.name, saved.defaultModelId]])
verdict('PASS', 'The provider is configured and the factory runs on it. No Settings click needed.')
