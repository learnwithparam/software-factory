import type { NextConfig } from 'next'

const config: NextConfig = {
	// The console reads the ledger at request time. Nothing here is prerendered,
	// because a cached page would show a run count that is quietly out of date.
	experimental: { typedRoutes: true },
}

export default config
