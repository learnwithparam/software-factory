import Link from 'next/link'
import { notFound } from 'next/navigation'
import { durationMs, formatMinor } from '@ledger/contracts'
import { humanMs, readRun, slowestStage, waterfall } from '@/lib/ledger.ts'
import { Unreachable } from '@/components/empty.tsx'
import { OutcomeChip } from '@/components/state.tsx'

export const dynamic = 'force-dynamic'

/** What each stage is, in one line, for a reader who has not seen the loop before. */
const MEANING: Record<string, string> = {
	claim: 'Taking ownership of the item so a second run cannot start on it',
	context: 'Assembling the rules, skills and task detail this work needs',
	implement: 'Making the change inside an isolated workspace',
	gates: 'Running the checks that decide pass, fail or misconfigured',
	verify: 'An independent read of the diff, with no account of the attempt',
	human: 'Waiting for a person, which is usually the largest number here',
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params

	let detail
	try {
		detail = await readRun(id)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (message.includes('404')) notFound()
		return <Unreachable reason={message} />
	}

	const { run, stages } = detail
	const bars = waterfall(stages)
	const slowest = slowestStage(bars)
	const measured = bars.reduce((sum, bar) => sum + bar.ms, 0)
	const wall = durationMs(run.startedAt, run.endedAt)

	return (
		<>
			<header className="mast">
				<div className="wrap">
					<Link className="back" href="/">
						&larr; every run
					</Link>
					<h1>{run.item}</h1>
					<p className="lede">
						<OutcomeChip outcome={run.outcome} /> {humanMs(wall)} from claim to stop,{' '}
						{formatMinor(run.costMinor, run.currency)}, {(run.tokensIn + run.tokensOut).toLocaleString('en')}{' '}
						tokens.
					</p>
				</div>
			</header>

			<main>
				<div className="wrap">
					<h2>Stages</h2>
					<p className="note">
						Bars are shares of measured time, not of the wall clock, so a gap between stages is not
						quietly absorbed into the stage beside it.
					</p>

					{bars.length === 0 ? (
						<div className="empty">
							<h3>This run recorded no stages</h3>
							<p>It stopped before any stage completed, which is what a refusal looks like here.</p>
						</div>
					) : (
						<>
							<div className="waterfall">
								{bars.map((bar) => (
									<div key={bar.name} className={`bar${bar.name === slowest?.name ? ' slowest' : ''}`}>
										<span className="name" title={MEANING[bar.name]}>
											{bar.name}
										</span>
										<span className="track">
											<span className="fill" style={{ width: `${(bar.share * 100).toFixed(2)}%` }} />
										</span>
										<span className="ms">{humanMs(bar.ms)}</span>
										<span className="calls">{bar.toolCalls} calls</span>
									</div>
								))}
							</div>

							{slowest ? (
								<p className="callout">
									<strong>{slowest.name}</strong> took {humanMs(slowest.ms)}, which is{' '}
									{Math.round(slowest.share * 100)} percent of the measured time.{' '}
									{MEANING[slowest.name]}.
								</p>
							) : null}

							{wall > measured ? (
								<p className="callout">
									<strong>{humanMs(wall - measured)}</strong> of this run is not inside any stage. Time
									that no stage claims is usually setup, queueing, or a person who has not looked yet.
								</p>
							) : null}
						</>
					)}
				</div>
			</main>

			<footer>
				<div className="wrap">
					<p>Run {run.id}, claimed {run.startedAt}.</p>
				</div>
			</footer>
		</>
	)
}
