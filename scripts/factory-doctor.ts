/**
 * Is this machine ready to run a factory in front of a room?
 *
 * Every check says what is missing and what to do about it, because the point
 * of running this twenty minutes before a session is to have time to fix things.
 * It never prints a secret, only whether one is present.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { allowed, failed, note, title, verdict, waiting } from '../steps/lib/out.ts'
import { session } from './factory-connect.ts'

export const SECRETS = join(homedir(), '.config', 'lwp-secrets', 'factory.env')
const MASTRA = join(import.meta.dir, '..', '..', 'mastra')
const FACTORY_URL = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'

interface Check {
	readonly what: string
	readonly run: () => Promise<{ ok: boolean; detail: string; fix?: string }>
}

function secretNames(): Set<string> {
	if (!existsSync(SECRETS)) return new Set()
	return new Set(
		readFileSync(SECRETS, 'utf8')
			.split('\n')
			.map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
			.filter((name): name is string => name !== undefined),
	)
}

async function reachable(url: string, timeoutMs = 3000): Promise<number | undefined> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
		return response.status
	} catch {
		return undefined
	}
}

function command(...args: string[]): { ok: boolean; out: string } {
	const result = Bun.spawnSync(args)
	return {
		ok: result.exitCode === 0,
		out: new TextDecoder().decode(result.stdout).trim(),
	}
}

const CHECKS: Check[] = [
	{
		what: 'the Factory project is generated',
		run: async () => ({
			ok: existsSync(join(MASTRA, 'src', 'mastra', 'index.ts')),
			detail: MASTRA,
			fix: 'bunx create-factory@0.1.18 mastra --no-platform, from the grouping folder',
		}),
	},
	{
		what: 'its backing services are up',
		run: async () => {
			const ps = command('docker', 'compose', '-f', join(MASTRA, 'docker-compose.yml'), 'ps', '--format', '{{.Name}} {{.State}}')
			const running = ps.out.split('\n').filter((line) => line.includes('running')).length
			return {
				ok: running >= 2,
				detail: running === 0 ? 'neither postgres nor redis is running' : `${running} running`,
				fix: 'make factory-up',
			}
		},
	},
	{
		what: 'a model provider key is present',
		run: async () => {
			const names = secretNames()
			const found = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'].filter((name) => names.has(name))
			return {
				ok: found.length > 0,
				detail: found.length > 0 ? `${found.join(', ')} set` : `none in ${SECRETS}`,
				fix: `put ANTHROPIC_API_KEY= or OPENROUTER_API_KEY= in ${SECRETS}`,
			}
		},
	},
	{
		what: 'the credential encryption key is present',
		run: async () => ({
			ok: secretNames().has('FACTORY_CREDENTIAL_ENCRYPTION_KEY'),
			detail: secretNames().has('FACTORY_CREDENTIAL_ENCRYPTION_KEY') ? 'set' : `missing from ${SECRETS}`,
			fix: `openssl rand -base64 32, saved as FACTORY_CREDENTIAL_ENCRYPTION_KEY in ${SECRETS}`,
		}),
	},
	{
		what: 'the GitHub App credentials are present',
		run: async () => {
			const names = secretNames()
			const need = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'GITHUB_APP_SLUG', 'GITHUB_APP_WEBHOOK_SECRET']
			const missing = need.filter((name) => !names.has(name))
			return {
				ok: missing.length === 0,
				detail: missing.length === 0 ? 'all six set' : `missing ${missing.join(', ')}`,
				fix: 'make factory-app, which walks the GitHub App manifest flow',
			}
		},
	},
	{
		what: 'the Factory server answers',
		run: async () => {
			// With authentication on, an unauthenticated request to the root is
			// supposed to be refused. A 401 means the server is up and doing its
			// job, and treating it as a failure sends you hunting for a fault that
			// is not there.
			const status = await reachable(FACTORY_URL)
			return {
				ok: status === 200 || status === 401 || status === 403,
				detail: status === undefined ? `nothing on ${FACTORY_URL}` : `${status} from ${FACTORY_URL}`,
				fix: 'make factory-up',
			}
		},
	},
	{
		what: 'the local account can sign in',
		run: async () => {
			// Not "is somebody signed in": this runs without a browser, so nobody
			// ever is. What matters is that the account exists and the password on
			// disk still opens it, which is what a session will need.
			try {
				const me = await fetch(`${FACTORY_URL}/auth/me`, { signal: AbortSignal.timeout(3000) })
				if (!(me.headers.get('content-type') ?? '').includes('json')) {
					return {
						ok: false,
						detail: 'the auth endpoint returns HTML, so the interface will spin forever',
						fix: 'set BETTER_AUTH_SECRET so the server has a provider',
					}
				}
				const provider = ((await me.json()) as { provider?: string }).provider ?? 'none'

				const password = readFileSync(SECRETS, 'utf8')
					.split('\n')
					.map((line) => /^FACTORY_USER_PASSWORD=(.*)$/.exec(line.trim())?.[1])
					.find((value): value is string => value !== undefined)
					?.replace(/^["'](.*)["']$/, '$1')

				if (password === undefined) {
					return { ok: false, detail: `no account yet (${provider})`, fix: 'make factory-user' }
				}

				// Through session(), not a second raw sign-in. Better Auth rate-limits
				// the endpoint, so a doctor that signs in once per check fails its own
				// later checks with a 429 and blames the thing it was inspecting.
				try {
					await session()
					return { ok: true, detail: `${provider}, and the stored password works`, fix: 'make factory-user' }
				} catch (error) {
					return { ok: false, detail: `${provider}, but ${(error as Error).message}`, fix: 'make factory-user' }
				}
			} catch {
				return { ok: false, detail: 'no answer', fix: 'make factory-up' }
			}
		},
	},
	{
		what: 'the factory has a default model selected',
		run: async () => {
			// A project with no defaultModelId does not refuse to run. It falls back
			// to openai, and the first triage dies with "No usable openai credential
			// is configured" twenty minutes into a session. Storing the provider key
			// is not the same as choosing the model, and only this check says so.
			try {
				const cookie = await session()
				const listed = await fetch(`${FACTORY_URL}/web/factory/projects`, {
					headers: { cookie, accept: 'application/json' },
					signal: AbortSignal.timeout(10_000),
				})
				if (!listed.ok) return { ok: false, detail: `listing projects answered ${listed.status}`, fix: 'make factory-connect' }

				const { projects } = (await listed.json()) as { projects: Array<{ name: string; defaultModelId: string | null }> }
				if (projects.length === 0) return { ok: false, detail: 'no factory project exists yet', fix: 'make factory-connect' }

				const unset = projects.filter((project) => project.defaultModelId === null)
				return {
					ok: unset.length === 0,
					detail: unset.length === 0
						? projects.map((project) => `${project.name} runs on ${project.defaultModelId}`).join(', ')
						: `${unset.map((project) => project.name).join(', ')} would fall back to openai`,
					fix: 'make factory-model',
				}
			} catch (error) {
				// Never a bare "could not ask". A 429 from Better Auth's sign-in limit
				// once read here as "no model selected", which sends somebody to fix a
				// setting that was already correct.
				return { ok: false, detail: (error as Error).message, fix: 'make factory-up' }
			}
		},
	},
	{
		what: 'the repository it works on has its six issues open',
		run: async () => {
			const open = command('gh', 'issue', 'list', '--repo', 'learnwithparam/agent-run-ledger', '--state', 'open', '--json', 'number', '--jq', 'length')
			return {
				ok: open.ok && Number(open.out) === 6,
				detail: open.ok ? `${open.out} open` : 'gh could not read the repository',
				fix: 'make lab-reset',
			}
		},
	},
]

title('Factory doctor')
let blocked = 0
for (const check of CHECKS) {
	const result = await check.run()
	if (result.ok) allowed(`${check.what}: ${result.detail}`)
	else {
		blocked += 1
		waiting(`${check.what}: ${result.detail}`)
		if (result.fix) note(`fix: ${result.fix}`)
	}
}

if (blocked === 0) {
	verdict('PASS', 'Ready to run a session.')
	process.exit(0)
}
failed(`${blocked} of ${CHECKS.length} checks are not ready`)
verdict('MISCONFIGURED', 'Fix the lines above before the room arrives.')
process.exit(1)
