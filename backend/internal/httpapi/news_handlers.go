package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/news"
)

type newsFeedService interface {
	Feed(context.Context) (news.FeedSnapshot, error)
}

func registerNewsRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("GET /api/v1/news/feed", api.withAPIPipeline(api.handleNewsFeed))
}

func (s *Server) handleNewsFeed(w http.ResponseWriter, r *http.Request) {
	if s.newsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "news_service_unavailable"})
		return
	}
	category, limit, valid := parseNewsQuery(r)
	if !valid {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_news_query"})
		return
	}

	snapshot, err := s.newsService.Feed(r.Context())
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "news_sources_unavailable"})
		return
	}
	filtered := make([]news.Event, 0, len(snapshot.Events))
	for _, event := range snapshot.Events {
		if category != "" && event.Category != news.Category(category) {
			continue
		}
		filtered = append(filtered, event)
		if limit > 0 && len(filtered) == limit {
			break
		}
	}
	snapshot.Events = filtered
	writeJSON(w, http.StatusOK, snapshot)
}

func parseNewsQuery(r *http.Request) (string, int, bool) {
	category := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("category")))
	if category != "" {
		validCategories := map[string]struct{}{
			string(news.CategoryAI):         {},
			string(news.CategoryTechnology): {},
			string(news.CategoryFinance):    {},
			string(news.CategorySociety):    {},
			string(news.CategoryWorld):      {},
		}
		if _, exists := validCategories[category]; !exists {
			return "", 0, false
		}
	}
	limit := 0
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 100 {
			return "", 0, false
		}
		limit = parsed
	}
	return category, limit, true
}
