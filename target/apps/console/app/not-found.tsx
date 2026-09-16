import Link from 'next/link'

export default function NotFound() {
	return (
		<main>
			<div className="wrap">
				<div className="empty">
					<h3>No run with that id</h3>
					<p>It may have been recorded under a different id, or never recorded at all.</p>
					<p>
						<Link href="/">Back to every run</Link>
					</p>
				</div>
			</div>
		</main>
	)
}
