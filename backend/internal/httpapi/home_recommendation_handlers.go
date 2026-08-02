package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/homerecommendation"
	"my-first-expo-app/backend/internal/roles"
)

type homeRecommendationEventRequest struct {
	EventType string `json:"eventType"`
	SlotID    string `json:"slotId"`
	Date      string `json:"date"`
}

type homeRecommendationSlotRequest struct {
	Slot homerecommendation.SlotInput `json:"slot"`
}

type homeRecommendationReorderRequest struct {
	SlotIDs []string `json:"slotIds"`
}

func registerHomeRecommendationRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc(
		"GET /api/v1/home/recommendations",
		api.withOptionalAuth(api.withAPIPipeline(api.handleHomeRecommendations)),
	)
	mux.HandleFunc(
		"POST /api/v1/home/recommendations/events",
		api.withAuth(api.withAPIPipeline(api.handleHomeRecommendationEvent)),
	)
	mux.HandleFunc(
		"GET /api/v1/admin/home-recommendations",
		api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleAdminHomeRecommendations))),
	)
	mux.HandleFunc(
		"POST /api/v1/admin/home-recommendations",
		api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleCreateHomeRecommendation))),
	)
	mux.HandleFunc(
		"PUT /api/v1/admin/home-recommendations/reorder",
		api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleReorderHomeRecommendations))),
	)
	mux.HandleFunc(
		"PUT /api/v1/admin/home-recommendations/{slotID}",
		api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleUpdateHomeRecommendation))),
	)
	mux.HandleFunc(
		"DELETE /api/v1/admin/home-recommendations/{slotID}",
		api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleDeleteHomeRecommendation))),
	)
	mux.HandleFunc(
		"GET /api/v1/admin/home-recommendations/audit-log",
		api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleHomeRecommendationAuditLog))),
	)
	mux.HandleFunc(
		"GET /api/v1/admin/home-recommendations/stats",
		api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleHomeRecommendationStats))),
	)
}

func (s *Server) handleHomeRecommendations(w http.ResponseWriter, r *http.Request) {
	if s.homeRecommendationService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "home_recommendation_unavailable"})
		return
	}
	userID := ""
	role := roles.Normal
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
		role = account.Role
	}
	visibleIDs, err := s.accessStore.VisibleFeatureIDs(r.Context(), userID, role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_features_failed"})
		return
	}
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	response, err := s.homeRecommendationService.HomeRecommendations(r.Context(), visibleIDs, date)
	if err != nil {
		log.Printf("home recommendations failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "home_recommendation_failed"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleHomeRecommendationEvent(w http.ResponseWriter, r *http.Request) {
	if s.homeRecommendationService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "home_recommendation_unavailable"})
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var request homeRecommendationEventRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.homeRecommendationService.RecordEvent(
		r.Context(),
		account.ID,
		strings.TrimSpace(request.SlotID),
		strings.TrimSpace(request.EventType),
		strings.TrimSpace(request.Date),
	); err != nil {
		if errors.Is(err, homerecommendation.ErrEventInvalid) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "home_recommendation_event_invalid"})
			return
		}
		log.Printf("record home recommendation event failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "home_recommendation_event_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleAdminHomeRecommendations(w http.ResponseWriter, r *http.Request) {
	if s.homeRecommendationService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "home_recommendation_unavailable"})
		return
	}
	response, err := s.homeRecommendationService.AdminList(r.Context())
	if err != nil {
		log.Printf("admin home recommendations failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "home_recommendation_failed"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleCreateHomeRecommendation(w http.ResponseWriter, r *http.Request) {
	if s.homeRecommendationService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "home_recommendation_unavailable"})
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var request homeRecommendationSlotRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	created, err := s.homeRecommendationService.CreateSlot(r.Context(), account.ID, request.Slot)
	if err != nil {
		s.writeHomeRecommendationError(w, err)
		return
	}
	_ = s.homeRecommendationService.AuditLogAppend(r.Context(), account.ID, "create", created.ID, created.FeatureID)
	writeJSON(w, http.StatusCreated, map[string]any{"slot": created})
}

func (s *Server) handleUpdateHomeRecommendation(w http.ResponseWriter, r *http.Request) {
	if s.homeRecommendationService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "home_recommendation_unavailable"})
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	slotID := strings.TrimSpace(r.PathValue("slotID"))
	var request homeRecommendationSlotRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	updated, err := s.homeRecommendationService.UpdateSlot(r.Context(), account.ID, slotID, request.Slot)
	if err != nil {
		s.writeHomeRecommendationError(w, err)
		return
	}
	_ = s.homeRecommendationService.AuditLogAppend(r.Context(), account.ID, "update", updated.ID, updated.FeatureID)
	writeJSON(w, http.StatusOK, map[string]any{"slot": updated})
}

func (s *Server) handleDeleteHomeRecommendation(w http.ResponseWriter, r *http.Request) {
	if s.homeRecommendationService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "home_recommendation_unavailable"})
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	slotID := strings.TrimSpace(r.PathValue("slotID"))
	if err := s.homeRecommendationService.DeleteSlot(r.Context(), account.ID, slotID); err != nil {
		s.writeHomeRecommendationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleReorderHomeRecommendations(w http.ResponseWriter, r *http.Request) {
	if s.homeRecommendationService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "home_recommendation_unavailable"})
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var request homeRecommendationReorderRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.homeRecommendationService.Reorder(r.Context(), account.ID, request.SlotIDs); err != nil {
		s.writeHomeRecommendationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleHomeRecommendationAuditLog(w http.ResponseWriter, r *http.Request) {
	if s.homeRecommendationService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "home_recommendation_unavailable"})
		return
	}
	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			limit = value
		}
	}
	entries, err := s.homeRecommendationService.AuditLog(r.Context(), limit)
	if err != nil {
		log.Printf("home recommendation audit log failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "home_recommendation_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": entries})
}

func (s *Server) handleHomeRecommendationStats(w http.ResponseWriter, r *http.Request) {
	if s.homeRecommendationService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "home_recommendation_unavailable"})
		return
	}
	days := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("days")); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			days = value
		}
	}
	response, err := s.homeRecommendationService.Stats(r.Context(), days)
	if err != nil {
		log.Printf("home recommendation stats failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "home_recommendation_failed"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) writeHomeRecommendationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, homerecommendation.ErrSlotNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "home_recommendation_slot_not_found"})
	case errors.Is(err, homerecommendation.ErrFeatureInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "home_recommendation_feature_invalid"})
	case errors.Is(err, homerecommendation.ErrLastEnabledSlot):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "home_recommendation_at_least_one"})
	case errors.Is(err, homerecommendation.ErrInvalidDateRange):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "home_recommendation_date_range_invalid"})
	case errors.Is(err, homerecommendation.ErrInvalidWeekday):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "home_recommendation_weekday_invalid"})
	case errors.Is(err, homerecommendation.ErrInvalidOverride):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "home_recommendation_override_invalid"})
	default:
		log.Printf("home recommendation request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "home_recommendation_failed"})
	}
}
