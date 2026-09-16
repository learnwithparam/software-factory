/** Durations for a room. Seconds below a minute, then minutes and seconds. */
export function humanish(ms: number): string {
	const seconds = Math.round(ms / 1000)
	if (seconds < 60) return `${seconds}s`
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
