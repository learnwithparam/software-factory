/** What the page shows when the ledger cannot be reached. */
export function Unreachable({ reason }: { reason: string }) {
	return (
		<div className="empty">
			<h3>The ledger is not answering</h3>
			<p>{reason}</p>
			<p>
				Start it with <code>make demo STEP=06</code>, or run the ingest service directly with{' '}
				<code>go run ./cmd/server</code> in <code>target/services/ingest</code>.
			</p>
		</div>
	)
}

/** What the page shows when the ledger answers and has nothing in it yet. */
export function NoRuns() {
	return (
		<div className="empty">
			<h3>No runs recorded yet</h3>
			<p>A run appears here the moment the factory claims its first work item.</p>
		</div>
	)
}
