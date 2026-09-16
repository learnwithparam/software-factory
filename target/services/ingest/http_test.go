package ingest

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func call(t *testing.T, s *Store, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	Handler(s).ServeHTTP(rec, req)
	return rec
}

func TestListRuns(t *testing.T) {
	rec := call(t, Seed(), http.MethodGet, "/runs", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var runs []Run
	if err := json.Unmarshal(rec.Body.Bytes(), &runs); err != nil {
		t.Fatalf("body is not a run list: %v", err)
	}
	if len(runs) != 5 {
		t.Fatalf("want 5 runs, got %d", len(runs))
	}
}

func TestTheListIsBoundedByDefault(t *testing.T) {
	rec := call(t, Seed(), http.MethodGet, "/runs?limit=2", "")
	var runs []Run
	_ = json.Unmarshal(rec.Body.Bytes(), &runs)
	if len(runs) != 2 {
		t.Fatalf("want 2 runs, got %d", len(runs))
	}
}

func TestAnAbsurdLimitIsRefused(t *testing.T) {
	rec := call(t, Seed(), http.MethodGet, "/runs?limit=100000", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
	if code(t, rec.Body.Bytes()) != "bad_limit" {
		t.Fatalf("want a machine-readable code, got %s", rec.Body.String())
	}
}

func TestOneRunCarriesItsStages(t *testing.T) {
	rec := call(t, Seed(), http.MethodGet, "/runs/run-101", "")
	var body struct {
		Run    Run     `json:"run"`
		Stages []Stage `json:"stages"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not a run with stages: %v", err)
	}
	if body.Stages[0].Name != "claim" {
		t.Fatalf("stages are not in loop order: %s first", body.Stages[0].Name)
	}
}

func TestAnUnknownRunIsNotFound(t *testing.T) {
	rec := call(t, Seed(), http.MethodGet, "/runs/nope", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
}

func TestAnUnknownFieldIsRejectedRatherThanIgnored(t *testing.T) {
	// Silently dropping a field is how a contract change ships without anyone noticing.
	body := `{"id":"r","item":"i","outcome":"passed","startedAt":"2026-09-16T10:00:00Z","endedAt":"2026-09-16T10:01:00Z","tokensIn":1,"tokensOut":1,"costMinor":1,"currency":"EUR","surprise":true}`
	rec := call(t, NewStore(), http.MethodPost, "/runs", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPostingAStageForAMissingRunIsNotFound(t *testing.T) {
	body := `{"name":"claim","startedAt":"2026-09-16T10:00:00Z","endedAt":"2026-09-16T10:00:01Z","toolCalls":1}`
	rec := call(t, NewStore(), http.MethodPost, "/runs/nope/stages", body)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d", rec.Code)
	}
	if code(t, rec.Body.Bytes()) != "run_not_found" {
		t.Fatalf("unexpected code: %s", rec.Body.String())
	}
}

func TestHealthz(t *testing.T) {
	if rec := call(t, NewStore(), http.MethodGet, "/healthz", ""); rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func code(t *testing.T, body []byte) string {
	t.Helper()
	var out map[string]string
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("error body is not JSON: %v", err)
	}
	return out["code"]
}
