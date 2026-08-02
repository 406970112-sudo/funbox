package httpapi

import (
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/plantid"
)

const (
	plantIDMaxImageBytes = 5 << 20
	plantIDFormOverhead  = 1 << 20
)

func registerPlantIDRoutes(mux *http.ServeMux, api *Server) {
	if api.plantIDService == nil {
		return
	}
	mux.HandleFunc(
		"POST /api/v1/plant-id/identify",
		api.withOptionalAuth(api.withPlantIDUploadPipeline(api.handlePlantIDIdentify)),
	)
	mux.HandleFunc(
		"GET /api/v1/plant-id/species/{gbifKey}",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("plant-id", api.handlePlantIDSpecies)),
	)
	mux.HandleFunc(
		"GET /api/v1/plant-id/common-plants",
		api.withRateLimitedAPIPipeline("plant-id", api.handlePlantIDCommonPlants),
	)
	mux.HandleFunc(
		"GET /api/v1/plant-id/sources",
		api.withRateLimitedAPIPipeline("plant-id", api.handlePlantIDSources),
	)
	mux.HandleFunc(
		"POST /api/v1/plant-id/feedback",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("plant-id", api.handlePlantIDFeedback)),
	)
	mux.HandleFunc(
		"GET /api/v1/plant-id/history",
		api.withAuth(api.withRateLimitedAPIPipeline("plant-id", api.handlePlantIDHistory)),
	)
	mux.HandleFunc(
		"DELETE /api/v1/plant-id/history/{historyID}",
		api.withAuth(api.withRateLimitedAPIPipeline("plant-id", api.handlePlantIDDeleteHistory)),
	)
	mux.HandleFunc(
		"DELETE /api/v1/plant-id/history",
		api.withAuth(api.withRateLimitedAPIPipeline("plant-id", api.handlePlantIDClearHistory)),
	)
}

func (s *Server) withPlantIDUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "plant-id") {
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, plantIDMaxImageBytes+plantIDFormOverhead)
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handlePlantIDIdentify(w http.ResponseWriter, r *http.Request) {
	if s.plantIDService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "plant_id_not_configured"})
		return
	}
	if strings.TrimSpace(s.cfg.PlantID.APIKey) == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error":  "plant_id_not_configured",
			"detail": "PLANTNET_API_KEY is not configured on the backend",
		})
		return
	}
	if err := r.ParseMultipartForm(plantIDMaxImageBytes + plantIDFormOverhead); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) || strings.Contains(err.Error(), "request body too large") {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "image_too_large"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_multipart_form"})
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	file, _, err := r.FormFile("image")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "image_required"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, plantIDMaxImageBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "image_read_failed"})
		return
	}
	if len(data) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "image_required"})
		return
	}
	if int64(len(data)) > plantIDMaxImageBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "image_too_large"})
		return
	}
	if !supportedImageType(http.DetectContentType(data)) {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "image_type_invalid"})
		return
	}

	result, err := s.plantIDService.Identify(r.Context(), data, strings.TrimSpace(r.FormValue("organ")))
	if err != nil {
		handlePlantIDServiceError(w, err)
		return
	}

	if account, ok := authenticatedUserFromContext(r.Context()); ok && len(result.Matches) > 0 {
		top := result.Matches[0]
		_ = s.plantIDService.SaveHistory(r.Context(), account.ID, plantid.HistoryItem{
			ScientificName: top.ScientificName,
			CommonNameZh:   top.CommonNameZh,
			FamilyZh:       top.FamilyZh,
			GBIFKey:        top.GBIFKey,
			Score:          top.Score,
		})
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handlePlantIDSpecies(w http.ResponseWriter, r *http.Request) {
	gbifKey, err := strconv.ParseInt(strings.TrimSpace(r.PathValue("gbifKey")), 10, 64)
	if err != nil || gbifKey <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "gbif_key_invalid"})
		return
	}
	hint := &plantid.PlantNetSpecies{
		ScientificName: strings.TrimSpace(r.URL.Query().Get("scientificName")),
		Genus:          strings.TrimSpace(r.URL.Query().Get("genus")),
		Family:         strings.TrimSpace(r.URL.Query().Get("family")),
	}
	if common := strings.TrimSpace(r.URL.Query().Get("commonName")); common != "" {
		hint.CommonNames = []string{common}
	}
	detail, err := s.plantIDService.Species(r.Context(), gbifKey, hint)
	if err != nil {
		handlePlantIDServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handlePlantIDCommonPlants(w http.ResponseWriter, _ *http.Request) {
	items, fetchedAt := s.plantIDService.CommonPlants()
	writeJSON(w, http.StatusOK, map[string]any{
		"items":     items,
		"fetchedAt": fetchedAt,
	})
}

func (s *Server) handlePlantIDSources(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.plantIDService.Sources())
}

func (s *Server) handlePlantIDFeedback(w http.ResponseWriter, r *http.Request) {
	var input plantid.FeedbackInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	userID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
	}
	if err := s.plantIDService.Feedback(r.Context(), userID, input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "feedback_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handlePlantIDHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	limit := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			limit = value
		}
	}
	items, err := s.plantIDService.History(r.Context(), account.ID, limit)
	if err != nil {
		log.Printf("plant id history failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "history_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handlePlantIDDeleteHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.plantIDService.DeleteHistory(r.Context(), account.ID, strings.TrimSpace(r.PathValue("historyID"))); err != nil {
		if errors.Is(err, plantid.ErrHistoryNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "history_not_found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "history_delete_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handlePlantIDClearHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.plantIDService.ClearHistory(r.Context(), account.ID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "history_clear_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func handlePlantIDServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, plantid.ErrNotConfigured):
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error":  "plant_id_not_configured",
			"detail": "PLANTNET_API_KEY is not configured on the backend",
		})
	case errors.Is(err, plantid.ErrSpeciesNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "plant_species_not_found"})
	case errors.Is(err, plantid.ErrProviderFailed):
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "plant_id_provider_failed"})
	default:
		log.Printf("plant id request failed: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "plant_id_request_failed"})
	}
}
