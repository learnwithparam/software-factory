package ingest

// Seed builds a store with runs that show every outcome the contract allows,
// including a refused one. A demonstration without a refusal teaches the wrong
// lesson, so the seed data carries one.
func Seed() *Store {
	s := NewStore()
	runs := []Run{
		{ID: "run-101", Item: "console-empty-state", Outcome: "passed", StartedAt: "2026-09-15T09:02:00Z", EndedAt: "2026-09-15T09:09:30Z", TokensIn: 41200, TokensOut: 5100, CostMinor: 74, Currency: "EUR"},
		{ID: "run-102", Item: "stage-waterfall-overflow", Outcome: "failed", StartedAt: "2026-09-15T10:14:00Z", EndedAt: "2026-09-15T10:37:10Z", TokensIn: 96800, TokensOut: 11400, CostMinor: 181, Currency: "EUR"},
		{ID: "run-103", Item: "tier-discount-rounding", Outcome: "refused", StartedAt: "2026-09-15T11:01:00Z", EndedAt: "2026-09-15T11:01:40Z", TokensIn: 3100, TokensOut: 260, CostMinor: 5, Currency: "EUR"},
		{ID: "run-104", Item: "run-list-keyset-paging", Outcome: "escalated", StartedAt: "2026-09-15T13:22:00Z", EndedAt: "2026-09-15T14:05:00Z", TokensIn: 154300, TokensOut: 19600, CostMinor: 296, Currency: "EUR"},
		{ID: "run-105", Item: "contract-add-tool-calls", Outcome: "passed", StartedAt: "2026-09-16T08:41:00Z", EndedAt: "2026-09-16T08:58:20Z", TokensIn: 88400, TokensOut: 12900, CostMinor: 168, Currency: "EUR"},
	}
	for _, r := range runs {
		_ = s.PutRun(r)
	}
	stages := []Stage{
		{RunID: "run-101", Name: "claim", StartedAt: "2026-09-15T09:02:00Z", EndedAt: "2026-09-15T09:02:04Z", ToolCalls: 1},
		{RunID: "run-101", Name: "context", StartedAt: "2026-09-15T09:02:04Z", EndedAt: "2026-09-15T09:02:31Z", ToolCalls: 4},
		{RunID: "run-101", Name: "implement", StartedAt: "2026-09-15T09:02:31Z", EndedAt: "2026-09-15T09:05:02Z", ToolCalls: 17},
		{RunID: "run-101", Name: "gates", StartedAt: "2026-09-15T09:05:02Z", EndedAt: "2026-09-15T09:07:18Z", ToolCalls: 3},
		{RunID: "run-101", Name: "verify", StartedAt: "2026-09-15T09:07:18Z", EndedAt: "2026-09-15T09:09:30Z", ToolCalls: 9},
		{RunID: "run-102", Name: "claim", StartedAt: "2026-09-15T10:14:00Z", EndedAt: "2026-09-15T10:14:03Z", ToolCalls: 1},
		{RunID: "run-102", Name: "context", StartedAt: "2026-09-15T10:14:03Z", EndedAt: "2026-09-15T10:14:35Z", ToolCalls: 5},
		{RunID: "run-102", Name: "implement", StartedAt: "2026-09-15T10:14:35Z", EndedAt: "2026-09-15T10:21:10Z", ToolCalls: 24},
		{RunID: "run-102", Name: "gates", StartedAt: "2026-09-15T10:21:10Z", EndedAt: "2026-09-15T10:26:44Z", ToolCalls: 6},
		{RunID: "run-102", Name: "verify", StartedAt: "2026-09-15T10:26:44Z", EndedAt: "2026-09-15T10:37:10Z", ToolCalls: 21},
		{RunID: "run-103", Name: "claim", StartedAt: "2026-09-15T11:01:00Z", EndedAt: "2026-09-15T11:01:03Z", ToolCalls: 1},
		{RunID: "run-103", Name: "context", StartedAt: "2026-09-15T11:01:03Z", EndedAt: "2026-09-15T11:01:40Z", ToolCalls: 2},
		{RunID: "run-104", Name: "claim", StartedAt: "2026-09-15T13:22:00Z", EndedAt: "2026-09-15T13:22:05Z", ToolCalls: 1},
		{RunID: "run-104", Name: "context", StartedAt: "2026-09-15T13:22:05Z", EndedAt: "2026-09-15T13:22:48Z", ToolCalls: 6},
		{RunID: "run-104", Name: "implement", StartedAt: "2026-09-15T13:22:48Z", EndedAt: "2026-09-15T13:41:02Z", ToolCalls: 52},
		{RunID: "run-104", Name: "gates", StartedAt: "2026-09-15T13:41:02Z", EndedAt: "2026-09-15T13:52:30Z", ToolCalls: 12},
		{RunID: "run-104", Name: "verify", StartedAt: "2026-09-15T13:52:30Z", EndedAt: "2026-09-15T14:05:00Z", ToolCalls: 28},
		{RunID: "run-105", Name: "claim", StartedAt: "2026-09-16T08:41:00Z", EndedAt: "2026-09-16T08:41:04Z", ToolCalls: 1},
		{RunID: "run-105", Name: "context", StartedAt: "2026-09-16T08:41:04Z", EndedAt: "2026-09-16T08:41:39Z", ToolCalls: 5},
		{RunID: "run-105", Name: "implement", StartedAt: "2026-09-16T08:41:39Z", EndedAt: "2026-09-16T08:48:12Z", ToolCalls: 31},
		{RunID: "run-105", Name: "gates", StartedAt: "2026-09-16T08:48:12Z", EndedAt: "2026-09-16T08:53:40Z", ToolCalls: 9},
		{RunID: "run-105", Name: "verify", StartedAt: "2026-09-16T08:53:40Z", EndedAt: "2026-09-16T08:58:20Z", ToolCalls: 14},
	}
	for _, st := range stages {
		_ = s.AddStage(st)
	}
	return s
}
