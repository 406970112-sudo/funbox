package httpapi

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/foodrecommendation"
)

func registerFoodRecommendationRoutes(mux *http.ServeMux, api *Server) {
	if api.foodRecommendationService == nil {
		return
	}
	mux.HandleFunc(
		"POST /api/v1/food-recommendation/query",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("food-recommendation", api.handleFoodRecommendationQuery)),
	)
	mux.HandleFunc(
		"GET /api/v1/food-recommendation/catalog",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("food-recommendation", api.handleFoodRecommendationCatalog)),
	)
	mux.HandleFunc(
		"POST /api/v1/food-recommendation/feedback",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("food-recommendation", api.handleFoodRecommendationFeedback)),
	)
	mux.HandleFunc(
		"GET /api/v1/food-recommendation/history",
		api.withAuth(api.withRateLimitedAPIPipeline("food-recommendation", api.handleFoodRecommendationHistory)),
	)
	mux.HandleFunc(
		"GET /api/v1/food-recommendation/queries/{queryID}",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("food-recommendation", api.handleFoodRecommendationQueryByID)),
	)
}

func (s *Server) handleFoodRecommendationQuery(w http.ResponseWriter, r *http.Request) {
	var request foodrecommendation.Request
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

	result, err := s.foodRecommendationService.Query(ctx, request, userID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "food_recommendation_failed",
			"detail": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleFoodRecommendationCatalog(w http.ResponseWriter, r *http.Request) {
	result, err := s.foodRecommendationService.Catalog(r.Context())
	if err != nil {
		log.Printf("food recommendation catalog failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "catalog_failed"})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleFoodRecommendationFeedback(w http.ResponseWriter, r *http.Request) {
	var input foodrecommendation.FeedbackInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}

	userID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
	}
	if err := s.foodRecommendationService.Feedback(r.Context(), userID, input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "feedback_failed",
			"detail": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleFoodRecommendationHistory(w http.ResponseWriter, r *http.Request) {
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
	items, err := s.foodRecommendationService.History(r.Context(), account.ID, limit)
	if err != nil {
		log.Printf("food recommendation history failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "history_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleFoodRecommendationQueryByID(w http.ResponseWriter, r *http.Request) {
	userID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
	}
	result, err := s.foodRecommendationService.QueryByID(r.Context(), userID, strings.TrimSpace(r.PathValue("queryID")))
	if err != nil {
		if errors.Is(err, foodrecommendation.ErrQueryNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "food_recommendation_query_not_found"})
			return
		}
		log.Printf("food recommendation query detail failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "query_failed"})
		return
	}
	writeJSON(w, http.StatusOK, result)
}
