package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/procrastinator"
)

func registerProcrastinatorRoutes(mux *http.ServeMux, api *Server) {
	if api.procrastinatorStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/procrastination/home", api.withAuth(api.withAPIPipeline(api.handleProcrastinatorHome)))
	mux.HandleFunc("GET /api/v1/procrastination/goals", api.withAuth(api.withAPIPipeline(api.handleProcrastinatorGoals)))
	mux.HandleFunc("POST /api/v1/procrastination/goals", api.withAuth(api.withAPIPipeline(api.handleCreateProcrastinatorGoal)))
	mux.HandleFunc("GET /api/v1/procrastination/goals/{goalID}", api.withAuth(api.withAPIPipeline(api.handleProcrastinatorGoal)))
	mux.HandleFunc("PATCH /api/v1/procrastination/goals/{goalID}", api.withAuth(api.withAPIPipeline(api.handleUpdateProcrastinatorGoal)))
	mux.HandleFunc("DELETE /api/v1/procrastination/goals/{goalID}", api.withAuth(api.withAPIPipeline(api.handleArchiveProcrastinatorGoal)))
	mux.HandleFunc("POST /api/v1/procrastination/goals/{goalID}/steps", api.withAuth(api.withAPIPipeline(api.handleAddProcrastinatorStep)))
	mux.HandleFunc("PATCH /api/v1/procrastination/goals/{goalID}/steps/{stepID}", api.withAuth(api.withAPIPipeline(api.handleUpdateProcrastinatorStep)))
	mux.HandleFunc("DELETE /api/v1/procrastination/goals/{goalID}/steps/{stepID}", api.withAuth(api.withAPIPipeline(api.handleDeleteProcrastinatorStep)))
	mux.HandleFunc("POST /api/v1/procrastination/steps/{stepID}/start", api.withAuth(api.withAPIPipeline(api.handleStartProcrastinatorStep)))
	mux.HandleFunc("POST /api/v1/procrastination/steps/{stepID}/complete", api.withAuth(api.withAPIPipeline(api.handleCompleteProcrastinatorStep)))
	mux.HandleFunc("POST /api/v1/procrastination/steps/{stepID}/undo", api.withAuth(api.withAPIPipeline(api.handleUndoProcrastinatorStep)))
	mux.HandleFunc("GET /api/v1/procrastination/ledger", api.withAuth(api.withAPIPipeline(api.handleProcrastinatorLedger)))
	mux.HandleFunc("GET /api/v1/procrastination/stats", api.withAuth(api.withAPIPipeline(api.handleProcrastinatorStats)))
	mux.HandleFunc("POST /api/v1/procrastination/suggest", api.withAuth(api.withRateLimitedAPIPipeline("procrastination-suggest", api.handleProcrastinatorSuggest)))
}

func (s *Server) handleProcrastinatorHome(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	snapshot, err := s.procrastinatorStore.Home(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("date")))
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleProcrastinatorGoals(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	goals, err := s.procrastinatorStore.ListGoals(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("status")))
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"goals": goals})
}

func (s *Server) handleCreateProcrastinatorGoal(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input procrastinator.GoalInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	goal, err := s.procrastinatorStore.CreateGoal(r.Context(), account.ID, input)
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, goal)
}

func (s *Server) handleProcrastinatorGoal(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	goal, err := s.procrastinatorStore.GetGoal(r.Context(), account.ID, r.PathValue("goalID"))
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, goal)
}

func (s *Server) handleUpdateProcrastinatorGoal(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input procrastinator.UpdateGoalInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	goal, err := s.procrastinatorStore.UpdateGoal(r.Context(), account.ID, r.PathValue("goalID"), input)
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, goal)
}

func (s *Server) handleArchiveProcrastinatorGoal(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	status := procrastinator.GoalStatusArchived
	goal, err := s.procrastinatorStore.UpdateGoal(r.Context(), account.ID, r.PathValue("goalID"), procrastinator.UpdateGoalInput{Status: &status})
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, goal)
}

func (s *Server) handleAddProcrastinatorStep(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input procrastinator.StepInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	goal, err := s.procrastinatorStore.AddStep(r.Context(), account.ID, r.PathValue("goalID"), input)
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, goal)
}

func (s *Server) handleUpdateProcrastinatorStep(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input procrastinator.UpdateStepInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	goal, err := s.procrastinatorStore.UpdateStep(r.Context(), account.ID, r.PathValue("goalID"), r.PathValue("stepID"), input)
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, goal)
}

func (s *Server) handleDeleteProcrastinatorStep(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	goal, err := s.procrastinatorStore.DeleteStep(r.Context(), account.ID, r.PathValue("goalID"), r.PathValue("stepID"))
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, goal)
}

func (s *Server) handleStartProcrastinatorStep(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	goal, err := s.procrastinatorStore.StartStep(r.Context(), account.ID, r.PathValue("stepID"))
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, goal)
}

func (s *Server) handleCompleteProcrastinatorStep(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var body struct {
		Date string `json:"date"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	goal, err := s.procrastinatorStore.CompleteStep(r.Context(), account.ID, r.PathValue("stepID"), body.Date)
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, goal)
}

func (s *Server) handleUndoProcrastinatorStep(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var body struct {
		Date string `json:"date"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	goal, err := s.procrastinatorStore.UndoStep(r.Context(), account.ID, r.PathValue("stepID"), body.Date)
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, goal)
}

func (s *Server) handleProcrastinatorLedger(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	limit := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err == nil && parsed > 0 {
			limit = parsed
		}
	}
	ledger, err := s.procrastinatorStore.Ledger(r.Context(), account.ID, procrastinator.LedgerFilter{
		GoalID: strings.TrimSpace(r.URL.Query().Get("goalId")),
		From:   strings.TrimSpace(r.URL.Query().Get("from")),
		To:     strings.TrimSpace(r.URL.Query().Get("to")),
		Limit:  limit,
	})
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ledger)
}

func (s *Server) handleProcrastinatorStats(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	rangeID := strings.TrimSpace(r.URL.Query().Get("range"))
	if rangeID == "" {
		rangeID = "week"
	}
	stats, err := s.procrastinatorStore.Stats(r.Context(), account.ID, rangeID)
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleProcrastinatorSuggest(w http.ResponseWriter, r *http.Request) {
	_, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input procrastinator.SuggestRequest
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	result, err := procrastinator.SuggestSteps(r.Context(), s.cfg.DeepSeek, input)
	if err != nil {
		s.writeProcrastinatorError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) writeProcrastinatorError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, procrastinator.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "procrastination_not_found"})
	case errors.Is(err, procrastinator.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "procrastination_invalid_input"})
	case errors.Is(err, procrastinator.ErrAlreadyCompleted):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "procrastination_already_completed"})
	case errors.Is(err, procrastinator.ErrStepNotCompleted):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "procrastination_step_not_completed"})
	case errors.Is(err, procrastinator.ErrAIUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "procrastination_ai_unavailable"})
	default:
		log.Printf("procrastinator request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "procrastination_request_failed"})
	}
}
