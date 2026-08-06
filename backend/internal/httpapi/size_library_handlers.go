package httpapi

import (
	"errors"
	"log"
	"net/http"

	"my-first-expo-app/backend/internal/sizelibrary"
)

func registerSizeLibraryRoutes(mux *http.ServeMux, api *Server) {
	if api.sizeLibraryStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/size-library/state", api.withAuth(api.withAPIPipeline(api.handleSizeLibraryState)))
	mux.HandleFunc("PUT /api/v1/size-library/state", api.withAuth(api.withAPIPipeline(api.handleSaveSizeLibraryState)))
	mux.HandleFunc("DELETE /api/v1/size-library/state", api.withAuth(api.withAPIPipeline(api.handleClearSizeLibraryState)))
}

func (s *Server) handleSizeLibraryState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.sizeLibraryStore.GetState(r.Context(), account.ID)
	if err != nil {
		s.writeSizeLibraryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleSaveSizeLibraryState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var state sizelibrary.State
	if err := decodeJSONBody(r, &state); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	saved, err := s.sizeLibraryStore.SaveState(r.Context(), account.ID, state)
	if err != nil {
		s.writeSizeLibraryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleClearSizeLibraryState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.sizeLibraryStore.ClearState(r.Context(), account.ID)
	if err != nil {
		s.writeSizeLibraryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "updatedAt": state.UpdatedAt})
}

func (s *Server) writeSizeLibraryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sizelibrary.ErrInvalidInput):
		log.Printf("size library invalid input: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "size_library_invalid_input"})
	case errors.Is(err, sizelibrary.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "size_library_not_found"})
	default:
		log.Printf("size library error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}
