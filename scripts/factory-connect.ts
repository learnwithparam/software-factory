/**
 * The one step a browser has to do, and what to click.
 *
 * Connecting GitHub is an OAuth flow against a real GitHub login, so it cannot
 * be done from a script and should not be: handing a script somebody's GitHub
 * session is exactly the kind of shortcut this workshop argues against.
 *
 * Everything either side of it is automated. This prints the click path, checks
 * the result, and says which part is still missing. Students run the same
 * command against their own organisation.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { allowed, note, step, title, verdict, waiting } from '../steps/lib/out.ts'

const BASE = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'
const EMAIL = process.env.FACTORY_USER_EMAIL ?? 'lab@learnwithparam.com'
const SECRETS = join(homedir(), '.config', 'lwp-secrets', 'factory.env')
const REPO = process.env.FACTORY_GITHUB_REPO ?? 'learnwithparam/agent-run-ledger'

export interface GithubStatus {
	enabled: boolean
	connected: boolean
	reason?: string
	installations?: unknown[]
}

let signedIn: Promise<string> | undefined

/**
 * Sign in and keep the cookie, which is what every authenticated call needs.
 *
 * Memoised per process. Better Auth rate-limits sign-in, so two callers in one
 * command earn a 429, and the second one reports whatever it was checking as
 * broken. The doctor hit exactly that the moment it grew a second signed-in
 * check.
 */
export async function session(): Promise<string> {
	if (signedIn === undefined) signedIn = signIn()
	return signedIn
}

async function signIn(): Promise<string> {
	const password = readFileSync(SECRETS, 'utf8')
		.split('\n')
		.map((line) => /^FACTORY_USER_PASSWORD=(.*)$/.exec(line.trim())?.[1])
		.find((value): value is string => value !== undefined)
		?.replace(/^["'](.*)["']$/, '$1')

	if (password === undefined) throw new Error(`no FACTORY_USER_PASSWORD in ${SECRETS}. Run make factory-user.`)

	const response = await fetch(`${BASE}/auth/api/sign-in/email`, {
		method: 'POST',
		// Better Auth refuses a request with no Origin, which is its protection
		// against a browser being tricked into making one. A script has to say
		// where it is pretending to be from.
		headers: { 'content-type': 'application/json', origin: BASE },
		body: JSON.stringify({ email: EMAIL, password }),
		signal: AbortSignal.timeout(15_000),
	})
	if (!response.ok) throw new Error(`sign-in answered ${response.status}`)
	return (response.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
}

export async function githubStatus(cookie: string): Promise<GithubStatus> {
	const response = await fetch(`${BASE}/web/github/status`, {
		headers: { cookie, accept: 'application/json' },
		signal: AbortSignal.timeout(10_000),
	})
	if (!response.ok) throw new Error(`github status answered ${response.status}`)
	return (await response.json()) as GithubStatus
}

if (import.meta.main) {
	title('Connecting the codebase')
	const cookie = await session()
	const status = await githubStatus(cookie)

	if (status.connected) {
		allowed(`GitHub is connected, ${status.installations?.length ?? 0} installation(s) visible`)
		const pointed = await pointIntakeAtSources(cookie)
		allowed(pointed)
		verdict('PASS', 'Nothing to do. Run make factory-doctor to check the rest.')
		process.exit(0)
	}

	waiting(`not connected yet (${status.reason ?? 'unknown'})`)
	note('The app is installed on the organisation. What is missing is the account link, which is an')
	note('OAuth flow against a real GitHub login and therefore a browser step.')

	title('What to click, once')
	step(`1. Open ${BASE}`)
	step(`2. Sign in as ${EMAIL}`)
	note(`   read the password with: grep FACTORY_USER_PASSWORD ${SECRETS}`)
	step('3. Create my first factory, then Connect GitHub, then authorise')
	step(`4. Choose ${REPO} as the codebase`)
	step('5. Settings, then Work Intake, then enable GitHub issues and select that repository')
	note('Then run this again. It checks rather than trusts.')

	verdict('NEEDS REVIEW', 'One browser step. Everything either side of it is automated.')
	process.exit(1)
}


/**
 * Point work intake at every repository the installation can see.
 *
 * Two consumers read `intake.config.github.sourceIds` and they disagree about
 * what is in it. The board matches it against the repository slug:
 *
 *     sourceIds.includes(repo.slug)
 *
 * and when that is false it has no active feed, so it draws "No intake sources"
 * and not one card, on every column. The server's intake sweep casts the same
 * field to uuid and leaves `invalid input syntax for type uuid` in a failures
 * array when it holds a slug.
 *
 * The slug wins, because the board is what a person looks at and what every
 * spec measures, while the sweep is the polling path this lab does not use:
 * work items arrive from the `issues.opened` webhook, and the sweep only
 * patches and closes items that already exist. Writing the uuid instead made
 * the sweep clean and the board empty, which cost a run and read exactly like
 * a broken factory.
 *
 * This is early access. If a later version casts the slug or matches the uuid,
 * one of the two reads above changes and this function is the place to see it.
 */
export async function pointIntakeAtSources(cookie: string): Promise<string> {
	const listed = await fetch(`${BASE}/web/intake/sources`, { headers: { cookie, accept: 'application/json' } })
	if (!listed.ok) throw new Error(`intake sources answered ${listed.status}`)
	const { sources } = (await listed.json()) as { sources: Array<{ id: string; name: string; integrationId: string }> }

	const github = sources.filter((source) => source.integrationId === 'github')
	if (github.length === 0) return 'no repositories visible to intake yet'

	// The slug, which is what the sources listing calls `name`.
	const written = await fetch(`${BASE}/web/intake/config`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json', origin: BASE, cookie },
		body: JSON.stringify({ github: { enabled: true, sourceIds: github.map((source) => source.name) } }),
	})
	if (!written.ok) throw new Error(`writing intake config answered ${written.status}`)

	// Read back what the board reads, because that is the consumer that decides
	// whether anything is visible. Checking the sweep instead reported a healthy
	// intake over an empty board.
	const confirm = await fetch(`${BASE}/web/intake/config`, { headers: { cookie, accept: 'application/json' } })
	const { config } = (await confirm.json()) as { config: { github: { enabled: boolean; sourceIds: string[] } } }
	const missing = github.map((source) => source.name).filter((name) => !config.github.sourceIds.includes(name))
	if (!config.github.enabled || missing.length > 0) {
		throw new Error(`the board would show no feed: intake config is missing ${missing.join(', ') || 'its enabled flag'}`)
	}

	// Reading the issues is not the same as putting them on a board. Without a
	// binding, intake lists six issues for ever and the board stays empty, which
	// looks exactly like an intake that cannot see them.
	const projectsResponse = await fetch(`${BASE}/web/factory/projects`, { headers: { cookie, accept: 'application/json' } })
	const { projects } = (await projectsResponse.json()) as { projects: Array<{ id: string; name: string }> }
	const project = projects.find((candidate) => candidate.name === REPO.split('/')[1]) ?? projects[0]
	if (project === undefined) return `intake reads ${github.map((source) => source.name).join(', ')}, and no project holds it yet`

	for (const source of github) {
		const bound = await fetch(`${BASE}/web/intake/bindings`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json', origin: BASE, cookie },
			body: JSON.stringify({ integrationId: 'github', sourceId: source.id, factoryProjectId: project.id, board: 'work' }),
		})
		if (!bound.ok) throw new Error(`binding ${source.name} answered ${bound.status}`)
	}

	return `intake reads ${github.map((source) => source.name).join(', ')} onto ${project.name}`
}
