import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
	title: 'Agent run ledger',
	description: 'What each agent run cost, where its time went, and how it ended.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
