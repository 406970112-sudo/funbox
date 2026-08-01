package foodrecommendation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"my-first-expo-app/backend/internal/config"
)

func TestQueryUsesDeepSeekAnalysis(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("unexpected authorization header")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"content": `{
							"summary": "武侯区优先推荐距离近、人均合适的本地味道",
							"items": [
								{
									"dishId": "cd-dandan-noodles",
									"fitScore": 93,
									"reasons": [
										{"label": "距离近", "text": "距你 650m，步行几分钟就到"},
										{"label": "人均低", "text": "人均 ¥18，快速解决一餐"}
									]
								},
								{
									"dishId": "cd-bingfen",
									"fitScore": 88,
									"reasons": [
										{"label": "解辣", "text": "红糖冰粉是川味大餐后的经典收尾"}
									]
								}
							]
						}`,
					},
				},
			},
		})
	}))
	defer server.Close()

	service := NewService(config.DeepSeekConfig{
		APIKey:         "test-key",
		BaseURL:        server.URL,
		Model:          "deepseek-chat",
		RequestTimeout: 5_000_000_000,
	}, nil)
	result, err := service.Query(context.Background(), Request{
		Query:    "成都市武侯区玉林",
		District: "武侯区",
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if result.AI != AIDeepSeek {
		t.Fatalf("expected deepseek mode, got %q", result.AI)
	}
	if !strings.Contains(result.Summary, "武侯区") {
		t.Fatalf("unexpected summary %q", result.Summary)
	}
	if len(result.Items) == 0 {
		t.Fatal("expected food items")
	}
	if result.Items[0].DishID != "cd-dandan-noodles" {
		t.Fatalf("unexpected top item %q", result.Items[0].DishID)
	}
	if result.Items[0].FitScore != 93 {
		t.Fatalf("unexpected fit score %d", result.Items[0].FitScore)
	}
}

func TestDeepSeekReasonsAreSanitized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"content": `{
							"summary": "测试摘要",
							"items": [
								{
									"dishId": "cd-mapo-tofu",
									"fitScore": 90,
									"reasons": [
										{"label": "外星口味", "text": "不能编造的口味"},
										{"label": "经典", "text": "经典川菜代表"}
									]
								}
							]
						}`,
					},
				},
			},
		})
	}))
	defer server.Close()

	service := NewService(config.DeepSeekConfig{
		APIKey:         "test-key",
		BaseURL:        server.URL,
		Model:          "deepseek-chat",
		RequestTimeout: 5_000_000_000,
	}, nil)
	result, err := service.Query(context.Background(), Request{
		City:     "成都",
		District: "武侯区",
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(result.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(result.Items))
	}
	for _, reason := range result.Items[0].Reasons {
		if reason.Label == "外星口味" {
			t.Fatal("unknown reason label leaked through")
		}
	}
	if len(result.Items[0].Reasons) == 0 {
		t.Fatal("expected fallback reasons")
	}
}
