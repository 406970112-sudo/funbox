package httpapi

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/dnfactivity"
)

type dnfActivityService interface {
	Overview(context.Context) (dnfactivity.Overview, error)
	List(context.Context, dnfactivity.ListQuery) (dnfactivity.ActivityList, error)
	Get(context.Context, string) (dnfactivity.Activity, error)
	Calendar(context.Context, int, int) (dnfactivity.CalendarMonth, error)
	Share(context.Context, string) (dnfactivity.ShareInfo, error)
	AddFavorite(context.Context, string, string) error
	RemoveFavorite(context.Context, string, string) error
	ListFavorites(context.Context, string) ([]dnfactivity.Favorite, error)
}

func registerDnfActivityRoutes(mux *http.ServeMux, api *Server) {
	if api.dnfActivityService == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/dnf-activity/overview", api.withAPIPipeline(api.handleDnfActivityOverview))
	mux.HandleFunc("GET /api/v1/dnf-activity/activities", api.withAPIPipeline(api.handleDnfActivityList))
	mux.HandleFunc("GET /api/v1/dnf-activity/activities/{id}", api.withAPIPipeline(api.handleDnfActivityGet))
	mux.HandleFunc("GET /api/v1/dnf-activity/calendar", api.withAPIPipeline(api.handleDnfActivityCalendar))
	mux.HandleFunc("GET /api/v1/dnf-activity/share/{id}", api.withAPIPipeline(api.handleDnfActivityShare))
	mux.HandleFunc("GET /api/v1/dnf-activity/favorites", api.withAuth(api.withAPIPipeline(api.handleDnfActivityListFavorites)))
	mux.HandleFunc("POST /api/v1/dnf-activity/favorites", api.withAuth(api.withAPIPipeline(api.handleDnfActivityAddFavorite)))
	mux.HandleFunc("DELETE /api/v1/dnf-activity/favorites/{id}", api.withAuth(api.withAPIPipeline(api.handleDnfActivityRemoveFavorite)))
}

func (s *Server) handleDnfActivityOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := s.dnfActivityService.Overview(r.Context())
	if err != nil {
		s.writeDnfActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (s *Server) handleDnfActivityList(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	list, err := s.dnfActivityService.List(r.Context(), dnfactivity.ListQuery{
		Status:   strings.TrimSpace(r.URL.Query().Get("status")),
		Query:    strings.TrimSpace(r.URL.Query().Get("q")),
		Sort:     strings.TrimSpace(r.URL.Query().Get("sort")),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		s.writeDnfActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleDnfActivityGet(w http.ResponseWriter, r *http.Request) {
	activity, err := s.dnfActivityService.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeDnfActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, activity)
}

func (s *Server) handleDnfActivityCalendar(w http.ResponseWriter, r *http.Request) {
	year := 0
	month := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("month")); raw != "" {
		parts := strings.Split(raw, "-")
		if len(parts) == 2 {
			year, _ = strconv.Atoi(parts[0])
			month, _ = strconv.Atoi(parts[1])
		}
	}
	if year == 0 || month == 0 {
		now := time.Now()
		year, month = now.Year(), int(now.Month())
	}
	calendar, err := s.dnfActivityService.Calendar(r.Context(), year, month)
	if err != nil {
		s.writeDnfActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, calendar)
}

func (s *Server) handleDnfActivityShare(w http.ResponseWriter, r *http.Request) {
	info, err := s.dnfActivityService.Share(r.Context(), r.PathValue("id"))
	if err != nil {
		s.writeDnfActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleDnfActivityListFavorites(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	items, err := s.dnfActivityService.ListFavorites(r.Context(), account.ID)
	if err != nil {
		s.writeDnfActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleDnfActivityAddFavorite(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input struct {
		ActivityID string `json:"activityId"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.dnfActivityService.AddFavorite(r.Context(), account.ID, strings.TrimSpace(input.ActivityID)); err != nil {
		s.writeDnfActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"success": true})
}

func (s *Server) handleDnfActivityRemoveFavorite(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	if err := s.dnfActivityService.RemoveFavorite(r.Context(), account.ID, r.PathValue("id")); err != nil {
		s.writeDnfActivityError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) writeDnfActivityError(w http.ResponseWriter, err error) {
	log.Printf("dnf activity request failed: %v", err)
	switch {
	case errors.Is(err, dnfactivity.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "dnf_activity_not_found"})
	case errors.Is(err, dnfactivity.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "dnf_activity_invalid_input"})
	case errors.Is(err, dnfactivity.ErrFavoriteLimit):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "dnf_activity_favorite_limit"})
	case errors.Is(err, dnfactivity.ErrSourceUnavailable), errors.Is(err, dnfactivity.ErrSourceInvalid):
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "dnf_activity_source_unavailable"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_server_error"})
	}
}
