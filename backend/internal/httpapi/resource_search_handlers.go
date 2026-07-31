package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"my-first-expo-app/backend/internal/resourcesearch"
)

type resourceSearchService interface {
	Resolve(context.Context, string) (resourcesearch.ResolvedResult, error)
	Search(context.Context, string, string) (resourcesearch.SourceResult, error)
}

func registerResourceSearchRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("GET /api/v1/resource-search/search", api.withRateLimitedAPIPipeline("resource-search", api.handleResourceSearch))
	mux.HandleFunc("POST /api/v1/resource-search/results/{resultID}/resolve", api.withRateLimitedAPIPipeline("resource-search", api.handleResolveResourceResult))
}

func (s *Server) handleResourceSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.Join(strings.Fields(r.URL.Query().Get("q")), " ")
	sourceID := strings.TrimSpace(r.URL.Query().Get("source"))
	if query == "" || len([]rune(query)) > 100 || sourceID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_search_invalid"})
		return
	}

	result, err := s.resourceSearchService.Search(r.Context(), sourceID, query)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"detail": err.Error(),
			"error":  "resource_search_invalid",
		})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleResolveResourceResult(w http.ResponseWriter, r *http.Request) {
	resultID := strings.TrimSpace(r.PathValue("resultID"))
	if resultID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_result_invalid"})
		return
	}

	result, err := s.resourceSearchService.Resolve(r.Context(), resultID)
	if err != nil {
		if errors.Is(err, resourcesearch.ErrResultNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "resource_result_expired"})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "resource_result_resolve_failed"})
		return
	}
	writeJSON(w, http.StatusOK, result)
}
