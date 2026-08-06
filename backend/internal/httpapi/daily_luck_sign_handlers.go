package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/dailylucksign"
)

func registerDailyLuckSignRoutes(mux *http.ServeMux, api *Server) {
	if api.dailyLuckSignService == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/daily-luck-sign", api.withOptionalAuth(api.withRateLimitedAPIPipeline("daily-luck-sign", api.handleDailyLuckSign)))
	mux.HandleFunc("GET /api/v1/daily-luck-sign/cities", api.withRateLimitedAPIPipeline("daily-luck-sign-cities", api.handleDailyLuckSignCities))
	mux.HandleFunc("GET /api/v1/daily-luck-sign/health", api.withRateLimitedAPIPipeline("daily-luck-sign-health", api.handleDailyLuckSignHealth))
	mux.HandleFunc("GET /api/v1/daily-luck-sign/settings", api.withAuth(api.withAPIPipeline(api.handleDailyLuckSignGetSettings)))
	mux.HandleFunc("PUT /api/v1/daily-luck-sign/settings", api.withAuth(api.withAPIPipeline(api.handleDailyLuckSignSaveSettings)))
	mux.HandleFunc("GET /api/v1/daily-luck-sign/history", api.withAuth(api.withAPIPipeline(api.handleDailyLuckSignHistory)))
	mux.HandleFunc("POST /api/v1/daily-luck-sign/completions", api.withAuth(api.withAPIPipeline(api.handleDailyLuckSignAddCompletion)))
	mux.HandleFunc("DELETE /api/v1/daily-luck-sign/completions/{id}", api.withAuth(api.withAPIPipeline(api.handleDailyLuckSignDeleteCompletion)))
}

func (s *Server) handleDailyLuckSign(w http.ResponseWriter, r *http.Request) {
	loc := dailylucksign.Location{
		Name:   strings.TrimSpace(r.URL.Query().Get("city")),
		Source: strings.TrimSpace(r.URL.Query().Get("source")),
	}
	if value := strings.TrimSpace(r.URL.Query().Get("lat")); value != "" {
		loc.Lat, _ = strconv.ParseFloat(value, 64)
	}
	if value := strings.TrimSpace(r.URL.Query().Get("lon")); value != "" {
		loc.Lon, _ = strconv.ParseFloat(value, 64)
	}
	if loc.Lat == 0 && loc.Lon == 0 {
		if account, ok := authenticatedUserFromContext(r.Context()); ok {
			settings, err := s.dailyLuckSignService.GetSettings(r.Context(), account.ID)
			if err == nil && settings.City != "" {
				loc = dailylucksign.Location{
					Name:   settings.City,
					Lat:    settings.Lat,
					Lon:    settings.Lon,
					Source: settings.Source,
				}
			}
		}
	}
	if loc.Lat == 0 && loc.Lon == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "daily_luck_sign_location_required"})
		return
	}
	response, err := s.dailyLuckSignService.GetSign(r.Context(), r.URL.Query().Get("date"), loc)
	if err != nil {
		s.writeDailyLuckSignError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleDailyLuckSignCities(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "daily_luck_sign_city_query_required"})
		return
	}
	results, err := s.dailyLuckSignService.SearchCities(r.Context(), query)
	if err != nil {
		s.writeDailyLuckSignError(w, err)
		return
	}
	if results == nil {
		results = []dailylucksign.CityResult{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) handleDailyLuckSignHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.dailyLuckSignService.Health(r.Context()))
}

func (s *Server) handleDailyLuckSignGetSettings(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	settings, err := s.dailyLuckSignService.GetSettings(r.Context(), account.ID)
	if err != nil {
		s.writeDailyLuckSignError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleDailyLuckSignSaveSettings(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var settings dailylucksign.Settings
	if err := decodeJSONBody(r, &settings); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	saved, err := s.dailyLuckSignService.SaveSettings(r.Context(), account.ID, settings)
	if err != nil {
		s.writeDailyLuckSignError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleDailyLuckSignHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	records, err := s.dailyLuckSignService.ListCompletions(r.Context(), account.ID)
	if err != nil {
		s.writeDailyLuckSignError(w, err)
		return
	}
	if records == nil {
		records = []dailylucksign.Completion{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": records})
}

func (s *Server) handleDailyLuckSignAddCompletion(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var item dailylucksign.Completion
	if err := decodeJSONBody(r, &item); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	created, err := s.dailyLuckSignService.AddCompletion(r.Context(), account.ID, item)
	if err != nil {
		s.writeDailyLuckSignError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleDailyLuckSignDeleteCompletion(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	err := s.dailyLuckSignService.DeleteCompletion(r.Context(), account.ID, r.PathValue("id"))
	if err != nil {
		s.writeDailyLuckSignError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) writeDailyLuckSignError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, dailylucksign.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "daily_luck_sign_invalid_input"})
	case errors.Is(err, dailylucksign.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "daily_luck_sign_not_found"})
	default:
		log.Printf("daily luck sign error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}
