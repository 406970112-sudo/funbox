package httpapi

import (
	"errors"
	"log"
	"net/http"

	"my-first-expo-app/backend/internal/parkinglocation"
)

func registerParkingLocationRoutes(mux *http.ServeMux, api *Server) {
	if api.parkingLocationStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/parking-location/state", api.withAuth(api.withAPIPipeline(api.handleParkingLocationState)))
	mux.HandleFunc("PUT /api/v1/parking-location/state", api.withAuth(api.withAPIPipeline(api.handleSaveParkingLocationState)))
	mux.HandleFunc("DELETE /api/v1/parking-location/state", api.withAuth(api.withAPIPipeline(api.handleClearParkingLocationState)))
}

func (s *Server) handleParkingLocationState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.parkingLocationStore.GetState(r.Context(), account.ID)
	if err != nil {
		s.writeParkingLocationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleSaveParkingLocationState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var state parkinglocation.State
	if err := decodeJSONBody(r, &state); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	saved, err := s.parkingLocationStore.SaveState(r.Context(), account.ID, state)
	if err != nil {
		s.writeParkingLocationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleClearParkingLocationState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.parkingLocationStore.ClearState(r.Context(), account.ID)
	if err != nil {
		s.writeParkingLocationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "updatedAt": state.UpdatedAt})
}

func (s *Server) writeParkingLocationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, parkinglocation.ErrInvalidInput):
		log.Printf("parking location invalid input: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "parking_location_invalid_input"})
	case errors.Is(err, parkinglocation.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "parking_location_not_found"})
	default:
		log.Printf("parking location error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}
