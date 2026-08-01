package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/focus"
)

func registerFocusRoutes(mux *http.ServeMux, api *Server) {
	if api.focusStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/focus/today", api.withAuth(api.withAPIPipeline(api.handleFocusToday)))
	mux.HandleFunc("GET /api/v1/focus/lists", api.withAuth(api.withAPIPipeline(api.handleFocusLists)))
	mux.HandleFunc("POST /api/v1/focus/lists", api.withAuth(api.withAPIPipeline(api.handleCreateFocusList)))
	mux.HandleFunc("PATCH /api/v1/focus/lists/{listID}", api.withAuth(api.withAPIPipeline(api.handleUpdateFocusList)))
	mux.HandleFunc("DELETE /api/v1/focus/lists/{listID}", api.withAuth(api.withAPIPipeline(api.handleDeleteFocusList)))
	mux.HandleFunc("GET /api/v1/focus/tasks", api.withAuth(api.withAPIPipeline(api.handleFocusTasks)))
	mux.HandleFunc("POST /api/v1/focus/tasks", api.withAuth(api.withAPIPipeline(api.handleCreateFocusTask)))
	mux.HandleFunc("PATCH /api/v1/focus/tasks/{taskID}", api.withAuth(api.withAPIPipeline(api.handleUpdateFocusTask)))
	mux.HandleFunc("POST /api/v1/focus/tasks/{taskID}/complete", api.withAuth(api.withAPIPipeline(api.handleCompleteFocusTask)))
	mux.HandleFunc("DELETE /api/v1/focus/tasks/{taskID}", api.withAuth(api.withAPIPipeline(api.handleDeleteFocusTask)))
	mux.HandleFunc("GET /api/v1/focus/goals", api.withAuth(api.withAPIPipeline(api.handleFocusGoals)))
	mux.HandleFunc("POST /api/v1/focus/goals", api.withAuth(api.withAPIPipeline(api.handleCreateFocusGoal)))
	mux.HandleFunc("PATCH /api/v1/focus/goals/{goalID}", api.withAuth(api.withAPIPipeline(api.handleUpdateFocusGoal)))
	mux.HandleFunc("DELETE /api/v1/focus/goals/{goalID}", api.withAuth(api.withAPIPipeline(api.handleDeleteFocusGoal)))
	mux.HandleFunc("GET /api/v1/focus/habits", api.withAuth(api.withAPIPipeline(api.handleFocusHabits)))
	mux.HandleFunc("POST /api/v1/focus/habits", api.withAuth(api.withAPIPipeline(api.handleCreateFocusHabit)))
	mux.HandleFunc("PATCH /api/v1/focus/habits/{habitID}", api.withAuth(api.withAPIPipeline(api.handleUpdateFocusHabit)))
	mux.HandleFunc("POST /api/v1/focus/habits/{habitID}/records", api.withAuth(api.withAPIPipeline(api.handleAddFocusHabitRecord)))
	mux.HandleFunc("DELETE /api/v1/focus/habits/{habitID}/records", api.withAuth(api.withAPIPipeline(api.handleRemoveFocusHabitRecordByDate)))
	mux.HandleFunc("DELETE /api/v1/focus/habits/{habitID}/records/{recordID}", api.withAuth(api.withAPIPipeline(api.handleRemoveFocusHabitRecord)))
	mux.HandleFunc("GET /api/v1/focus/stats", api.withAuth(api.withAPIPipeline(api.handleFocusStats)))
	mux.HandleFunc("GET /api/v1/focus/calendar", api.withAuth(api.withAPIPipeline(api.handleFocusCalendar)))
}

