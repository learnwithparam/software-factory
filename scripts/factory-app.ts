/**
 * Create the GitHub App the Factory needs, in one click.
 *
 * GitHub can create an App from a manifest: you post a form describing the
 * permissions and callbacks, a person clicks Create once, and GitHub hands back
 * a temporary code that is exchanged for the App's id, private key and client
 * secret. That is the whole flow, and it beats filling in eleven form fields
 * and pasting a private key by hand.
 *
 * The credentials are written to ~/.config/lwp-secrets/factory.env and never
 * printed. Students run exactly this against their own organisation.
 */

import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { allowed, note, step, title, verdict, waiting } from '../steps/lib/out.ts'

const SECRETS = join(homedir(), '.config', 'lwp-secrets', 'factory.env')
const PORT = Number(process.env.FACTORY_APP_PORT ?? '4199')
const ORG = process.env.FACTORY_APP_ORG ?? 'learnwithparam'
const PUBLIC_URL = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'

/**
 * What the App is allowed to do.
 *
 * Issues and pull requests to read work and open changes, contents to read and
 * write a branch, and the three events the board reacts to. Nothing else: an
 * App with more permission than its job needs is the kind of thing nobody
 * notices until it matters.
 */
const manifest = {
	name: `Software Factory Lab (${ORG})`,
	url: 'https://github.com/learnwithparam/software-factory',
	hook_attributes: { url: `${PUBLIC_URL}/web/github/webhook`, active: true },
	redirect_url: `http://localhost:${PORT}/created`,
	callback_urls: [`${PUBLIC_URL}/auth/github/callback`],
	public: false,
	default_permissions: {
		contents: 'write',
		issues: 'write',
		pull_requests: 'write',
		metadata: 'read',
		checks: 'read',
	},
	default_events: ['issues', 'issue_comment', 'pull_request', 'pull_request_review', 'push'],
}

const form = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Create the GitHub App</title>
<style>
 body{font-family:system-ui,-apple-system,sans-serif;max-width:40rem;margin:6rem auto;padding:0 1.5rem;line-height:1.55;color:#16161A}
 h1{font-size:2rem;letter-spacing:-.02em;margin:0 0 .5rem}
 p{color:#55555E}
 button{font:inherit;font-weight:600;background:#16161A;color:#fff;border:0;border-radius:6px;padding:.7rem 1.2rem;cursor:pointer}
 ul{color:#55555E;font-size:.9rem} code{background:#EDEDE8;border-radius:3px;padding:.1em .35em}
</style></head><body>
<h1>Create the GitHub App</h1>
<p>This creates an App on <strong>${ORG}</strong> with only the permissions the factory needs, then
writes its credentials to your secrets file. You will be asked to install it afterwards; grant it
access to <code>agent-run-ledger</code> only.</p>
<ul>
 <li>Read and write: contents, issues, pull requests</li>
 <li>Read: metadata, checks</li>
 <li>Webhook: <code>${PUBLIC_URL}/web/github/webhook</code></li>
</ul>
<form action="https://github.com/organizations/${ORG}/settings/apps/new?state=factory-lab" method="post">
 <input type="hidden" name="manifest" value='${JSON.stringify(manifest).replaceAll("'", '&apos;')}'>
 <button type="submit">Create the App on ${ORG}</button>
</form>
</body></html>`

function saveSecrets(values: Record<string, string>): void {
	if (!existsSync(SECRETS)) {
		writeFileSync(SECRETS, '# Secrets for the local Mastra Factory. Never committed, never echoed.\n')
		chmodSync(SECRETS, 0o600)
	}
	const existing = readFileSync(SECRETS, 'utf8')
	const lines = existing.split('\n')
	let text = lines
		.filter((line) => !Object.keys(values).some((key) => line.startsWith(`${key}=`)))
		.join('\n')
	if (!text.endsWith('\n')) text += '\n'
	writeFileSync(SECRETS, text)
	for (const [key, value] of Object.entries(values)) {
		// A private key is multi-line; keeping it on one line with escapes is what
		// dotenv readers understand, and what the Factory's own schema expects.
		appendFileSync(SECRETS, `${key}=${value.replaceAll('\n', '\\n')}\n`)
	}
	chmodSync(SECRETS, 0o600)
}

title('GitHub App for the factory')
step(`organisation: ${ORG}`)
step(`webhook target: ${PUBLIC_URL}/web/github/webhook`)
note('Nothing is printed. The credentials go straight into your secrets file.')

const done = Promise.withResolvers<void>()

const server = Bun.serve({
	port: PORT,
	async fetch(request) {
		const url = new URL(request.url)
		if (url.pathname === '/') return new Response(form, { headers: { 'content-type': 'text/html' } })
		if (url.pathname !== '/created') return new Response('not found', { status: 404 })

		const code = url.searchParams.get('code')
		if (code === null) return new Response('GitHub returned no code', { status: 400 })

		const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
			method: 'POST',
			headers: { accept: 'application/vnd.github+json' },
		})
		if (!response.ok) {
			return new Response(`GitHub refused the exchange: ${response.status}`, { status: 500 })
		}
		const app = (await response.json()) as {
			id: number
			slug: string
			client_id: string
			client_secret: string
			pem: string
			webhook_secret: string
			html_url: string
		}

		saveSecrets({
			GITHUB_APP_ID: String(app.id),
			GITHUB_APP_SLUG: app.slug,
			GITHUB_APP_CLIENT_ID: app.client_id,
			GITHUB_APP_CLIENT_SECRET: app.client_secret,
			GITHUB_APP_PRIVATE_KEY: app.pem,
			GITHUB_APP_WEBHOOK_SECRET: app.webhook_secret,
		})

		setTimeout(() => done.resolve(), 500)
		return Response.redirect(`${app.html_url}/installations/new`, 302)
	},
})

waiting(`open http://localhost:${PORT} and click the button`)
note('GitHub will send you to the install page afterwards. Grant access to agent-run-ledger only.')

await done.promise
server.stop()

allowed('six GitHub App credentials written to the secrets file')
verdict('PASS', 'Finish the install in the browser, then run make factory-doctor.')
