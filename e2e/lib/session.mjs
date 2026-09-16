import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const BASE = process.env.MASTRACODE_PUBLIC_URL ?? 'http://localhost:4111'
export const EMAIL = process.env.FACTORY_USER_EMAIL ?? 'lab@learnwithparam.com'

export function secrets() {
  const path = join(homedir(), '.config', 'lwp-secrets', 'factory.env')
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["'](.*)["']$/, '$1')]),
  )
}

/** Sign in through the API so a page loads already authenticated. */
export async function signIn(page) {
  const response = await page.request.post(`${BASE}/auth/api/sign-in/email`, {
    data: { email: EMAIL, password: secrets().FACTORY_USER_PASSWORD },
  })
  if (!response.ok()) throw new Error(`sign-in answered ${response.status()}`)
  return response
}
