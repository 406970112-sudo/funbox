package resourcesearch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLaoerProviderSearchAndResolve(t *testing.T) {
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/other/web_search":
			if got := r.URL.Query().Get("title"); got != "流浪地球 2" {
				t.Fatalf("unexpected search title %q", got)
			}
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: {\"title\":\"名称：流浪地球 2 4K 73.5GB\",\"url\":\"/opaque+one\",\"is_type\":0}\n\n"))
			_, _ = w.Write([]byte("data: {\"title\":\"重复结果\",\"url\":\"/opaque+one\",\"is_type\":0}\n\n"))
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
		case "/api/other/save_url":
			var request map[string]string
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Fatalf("decode resolve request: %v", err)
			}
			if !strings.Contains(request["url"], "%2B") {
				t.Fatalf("expected encoded opaque url, got %q", request["url"])
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":200,"data":{"url":"https://pan.quark.cn/s/example"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(providerServer.Close)

	laoer := newLaoerProvider(providerServer.Client(), providerServer.URL)
	service := newService(time.Minute, 20, []provider{laoer})
	response, err := service.Search(context.Background(), laoerSourceID, "  流浪地球   2 ")
	if err != nil {
		t.Fatalf("search failed: %v", err)
	}
	if response.Status != StatusSuccess || response.Count != 1 {
		t.Fatalf("unexpected search response: %#v", response)
	}
	result := response.Results[0]
	if result.Title != "流浪地球 2 4K 73.5GB" || result.Size != "73.5 GB" || !result.RequiresResolve {
		t.Fatalf("unexpected normalized result: %#v", result)
	}

	resolved, err := service.Resolve(context.Background(), result.ID)
	if err != nil {
		t.Fatalf("resolve failed: %v", err)
	}
	if resolved.TargetURL != "https://pan.quark.cn/s/example" || resolved.ResultID != result.ID {
		t.Fatalf("unexpected resolved result: %#v", resolved)
	}
}

func TestServiceCachesSearchAndReportsUnsupportedSources(t *testing.T) {
	var searches atomic.Int32
	stub := &stubProvider{search: func(context.Context, string, int) ([]providerResult, error) {
		searches.Add(1)
		return []providerResult{{Reference: "one", Title: "测试资源"}}, nil
	}}
	service := newService(time.Minute, 20, []provider{stub})

	for range 2 {
		if _, err := service.Search(context.Background(), laoerSourceID, "测试"); err != nil {
			t.Fatalf("cached search failed: %v", err)
		}
	}
	if searches.Load() != 1 {
		t.Fatalf("expected one provider search, got %d", searches.Load())
	}

	unsupported, err := service.Search(context.Background(), "panyq", "测试")
	if err != nil {
		t.Fatalf("unsupported source should return a state: %v", err)
	}
	if unsupported.Status != StatusRestricted || unsupported.FallbackURL == "" {
		t.Fatalf("unexpected unsupported source response: %#v", unsupported)
	}
}

type stubProvider struct {
	search func(context.Context, string, int) ([]providerResult, error)
}

func (s *stubProvider) SourceID() string { return laoerSourceID }

func (s *stubProvider) Search(ctx context.Context, query string, limit int) ([]providerResult, error) {
	return s.search(ctx, query, limit)
}

func (s *stubProvider) Resolve(context.Context, providerResult) (ResolvedResult, error) {
	return ResolvedResult{}, nil
}
