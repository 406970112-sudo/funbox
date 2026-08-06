package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"my-first-expo-app/backend/internal/homemanual"
)

func registerHomeManualRoutes(mux *http.ServeMux, api *Server) {
	if api.homeManualStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/home-manual/state", api.withAuth(api.withAPIPipeline(api.handleHomeManualState)))
	mux.HandleFunc("PUT /api/v1/home-manual/state", api.withAuth(api.withAPIPipeline(api.handleSaveHomeManualState)))
	mux.HandleFunc("DELETE /api/v1/home-manual/state", api.withAuth(api.withAPIPipeline(api.handleClearHomeManualState)))
	mux.HandleFunc("POST /api/v1/home-manual/security/password", api.withAuth(api.withRateLimitedAPIPipeline("home-manual-password", api.handleHomeManualPassword)))
	mux.HandleFunc("POST /api/v1/home-manual/security/unlock", api.withAuth(api.withRateLimitedAPIPipeline("home-manual-unlock", api.handleHomeManualUnlock)))
	mux.HandleFunc("POST /api/v1/home-manual/security/lock", api.withAuth(api.withAPIPipeline(api.handleHomeManualLock)))
	mux.HandleFunc("GET /api/v1/home-manual/export", api.withAuth(api.withAPIPipeline(api.handleHomeManualExport)))
	mux.HandleFunc("POST /api/v1/home-manual/import", api.withAuth(api.withAPIPipeline(api.handleHomeManualImport)))
}

func (s *Server) handleHomeManualState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if strings.EqualFold(r.URL.Query().Get("view"), "full") {
		dataKey, err := s.homeManualDataKey(r, account.ID)
		if err != nil {
			s.writeHomeManualError(w, err)
			return
		}
		state, err := s.homeManualStore.GetFullState(r.Context(), account.ID, dataKey)
		if err != nil {
			s.writeHomeManualError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, state)
		return
	}
	state, err := s.homeManualStore.GetState(r.Context(), account.ID)
	if err != nil {
		s.writeHomeManualError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleSaveHomeManualState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var state homemanual.State
	if err := decodeJSONBody(r, &state); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	dataKey, err := s.homeManualDataKey(r, account.ID)
	if err != nil && !errors.Is(err, homemanual.ErrLocked) {
		s.writeHomeManualError(w, err)
		return
	}
	saved, err := s.homeManualStore.SaveState(r.Context(), account.ID, state, dataKey)
	if err != nil {
		s.writeHomeManualError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleClearHomeManualState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	dataKey, err := s.homeManualDataKey(r, account.ID)
	if err != nil {
		s.writeHomeManualError(w, err)
		return
	}
	state, err := s.homeManualStore.ClearState(r.Context(), account.ID, dataKey)
	if err != nil {
		s.writeHomeManualError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "updatedAt": state.UpdatedAt})
}

func (s *Server) handleHomeManualPassword(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var request struct {
		Action          string `json:"action"`
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.homeManualStore.SetPassword(
		r.Context(),
		account.ID,
		request.Action,
		request.CurrentPassword,
		request.NewPassword,
	); err != nil {
		s.writeHomeManualError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleHomeManualUnlock(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var request struct {
		Password string `json:"password"`
	}
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	token, expiresIn, err := s.homeManualStore.Unlock(r.Context(), account.ID, request.Password)
	if err != nil {
		s.writeHomeManualError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"unlockToken":      token,
		"expiresInSeconds": expiresIn,
	})
}

func (s *Server) handleHomeManualLock(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.homeManualStore.Lock(r.Context(), account.ID, r.Header.Get("X-Home-Manual-Unlock-Token")); err != nil {
		s.writeHomeManualError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleHomeManualExport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	dataKey, err := s.homeManualDataKey(r, account.ID)
	if err != nil {
		s.writeHomeManualError(w, err)
		return
	}
	state, err := s.homeManualStore.GetFullState(r.Context(), account.ID, dataKey)
	if err != nil {
		s.writeHomeManualError(w, err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="home-manual.json"`)
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleHomeManualImport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var state homemanual.State
	if err := decodeJSONBody(r, &state); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	dataKey, err := s.homeManualDataKey(r, account.ID)
	if err != nil && !errors.Is(err, homemanual.ErrLocked) {
		s.writeHomeManualError(w, err)
		return
	}
	saved, err := s.homeManualStore.SaveState(r.Context(), account.ID, state, dataKey)
	if err != nil {
		s.writeHomeManualError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) homeManualDataKey(r *http.Request, userID string) ([]byte, error) {
	return s.homeManualStore.GetDataKey(r.Context(), userID, r.Header.Get("X-Home-Manual-Unlock-Token"))
}

func (s *Server) writeHomeManualError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, homemanual.ErrInvalidInput),
		errors.Is(err, homemanual.ErrPasswordInvalid),
		errors.Is(err, homemanual.ErrRemoveWithSecrets):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "home_manual_invalid_input"})
	case errors.Is(err, homemanual.ErrPasswordRequired):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "home_manual_password_required"})
	case errors.Is(err, homemanual.ErrPasswordMismatch):
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "home_manual_password_mismatch"})
	case errors.Is(err, homemanual.ErrLockedOut):
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "home_manual_locked_out"})
	case errors.Is(err, homemanual.ErrLocked):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "home_manual_locked"})
	case errors.Is(err, homemanual.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "home_manual_not_found"})
	default:
		log.Printf("home manual error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}
