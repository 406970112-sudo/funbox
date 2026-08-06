package httpapi

import (
	"errors"
	"log"
	"net/http"

	"my-first-expo-app/backend/internal/quiethome"
)

func registerQuietHomeRoutes(mux *http.ServeMux, api *Server) {
	if api.quietHomeService == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/quiet-home/state", api.withAuth(api.withAPIPipeline(api.handleQuietHomeState)))
	mux.HandleFunc("POST /api/v1/quiet-home/trips", api.withAuth(api.withAPIPipeline(api.handleQuietHomeCreateTrip)))
	mux.HandleFunc("PATCH /api/v1/quiet-home/trips/{id}", api.withAuth(api.withAPIPipeline(api.handleQuietHomeUpdateTrip)))
	mux.HandleFunc("POST /api/v1/quiet-home/trips/{id}/check-in", api.withAuth(api.withAPIPipeline(api.handleQuietHomeCheckIn)))
	mux.HandleFunc("POST /api/v1/quiet-home/trips/{id}/cancel", api.withAuth(api.withAPIPipeline(api.handleQuietHomeCancel)))
	mux.HandleFunc("GET /api/v1/quiet-home/history", api.withAuth(api.withAPIPipeline(api.handleQuietHomeHistory)))
	mux.HandleFunc("DELETE /api/v1/quiet-home/history", api.withAuth(api.withAPIPipeline(api.handleQuietHomeClearHistory)))
	mux.HandleFunc("GET /api/v1/quiet-home/contacts", api.withAuth(api.withAPIPipeline(api.handleQuietHomeContacts)))
	mux.HandleFunc("POST /api/v1/quiet-home/contacts/{contactUserID}", api.withAuth(api.withAPIPipeline(api.handleQuietHomeAddContact)))
	mux.HandleFunc("POST /api/v1/quiet-home/contacts/{contactUserID}/consent", api.withAuth(api.withAPIPipeline(api.handleQuietHomeRespondContact)))
	mux.HandleFunc("DELETE /api/v1/quiet-home/contacts/{contactUserID}", api.withAuth(api.withAPIPipeline(api.handleQuietHomeRemoveContact)))
	mux.HandleFunc("GET /api/v1/quiet-home/settings", api.withAuth(api.withAPIPipeline(api.handleQuietHomeGetSettings)))
	mux.HandleFunc("PUT /api/v1/quiet-home/settings", api.withAuth(api.withAPIPipeline(api.handleQuietHomeSaveSettings)))
	mux.HandleFunc("POST /api/v1/quiet-home/notifications/{id}/delivered", api.withAuth(api.withAPIPipeline(api.handleQuietHomeNotificationDelivered)))
	mux.HandleFunc("POST /api/v1/quiet-home/notifications/{id}/failed", api.withAuth(api.withAPIPipeline(api.handleQuietHomeNotificationFailed)))
}

func (s *Server) handleQuietHomeState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.quietHomeService.GetState(r.Context(), account.ID)
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleQuietHomeCreateTrip(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input quiethome.CreateTripInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	trip, err := s.quietHomeService.CreateTrip(r.Context(), account.ID, input)
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, trip)
}

func (s *Server) handleQuietHomeUpdateTrip(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input quiethome.UpdateTripInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	trip, err := s.quietHomeService.UpdateTrip(r.Context(), account.ID, r.PathValue("id"), input)
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, trip)
}

func (s *Server) handleQuietHomeCheckIn(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	trip, err := s.quietHomeService.CheckIn(r.Context(), account.ID, r.PathValue("id"))
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, trip)
}

func (s *Server) handleQuietHomeCancel(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	trip, err := s.quietHomeService.CancelTrip(r.Context(), account.ID, r.PathValue("id"))
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, trip)
}

func (s *Server) handleQuietHomeHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.quietHomeService.ListHistory(r.Context(), account.ID)
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	if items == nil {
		items = []quiethome.HistoryRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": items})
}

func (s *Server) handleQuietHomeClearHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.quietHomeService.ClearHistory(r.Context(), account.ID); err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleQuietHomeContacts(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.quietHomeService.ListContacts(r.Context(), account.ID)
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	if items == nil {
		items = []quiethome.FriendContact{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"contacts": items})
}

func (s *Server) handleQuietHomeAddContact(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.quietHomeService.AddContact(r.Context(), account.ID, r.PathValue("contactUserID"))
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleQuietHomeRespondContact(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input quiethome.ConsentInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.quietHomeService.RespondContact(r.Context(), account.ID, r.PathValue("contactUserID"), input)
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleQuietHomeRemoveContact(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.quietHomeService.RemoveContact(r.Context(), account.ID, r.PathValue("contactUserID")); err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleQuietHomeGetSettings(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	settings, err := s.quietHomeService.GetSettings(r.Context(), account.ID)
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleQuietHomeSaveSettings(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var settings quiethome.Settings
	if err := decodeJSONBody(r, &settings); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	saved, err := s.quietHomeService.SaveSettings(r.Context(), account.ID, settings)
	if err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleQuietHomeNotificationDelivered(w http.ResponseWriter, r *http.Request) {
	_, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.quietHomeService.MarkNotificationDelivered(r.Context(), r.PathValue("id")); err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleQuietHomeNotificationFailed(w http.ResponseWriter, r *http.Request) {
	_, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var payload struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.quietHomeService.MarkNotificationFailed(r.Context(), r.PathValue("id"), payload.Reason); err != nil {
		s.writeQuietHomeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) writeQuietHomeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, quiethome.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "quiet_home_invalid_input"})
	case errors.Is(err, quiethome.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "quiet_home_not_found"})
	case errors.Is(err, quiethome.ErrNotFriend):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "quiet_home_not_friend"})
	case errors.Is(err, quiethome.ErrContactNotAgreed):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "quiet_home_contact_not_agreed"})
	case errors.Is(err, quiethome.ErrActiveTripExists):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "quiet_home_active_trip_exists"})
	default:
		log.Printf("quiet home error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}
