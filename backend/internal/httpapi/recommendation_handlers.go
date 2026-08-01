package httpapi

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/recommendation"
)

func registerRecommendationRoutes(mux *http.ServeMux, api *Server) {
	if api.recommendationService == nil {
		return
	}
	mux.HandleFunc(
		"POST /api/v1/product-recommendation/query",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("product-recommendation", api.handleProductRecommendationQuery)),
	)
	mux.HandleFunc(
		"GET /api/v1/product-recommendation/catalog",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("product-recommendation", api.handleProductRecommendationCatalog)),
	)
	mux.HandleFunc(
		"POST /api/v1/product-recommendation/feedback",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("product-recommendation", api.handleProductRecommendationFeedback)),
	)
	mux.HandleFunc(
		"GET /api/v1/product-recommendation/history",
		api.withAuth(api.withRateLimitedAPIPipeline("product-recommendation", api.handleProductRecommendationHistory)),
	)
	mux.HandleFunc(
		"GET /api/v1/product-recommendation/queries/{queryID}",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("product-recommendation", api.handleProductRecommendationQueryByID)),
	)
}

func (s *Server) handleProductRecommendationQuery(w http.ResponseWriter, r *http.Request) {
	var request recommendation.Request
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}

	userID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
	}
	timeout := s.cfg.DeepSeek.RequestTimeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	result, err := s.recommendationService.Query(ctx, request, userID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "recommendation_failed",
			"detail": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleProductRecommendationCatalog(w http.ResponseWriter, r *http.Request) {
	result, err := s.recommendationService.Catalog(r.Context())
	if err != nil {
		log.Printf("product recommendation catalog failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "catalog_failed"})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleProductRecommendationFeedback(w http.ResponseWriter, r *http.Request) {
	var input recommendation.FeedbackInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}

	userID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
	}
	if err := s.recommendationService.Feedback(r.Context(), userID, input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "feedback_failed",
			"detail": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleProductRecommendationHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	limit := 20
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			limit = value
		}
	}
	items, err := s.recommendationService.History(r.Context(), account.ID, limit)
	if err != nil {
		log.Printf("product recommendation history failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "history_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleProductRecommendationQueryByID(w http.ResponseWriter, r *http.Request) {
	userID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
	}
	result, err := s.recommendationService.QueryByID(r.Context(), userID, strings.TrimSpace(r.PathValue("queryID")))
	if err != nil {
		if errors.Is(err, recommendation.ErrQueryNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "recommendation_query_not_found"})
			return
		}
		log.Printf("product recommendation query detail failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, result)
}
