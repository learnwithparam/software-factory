/**
 * Create the local sign-in for this machine.
 *
 * Better Auth keeps users in this deployment's own database, so the account is
 * made by asking the server rather than by signing up to anything. The password
 * is generated here, written to the secrets file, and never printed: a password
 * on a command line lands in shell history, in transcripts, and in a permission
 * prompt that captures the whole line.
 *
 * Running it twice is not an error. The second run signs in with the password
 * already on disk and reports that the account is there.
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { allowed, failed, note, step, title, verdict } from '../steps/lib/out.ts'

const SECRETS = join(homedir(), '.config', 'lwp-secrets', 'factory.env')
const BASE = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'
const EMAIL = process.env.FACTORY_USER_EMAIL ?? 'lab@learnwithparam.com'

function secrets(): Record<string, string> {
	if (!existsSync(SECRETS)) return {}
	return Object.fromEntries(
		readFileSync(SECRETS, 'utf8')
			.split('\n')
			.map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim()))
			.filter((match): match is RegExpExecArray => match !== null)
			.map((match) => [match[1] as string, match[2] as string]),
	)
}

function remember(key: string, value: string): void {
	if (!existsSync(SECRETS)) {
		writeFileSync(SECRETS, '# Secrets for the local Mastra Factory. Never committed, never echoed.\n')
	}
	appendFileSync(SECRETS, `${key}=${value}\n`)
	chmodSync(SECRETS, 0o600)
}

async function post(path: string, body: unknown): Promise<{ status: number; text: string }> {
	const response = await fetch(`${BASE}/auth/api${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(20_000),
	})
	return { status: response.status, text: (await response.text()).slice(0, 400) }
}

title('The local sign-in for this machine')
step(`server: ${BASE}`)
step(`email:  ${EMAIL}`)

const existing = secrets()
let password = existing.FACTORY_USER_PASSWORD
if (password === undefined || password === '') {
	password = randomBytes(18).toString('base64url')
	remember('FACTORY_USER_PASSWORD', password)
	note('generated a password and wrote it to the secrets file')
} else {
	note('using the password already in the secrets file')
}

const signUp = await post('/sign-up/email', { email: EMAIL, password, name: 'Workshop' })
if (signUp.status < 300) {
	allowed('account created')
} else {
	note(`sign-up answered ${signUp.status}, trying to sign in instead`)
	const signIn = await post('/sign-in/email', { email: EMAIL, password })
	if (signIn.status >= 300) {
		failed(`sign-in answered ${signIn.status}`)
		note(signIn.text)
		verdict('FAIL', 'Neither creating nor using the account worked. Read the server log.')
		process.exit(1)
	}
	allowed('account already existed and the stored password works')
}

const me = await fetch(`${BASE}/auth/me`, { signal: AbortSignal.timeout(10_000) })
const body = (await me.json()) as { provider?: string }
allowed(`the server reports its provider as ${body.provider}`)
verdict('PASS', `Sign in at ${BASE} with ${EMAIL} and the password in ${SECRETS}.`)
