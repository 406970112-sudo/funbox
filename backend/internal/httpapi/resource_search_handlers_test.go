package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/resourcesearch"
)

func TestResourceSearchRoutes(t *testing.T) {
	service := &resourceSearchStub{
		searchResult: resourcesearch.SourceResult{
			Count:    1,
			Query:    "测试",
			SourceID: "laoer-motewan",
			Status:   resourcesearch.StatusSuccess,
			Results:  []resourcesearch.Result{{ID: "result-one", SourceID: "laoer-motewan", Title: "测试资源"}},
		},
		resolved: resourcesearch.ResolvedResult{ResultID: "result-one", TargetURL: "https://pan.quark.cn/s/example"},
	}
	api := &Server{
		cfg:                   config.Config{},
		rateLimiter:           NewRateLimiter(time.Minute, 20),
		resourceSearchService: service,
	}
	mux := http.NewServeMux()
	registerResourceSearchRoutes(mux, api)
	server := httptest.NewServer(api.withGlobalMiddleware(mux))
	t.Cleanup(server.Close)

	response, err := http.Get(server.URL + "/api/v1/resource-search/search?q=%E6%B5%8B%E8%AF%95&source=laoer-motewan")
	if err != nil {
		t.Fatalf("search request failed: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected search status %d", response.StatusCode)
	}
	var result resourcesearch.SourceResult
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode search response: %v", err)
	}
	if result.Count != 1 || service.searchSource != "laoer-motewan" {
		t.Fatalf("unexpected search result %#v", result)
	}

	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/resource-search/results/result-one/resolve", nil)
	if err != nil {
		t.Fatalf("build resolve request: %v", err)
	}
	resolveResponse, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("resolve request failed: %v", err)
	}
	defer resolveResponse.Body.Close()
	if resolveResponse.StatusCode != http.StatusOK || service.resolveID != "result-one" {
		t.Fatalf("unexpected resolve status %d", resolveResponse.StatusCode)
	}
}

func TestResolveExpiredResult(t *testing.T) {
	api := &Server{
		cfg:                   config.Config{},
		rateLimiter:           NewRateLimiter(time.Minute, 20),
		resourceSearchService: &resourceSearchStub{resolveErr: resourcesearch.ErrResultNotFound},
	}
	mux := http.NewServeMux()
	registerResourceSearchRoutes(mux, api)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/resource-search/results/expired/resolve", nil)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", recorder.Code)
	}
}

type resourceSearchStub struct {
	resolveErr   error
	resolveID    string
	resolved     resourcesearch.ResolvedResult
	searchErr    error
	searchQuery  string
	searchResult resourcesearch.SourceResult
	searchSource string
}

func (s *resourceSearchStub) Search(_ context.Context, sourceID string, query string) (resourcesearch.SourceResult, error) {
	s.searchSource = sourceID
	s.searchQuery = query
	return s.searchResult, s.searchErr
}

func (s *resourceSearchStub) Resolve(_ context.Context, resultID string) (resourcesearch.ResolvedResult, error) {
	s.resolveID = resultID
	return s.resolved, s.resolveErr
}

func (s *resourceSearchStub) Sources(context.Context) ([]resourcesearch.PublicSource, error) {
	return nil, nil
}

func (s *resourceSearchStub) ListSources(context.Context, resourcesearch.SourceFilter) ([]resourcesearch.PublicSource, error) {
	return nil, nil
}

func (s *resourceSearchStub) GetSource(context.Context, string) (resourcesearch.Source, error) {
	return resourcesearch.Source{}, resourcesearch.ErrSourceNotFound
}

func (s *resourceSearchStub) CreateSource(context.Context, string, resourcesearch.SourceInput) (resourcesearch.Source, error) {
	return resourcesearch.Source{}, nil
}

func (s *resourceSearchStub) UpdateSource(context.Context, string, string, resourcesearch.SourceInput) (resourcesearch.Source, error) {
	return resourcesearch.Source{}, nil
}

func (s *resourceSearchStub) SetSourceEnabled(context.Context, string, string, bool) (resourcesearch.Source, error) {
	return resourcesearch.Source{}, nil
}

func (s *resourceSearchStub) DeleteSource(context.Context, string, string) (resourcesearch.Source, error) {
	return resourcesearch.Source{}, nil
}

func (s *resourceSearchStub) HealthCheck(context.Context, string, string) (resourcesearch.HealthResult, error) {
	return resourcesearch.HealthResult{}, nil
}

func (s *resourceSearchStub) HealthCheckURL(context.Context, string, int64, string) (resourcesearch.HealthResult, error) {
	return resourcesearch.HealthResult{}, nil
}

func (s *resourceSearchStub) HealthCheckAll(context.Context) ([]resourcesearch.HealthResult, error) {
	return nil, nil
}

func (s *resourceSearchStub) TestSearch(context.Context, string, string, string) (resourcesearch.TestResult, error) {
	return resourcesearch.TestResult{}, nil
}

func (s *resourceSearchStub) TestSearchInput(context.Context, string, resourcesearch.SourceInput, string) (resourcesearch.TestResult, error) {
	return resourcesearch.TestResult{}, nil
}

func (s *resourceSearchStub) Stats(context.Context, int) (resourcesearch.AdminStats, error) {
	return resourcesearch.AdminStats{}, nil
}

func (s *resourceSearchStub) Store() *resourcesearch.Store {
	return nil
}

var _ resourceSearchService = (*resourceSearchStub)(nil)
