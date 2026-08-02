package httpapi

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/cookingguide"
)

func registerCookingGuideRoutes(mux *http.ServeMux, api *Server) {
	if api.cookingGuideService == nil {
		return
	}
	mux.HandleFunc(
		"GET /api/v1/cooking-guide/areas",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideAreas)),
	)
	mux.HandleFunc(
		"GET /api/v1/cooking-guide/dishes",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideDishes)),
	)
	mux.HandleFunc(
		"GET /api/v1/cooking-guide/dishes/{dishID}",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideDishDetail)),
	)
	mux.HandleFunc(
		"GET /api/v1/cooking-guide/dishes/{dishID}/shopping-list",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideShoppingList)),
	)
	mux.HandleFunc(
		"POST /api/v1/cooking-guide/sessions",
		api.withAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideSaveSession)),
	)
	mux.HandleFunc(
		"GET /api/v1/cooking-guide/history",
		api.withAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideHistory)),
	)
	mux.HandleFunc(
		"POST /api/v1/cooking-guide/views",
		api.withAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideRecordView)),
	)
	mux.HandleFunc(
		"POST /api/v1/cooking-guide/feedback",
		api.withOptionalAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideFeedback)),
	)
	mux.HandleFunc(
		"GET /api/v1/cooking-guide/favorites",
		api.withAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideFavorites)),
	)
	mux.HandleFunc(
		"POST /api/v1/cooking-guide/favorites",
		api.withAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideAddFavorite)),
	)
	mux.HandleFunc(
		"DELETE /api/v1/cooking-guide/favorites/{dishID}",
		api.withAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideRemoveFavorite)),
	)
	mux.HandleFunc(
		"POST /api/v1/cooking-guide/contributions",
		api.withAuth(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideCreateContribution)),
	)
	mux.HandleFunc(
		"GET /api/v1/admin/cooking-guide/contributions",
		api.withAuth(api.withAdmin(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideListContributions))),
	)
	mux.HandleFunc(
		"PATCH /api/v1/admin/cooking-guide/contributions/{contributionID}",
		api.withAuth(api.withAdmin(api.withRateLimitedAPIPipeline("cooking-guide", api.handleCookingGuideReviewContribution))),
	)
}

func (s *Server) handleCookingGuideAreas(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.cookingGuideService.Areas())
}

func (s *Server) handleCookingGuideDishes(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	area := strings.TrimSpace(r.URL.Query().Get("area"))
	category := strings.TrimSpace(r.URL.Query().Get("category"))
	tag := strings.TrimSpace(r.URL.Query().Get("tag"))
	limit := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			limit = value
		}
	}
	writeJSON(w, http.StatusOK, s.cookingGuideService.Search(r.Context(), query, area, category, tag, limit))
}

func (s *Server) handleCookingGuideDishDetail(w http.ResponseWriter, r *http.Request) {
	dishID := strings.TrimSpace(r.PathValue("dishID"))
	detail, err := s.cookingGuideService.Detail(r.Context(), dishID)
	if err != nil {
		if errors.Is(err, cookingguide.ErrDishNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "cooking_guide_dish_not_found"})
			return
		}
		log.Printf("cooking guide dish detail failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "dish_detail_failed"})
		return
	}
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		if err := s.cookingGuideService.RecordView(r.Context(), account.ID, dishID); err != nil {
			log.Printf("cooking guide record view failed: %v", err)
		}
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handleCookingGuideShoppingList(w http.ResponseWriter, r *http.Request) {
	result, err := s.cookingGuideService.ShoppingList(r.Context(), strings.TrimSpace(r.PathValue("dishID")))
	if err != nil {
		if errors.Is(err, cookingguide.ErrDishNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "cooking_guide_dish_not_found"})
			return
		}
		log.Printf("cooking guide shopping list failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "shopping_list_failed"})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleCookingGuideSaveSession(w http.ResponseWriter, r *http.Request) {
	var input cookingguide.SessionInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	session, err := s.cookingGuideService.SaveSession(r.Context(), account.ID, input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "session_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) handleCookingGuideHistory(w http.ResponseWriter, r *http.Request) {
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
	items, err := s.cookingGuideService.History(r.Context(), account.ID, limit)
	if err != nil {
		log.Printf("cooking guide history failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "history_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCookingGuideRecordView(w http.ResponseWriter, r *http.Request) {
	var input struct {
		DishID string `json:"dishId"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.cookingGuideService.RecordView(r.Context(), account.ID, input.DishID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "view_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleCookingGuideFeedback(w http.ResponseWriter, r *http.Request) {
	var input cookingguide.FeedbackInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	userID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
	}
	if err := s.cookingGuideService.Feedback(r.Context(), userID, input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "feedback_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleCookingGuideFavorites(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.cookingGuideService.ListFavorites(r.Context(), account.ID)
	if err != nil {
		log.Printf("cooking guide favorites failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "favorites_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCookingGuideAddFavorite(w http.ResponseWriter, r *http.Request) {
	var input struct {
		DishID string `json:"dishId"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.cookingGuideService.AddFavorite(r.Context(), account.ID, input.DishID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "favorite_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleCookingGuideRemoveFavorite(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.cookingGuideService.RemoveFavorite(r.Context(), account.ID, strings.TrimSpace(r.PathValue("dishID"))); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "favorite_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleCookingGuideCreateContribution(w http.ResponseWriter, r *http.Request) {
	var input cookingguide.ContributionInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.cookingGuideService.CreateContribution(r.Context(), account.ID, input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "contribution_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleCookingGuideListContributions(w http.ResponseWriter, r *http.Request) {
	items, err := s.cookingGuideService.ListContributions(r.Context(), strings.TrimSpace(r.URL.Query().Get("status")))
	if err != nil {
		log.Printf("cooking guide contributions failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "contributions_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCookingGuideReviewContribution(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Status string `json:"status"`
		Note   string `json:"note,omitempty"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.cookingGuideService.ReviewContribution(
		r.Context(),
		strings.TrimSpace(r.PathValue("contributionID")),
		input.Status,
		account.ID,
		input.Note,
	)
	if err != nil {
		if errors.Is(err, cookingguide.ErrContributionNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "contribution_not_found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "review_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, item)
}
