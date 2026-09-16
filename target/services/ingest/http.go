package ingest

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

// Handler serves the ledger. Every error carries a machine-readable code beside
// its message, so a caller never has to branch on prose.
func Handler(s *Store) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("GET /runs", func(w http.ResponseWriter, r *http.Request) {
		runs := s.Runs()
		// Bounded by default. A list that grows without a limit is a list that
		// eventually takes the page down, and the default is where that is decided.
		limit := 50
		if raw := r.URL.Query().Get("limit"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 1 || parsed > 200 {
				writeError(w, http.StatusBadRequest, "bad_limit", "limit must be a number between 1 and 200.")
				return
			}
			limit = parsed
		}
		if len(runs) > limit {
			runs = runs[:limit]
		}
		writeJSON(w, http.StatusOK, runs)
	})

	mux.HandleFunc("GET /runs/{id}", func(w http.ResponseWriter, r *http.Request) {
		run, ok := s.Run(r.PathValue("id"))
		if !ok {
			writeError(w, http.StatusNotFound, "run_not_found", "No run with that id.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"run": run, "stages": s.Stages(run.ID)})
	})

	mux.HandleFunc("POST /runs", func(w http.ResponseWriter, r *http.Request) {
		var run Run
		if err := decode(r, &run); err != nil {
			writeError(w, http.StatusBadRequest, "bad_body", "The body is not a run record.")
			return
		}
		if err := s.PutRun(run); err != nil {
			writeError(w, http.StatusUnprocessableEntity, codeFor(err), err.Error()+".")
			return
		}
		writeJSON(w, http.StatusOK, run)
	})

	mux.HandleFunc("POST /runs/{id}/stages", func(w http.ResponseWriter, r *http.Request) {
		var stage Stage
		if err := decode(r, &stage); err != nil {
			writeError(w, http.StatusBadRequest, "bad_body", "The body is not a stage record.")
			return
		}
		stage.RunID = r.PathValue("id")
		if err := s.AddStage(stage); err != nil {
			status := http.StatusUnprocessableEntity
			if errors.Is(err, ErrUnknownRun) {
				status = http.StatusNotFound
			}
			writeError(w, status, codeFor(err), err.Error()+".")
			return
		}
		writeJSON(w, http.StatusOK, stage)
	})

	return mux
}

func decode(r *http.Request, into any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 64*1024))
	decoder.DisallowUnknownFields()
	return decoder.Decode(into)
}

func codeFor(err error) string {
	switch {
	case errors.Is(err, ErrUnknownRun):
		return "run_not_found"
	case errors.Is(err, ErrUnknownOutcome):
		return "unknown_outcome"
	case errors.Is(err, ErrUnknownStage):
		return "unknown_stage"
	case errors.Is(err, ErrBadInstant):
		return "bad_instant"
	case errors.Is(err, ErrEndsBeforeStart):
		return "ends_before_start"
	case errors.Is(err, ErrNegativeCount):
		return "negative_count"
	default:
		return "unprocessable"
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"code": code, "message": message})
}
