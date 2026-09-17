/**
 * Ask the local Factory, and try again when the connection drops.
 *
 * A Factory running sandboxes beside a browser stops answering for a second now
 * and then, and Node reports that as a bare "TypeError: fetch failed" or an
 * ECONNRESET. Three runs of the rejection route died that way, twice six minutes
 * in and once at ten, with the work itself perfectly fine.
 *
 * Only the connection is retried. An HTTP status is the server's answer, and
 * asking a 422 again just asks the same wrong question.
 *
 * One copy, because the first version of this lived in the end-to-end driver
 * only, and the next dropped connection arrived through the other fetch path.
 */

export async function reach(url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
	let last: unknown
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			return await fetch(url, init)
		} catch (error) {
			last = error
			await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
		}
	}
	const said = (last as { message?: string; cause?: { message?: string } })
	throw new Error(`${init.method ?? 'GET'} ${url} never reached the server: ${said.cause?.message ?? said.message ?? String(last)}`)
}
