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
verdict('PASS', 'The provider is configured. Select it as the factory default in Settings, or let the next command do it.')
