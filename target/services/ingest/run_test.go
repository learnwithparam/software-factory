package ingest

import (
	"errors"
	"testing"
)

func aRun() Run {
	return Run{
		ID: "run-1", Item: "item-1", Outcome: "passed",
		StartedAt: "2026-09-16T10:00:00Z", EndedAt: "2026-09-16T10:05:00Z",
		TokensIn: 100, TokensOut: 20, CostMinor: 3, Currency: "EUR",
	}
}

func TestRecordingTheSameRunTwiceKeepsOneEntry(t *testing.T) {
	// A delivery that retries must not double a run, or every cost total is wrong.
	s := NewStore()
	if err := s.PutRun(aRun()); err != nil {
		t.Fatal(err)
	}
	updated := aRun()
	updated.CostMinor = 4
	if err := s.PutRun(updated); err != nil {
		t.Fatal(err)
	}
	if got := len(s.Runs()); got != 1 {
		t.Fatalf("want 1 run, got %d", got)
	}
	if r, _ := s.Run("run-1"); r.CostMinor != 4 {
		t.Fatalf("the later record did not win: %d", r.CostMinor)
	}
}

func TestRunsAreListedNewestFirst(t *testing.T) {
	runs := Seed().Runs()
	for i := 1; i < len(runs); i++ {
		if runs[i-1].StartedAt < runs[i].StartedAt {
			t.Fatalf("out of order at %d: %s before %s", i, runs[i-1].StartedAt, runs[i].StartedAt)
		}
	}
}

func TestAnUnknownOutcomeIsRefused(t *testing.T) {
	r := aRun()
	r.Outcome = "probably-fine"
	if err := NewStore().PutRun(r); !errors.Is(err, ErrUnknownOutcome) {
		t.Fatalf("want ErrUnknownOutcome, got %v", err)
	}
}

func TestARunThatEndsBeforeItStartsIsRefused(t *testing.T) {
	r := aRun()
	r.EndedAt = "2026-09-16T09:00:00Z"
	if err := NewStore().PutRun(r); !errors.Is(err, ErrEndsBeforeStart) {
		t.Fatalf("want ErrEndsBeforeStart, got %v", err)
	}
}

func TestAnUnparseableInstantIsRefusedRatherThanZeroed(t *testing.T) {
	r := aRun()
	r.StartedAt = "this morning"
	if err := NewStore().PutRun(r); !errors.Is(err, ErrBadInstant) {
		t.Fatalf("want ErrBadInstant, got %v", err)
	}
}

func TestANegativeCostIsRefused(t *testing.T) {
	r := aRun()
	r.CostMinor = -1
	if err := NewStore().PutRun(r); !errors.Is(err, ErrNegativeCount) {
		t.Fatalf("want ErrNegativeCount, got %v", err)
	}
}

func TestAStageForAnUnknownRunIsRefused(t *testing.T) {
	st := Stage{RunID: "nope", Name: "claim", StartedAt: "2026-09-16T10:00:00Z", EndedAt: "2026-09-16T10:00:01Z"}
	if err := NewStore().AddStage(st); !errors.Is(err, ErrUnknownRun) {
		t.Fatalf("want ErrUnknownRun, got %v", err)
	}
}

func TestStagesComeBackInLoopOrderNotArrivalOrder(t *testing.T) {
	s := NewStore()
	if err := s.PutRun(aRun()); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"verify", "claim", "gates", "context"} {
		st := Stage{RunID: "run-1", Name: name, StartedAt: "2026-09-16T10:00:00Z", EndedAt: "2026-09-16T10:00:01Z"}
		if err := s.AddStage(st); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{"claim", "context", "gates", "verify"}
	got := s.Stages("run-1")
	for i, name := range want {
		if got[i].Name != name {
			t.Fatalf("position %d: want %s, got %s", i, name, got[i].Name)
		}
	}
}

func TestTheSeedCarriesARefusal(t *testing.T) {
	// A lab whose sample data only shows success teaches the wrong lesson.
	for _, r := range Seed().Runs() {
		if r.Outcome == "refused" {
			return
		}
	}
	t.Fatal("no refused run in the seed")
}
