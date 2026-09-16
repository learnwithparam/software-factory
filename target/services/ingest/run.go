// Package ingest accepts agent run records and the timed stages inside them.
//
// It is deliberately in memory. The lab is about the system around a coding
// agent, and a database here would add operational detail without adding a
// single teaching point.
package ingest

import (
	"errors"
	"sort"
	"time"
)

// Run mirrors packages/contracts/schema/run.schema.json.
// contract_test.go asserts the json tags below equal that schema's properties.
type Run struct {
	ID        string `json:"id"`
	Item      string `json:"item"`
	Outcome   string `json:"outcome"`
	StartedAt string `json:"startedAt"`
	EndedAt   string `json:"endedAt"`
	TokensIn  int    `json:"tokensIn"`
	TokensOut int    `json:"tokensOut"`
	CostMinor int    `json:"costMinor"`
	Currency  string `json:"currency"`
}

// Stage mirrors packages/contracts/schema/stage.schema.json.
type Stage struct {
	RunID     string `json:"runId"`
	Name      string `json:"name"`
	StartedAt string `json:"startedAt"`
	EndedAt   string `json:"endedAt"`
	ToolCalls int    `json:"toolCalls"`
}

var (
	ErrUnknownRun      = errors.New("no run with that id")
	ErrUnknownOutcome  = errors.New("outcome is not one the contract allows")
	ErrUnknownStage    = errors.New("stage name is not one the contract allows")
	ErrBadInstant      = errors.New("an instant is not RFC 3339")
	ErrEndsBeforeStart = errors.New("ended before it started")
	ErrNegativeCount   = errors.New("a count cannot be negative")
)

var outcomes = map[string]bool{"passed": true, "failed": true, "refused": true, "escalated": true}

var stageNames = map[string]bool{
	"claim": true, "context": true, "implement": true,
	"gates": true, "verify": true, "human": true,
}

// Store holds runs and their stages, newest run first when listed.
type Store struct {
	runs   map[string]Run
	stages map[string][]Stage
	order  []string
}

func NewStore() *Store {
	return &Store{runs: map[string]Run{}, stages: map[string][]Stage{}}
}

func window(startedAt, endedAt string) error {
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return ErrBadInstant
	}
	end, err := time.Parse(time.RFC3339, endedAt)
	if err != nil {
		return ErrBadInstant
	}
	if end.Before(start) {
		return ErrEndsBeforeStart
	}
	return nil
}

// PutRun records a run, replacing an earlier record with the same id. Recording
// the same run twice is how a retried delivery behaves, so it must not duplicate.
func (s *Store) PutRun(r Run) error {
	if !outcomes[r.Outcome] {
		return ErrUnknownOutcome
	}
	if err := window(r.StartedAt, r.EndedAt); err != nil {
		return err
	}
	if r.TokensIn < 0 || r.TokensOut < 0 || r.CostMinor < 0 {
		return ErrNegativeCount
	}
	if _, seen := s.runs[r.ID]; !seen {
		s.order = append(s.order, r.ID)
	}
	s.runs[r.ID] = r
	return nil
}

// AddStage appends a stage to a run that already exists.
func (s *Store) AddStage(st Stage) error {
	if _, ok := s.runs[st.RunID]; !ok {
		return ErrUnknownRun
	}
	if !stageNames[st.Name] {
		return ErrUnknownStage
	}
	if err := window(st.StartedAt, st.EndedAt); err != nil {
		return err
	}
	if st.ToolCalls < 0 {
		return ErrNegativeCount
	}
	s.stages[st.RunID] = append(s.stages[st.RunID], st)
	return nil
}

// Runs lists every run, most recently started first.
func (s *Store) Runs() []Run {
	out := make([]Run, 0, len(s.order))
	for _, id := range s.order {
		out = append(out, s.runs[id])
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out
}

func (s *Store) Run(id string) (Run, bool) {
	r, ok := s.runs[id]
	return r, ok
}

// Stages returns one run's stages in the order the loop runs them, not the order
// they happened to arrive, because a delivery can retry out of order.
func (s *Store) Stages(runID string) []Stage {
	order := map[string]int{"claim": 0, "context": 1, "implement": 2, "gates": 3, "verify": 4, "human": 5}
	out := append([]Stage(nil), s.stages[runID]...)
	sort.SliceStable(out, func(i, j int) bool { return order[out[i].Name] < order[out[j].Name] })
	return out
}