func (s *Server) handleFocusToday(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	snapshot, err := s.focusStore.Today(r.Context(), account.ID, date)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleFocusLists(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	if _, err := s.focusStore.EnsureDefaultList(r.Context(), account.ID); err != nil {
		s.writeFocusError(w, err)
		return
	}
	lists, err := s.focusStore.ListLists(r.Context(), account.ID)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lists": lists})
}

func (s *Server) handleCreateFocusList(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input focus.ListInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.focusStore.CreateList(r.Context(), account.ID, input)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateFocusList(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input focus.ListInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.focusStore.UpdateList(r.Context(), account.ID, r.PathValue("listID"), input)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteFocusList(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	if err := s.focusStore.DeleteList(r.Context(), account.ID, r.PathValue("listID")); err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleFocusTasks(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	filter := focus.TaskFilter{
		ListID: strings.TrimSpace(r.URL.Query().Get("listId")),
		Status: strings.TrimSpace(r.URL.Query().Get("status")),
		Date:   date,
		Query:  strings.TrimSpace(r.URL.Query().Get("q")),
	}
	tasks, err := s.focusStore.ListTasks(r.Context(), account.ID, filter)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

func (s *Server) handleCreateFocusTask(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input focus.TaskInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.focusStore.CreateTask(r.Context(), account.ID, input)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateFocusTask(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input focus.TaskInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.focusStore.UpdateTask(r.Context(), account.ID, r.PathValue("taskID"), input)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleCompleteFocusTask(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var body struct {
		Completed bool   `json:"completed"`
		Date      string `json:"date"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.focusStore.CompleteTask(r.Context(), account.ID, r.PathValue("taskID"), body.Completed, body.Date)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteFocusTask(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	if err := s.focusStore.DeleteTask(r.Context(), account.ID, r.PathValue("taskID")); err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleFocusGoals(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	goals, err := s.focusStore.ListGoals(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("date")))
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"goals": goals})
}

func (s *Server) handleCreateFocusGoal(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input focus.GoalInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.focusStore.CreateGoal(r.Context(), account.ID, input)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateFocusGoal(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input focus.GoalInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.focusStore.UpdateGoal(r.Context(), account.ID, r.PathValue("goalID"), input)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteFocusGoal(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	if err := s.focusStore.DeleteGoal(r.Context(), account.ID, r.PathValue("goalID")); err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleFocusHabits(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	habits, err := s.focusStore.ListHabits(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("date")))
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"habits": habits})
}

func (s *Server) handleCreateFocusHabit(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input focus.HabitInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.focusStore.CreateHabit(r.Context(), account.ID, input)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateFocusHabit(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input focus.HabitInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.focusStore.UpdateHabit(r.Context(), account.ID, r.PathValue("habitID"), input)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleAddFocusHabitRecord(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var body struct {
		Date string `json:"date"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	record, err := s.focusStore.AddHabitRecord(r.Context(), account.ID, r.PathValue("habitID"), body.Date)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"record": record})
}

func (s *Server) handleRemoveFocusHabitRecord(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	if err := s.focusStore.RemoveHabitRecord(r.Context(), account.ID, r.PathValue("habitID"), r.PathValue("recordID")); err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleRemoveFocusHabitRecordByDate(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	if err := s.focusStore.RemoveHabitRecordByDate(r.Context(), account.ID, r.PathValue("habitID"), date); err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleFocusStats(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	rangeID := strings.TrimSpace(r.URL.Query().Get("range"))
	if rangeID == "" {
		rangeID = "week"
	}
	stats, err := s.focusStore.Stats(r.Context(), account.ID, rangeID)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleFocusCalendar(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	month := strings.TrimSpace(r.URL.Query().Get("month"))
	if month == "" {
		month = time.Now().Format("2006-01")
	}
	snapshot, err := s.focusStore.Calendar(r.Context(), account.ID, month)
	if err != nil {
		s.writeFocusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) writeFocusError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, focus.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "focus_not_found"})
	case errors.Is(err, focus.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "focus_invalid_input"})
	case errors.Is(err, focus.ErrGoalLimitReached):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "focus_goal_limit_reached"})
	case errors.Is(err, focus.ErrHabitAlreadyDone):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "focus_habit_already_done"})
	case errors.Is(err, focus.ErrSubtaskPending):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "focus_subtasks_pending"})
	default:
		log.Printf("focus request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "focus_request_failed"})
	}
}
