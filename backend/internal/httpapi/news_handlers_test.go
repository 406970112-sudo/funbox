package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/news"
)

type fakeNewsFeedService struct {
	err      error
	snapshot news.FeedSnapshot
}

func (f fakeNewsFeedService) Feed(context.Context) (news.FeedSnapshot, error) {
	return f.snapshot, f.err
}

func TestNewsFeedHandlerFiltersCategoryAndLimit(t *testing.T) {
	api := &Server{newsService: fakeNewsFeedService{snapshot: news.FeedSnapshot{
		GeneratedAt: time.Date(2026, time.July, 31, 2, 0, 0, 0, time.UTC),
		DailyBrief:  news.DailyBrief{Title: "今日热点", KeyPoints: []string{"重点"}, EventCount: 3},
		Events: []news.Event{
			{ID: "ai-1", Category: news.CategoryAI, Title: "AI 一", HotScore: 90},
			{ID: "tech-1", Category: news.CategoryTechnology, Title: "科技一", HotScore: 80},
			{ID: "ai-2", Category: news.CategoryAI, Title: "AI 二", HotScore: 70},
		},
	}}}
	mux := http.NewServeMux()
	registerNewsRoutes(mux, api)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/news/feed?category=ai&limit=1", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var snapshot news.FeedSnapshot
	if err := json.NewDecoder(response.Body).Decode(&snapshot); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(snapshot.Events) != 1 || snapshot.Events[0].ID != "ai-1" {
		t.Fatalf("events = %#v, want first AI event", snapshot.Events)
	}
	if snapshot.DailyBrief.EventCount != 3 {
		t.Fatalf("daily brief should describe the full snapshot: %#v", snapshot.DailyBrief)
	}
}

func TestNewsFeedHandlerMapsAvailabilityErrors(t *testing.T) {
	tests := []struct {
		name       string
		service    newsFeedService
		wantStatus int
		wantError  string
	}{
		{name: "disabled", service: nil, wantStatus: http.StatusServiceUnavailable, wantError: "news_service_unavailable"},
		{name: "sources unavailable", service: fakeNewsFeedService{err: news.ErrSourcesUnavailable}, wantStatus: http.StatusBadGateway, wantError: "news_sources_unavailable"},
		{name: "unexpected", service: fakeNewsFeedService{err: errors.New("boom")}, wantStatus: http.StatusBadGateway, wantError: "news_sources_unavailable"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			api := &Server{newsService: test.service}
			response := httptest.NewRecorder()
			api.handleNewsFeed(response, httptest.NewRequest(http.MethodGet, "/api/v1/news/feed", nil))
			if response.Code != test.wantStatus || !strings.Contains(response.Body.String(), test.wantError) {
				t.Fatalf("status/body = %d %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestNewsFeedHandlerRejectsInvalidQuery(t *testing.T) {
	api := &Server{newsService: fakeNewsFeedService{snapshot: news.FeedSnapshot{}}}
	for _, target := range []string{
		"/api/v1/news/feed?category=unknown",
		"/api/v1/news/feed?limit=0",
		"/api/v1/news/feed?limit=not-a-number",
	} {
		response := httptest.NewRecorder()
		api.handleNewsFeed(response, httptest.NewRequest(http.MethodGet, target, nil))
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_news_query") {
			t.Fatalf("target %s: status/body = %d %s", target, response.Code, response.Body.String())
		}
	}
}

var _ newsFeedService = fakeNewsFeedService{}
