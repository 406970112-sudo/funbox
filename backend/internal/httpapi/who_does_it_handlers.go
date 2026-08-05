package httpapi

import (
	"errors"
	"log"
	"net/http"

	"my-first-expo-app/backend/internal/whodoesit"
)

func registerWhoDoesItRoutes(mux *http.ServeMux, api *Server) {
	if api.whoDoesItStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/who-does-it/state", api.withAuth(api.withAPIPipeline(api.handleWhoDoesItState)))
	mux.HandleFunc("PUT /api/v1/who-does-it/state", api.withAuth(api.withAPIPipeline(api.handleSaveWhoDoesItState)))
	mux.HandleFunc("GET /api/v1/who-does-it/records", api.withAuth(api.withAPIPipeline(api.handleWhoDoesItRecords)))
	mux.HandleFunc("DELETE /api/v1/who-does-it/records", api.withAuth(api.withAPIPipeline(api.handleClearWhoDoesItRecords)))
}

func (s *Server) handleWhoDoesItState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.whoDoesItStore.GetState(r.Context(), account.ID)
	if err != nil {
		s.writeWhoDoesItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleSaveWhoDoesItState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var state whodoesit.State
	if err := decodeJSONBody(r, &state); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	saved, err := s.whoDoesItStore.SaveState(r.Context(), account.ID, state)
	if err != nil {
		s.writeWhoDoesItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleWhoDoesItRecords(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.whoDoesItStore.GetState(r.Context(), account.ID)
	if err != nil {
		s.writeWhoDoesItError(w, err)
		return
	}
	records := state.Records
	if records == nil {
		records = []whodoesit.Record{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": records})
}

func (s *Server) handleClearWhoDoesItRecords(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.whoDoesItStore.ClearRecords(r.Context(), account.ID)
	if err != nil {
		s.writeWhoDoesItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "updatedAt": state.UpdatedAt})
}

func (s *Server) writeWhoDoesItError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, whodoesit.ErrInvalidInput):
		log.Printf("who does it invalid input: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "who_does_it_invalid_input"})
	case errors.Is(err, whodoesit.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "who_does_it_not_found"})
	default:
		log.Printf("who does it error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}
