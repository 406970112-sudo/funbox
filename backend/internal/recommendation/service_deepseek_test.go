package recommendation

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
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["model"] != "deepseek-chat" {
			t.Fatalf("unexpected model %v", body["model"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"content": `{
							"summary": "这个预算下优先推荐续航与游戏均衡的机型",
							"items": [
								{
									"productId": "redmi-k80",
									"fitScore": 93,
									"suitableFor": "适合预算 2000-3000、优先续航与游戏的用户",
									"reasons": [
										{"label": "续航", "text": "6550mAh 大电池，重度使用一天一充"},
										{"label": "性能", "text": "骁龙 8 Gen 3 主流游戏高画质流畅"}
									]
								},
								{
									"productId": "realme-gt7",
									"fitScore": 90,
									"suitableFor": "适合追求更强续航的游戏玩家",
									"reasons": [
										{"label": "续航", "text": "7000mAh 超大电池"},
										{"label": "性能", "text": "天玑 9400+ 游戏表现强劲"}
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
	minBudget := 2000
	maxBudget := 3000
	result, err := service.Query(context.Background(), Request{
		Category:  "phone",
		BudgetMin: &minBudget,
		BudgetMax: &maxBudget,
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if result.AI != AIDeepSeek {
		t.Fatalf("expected deepseek mode, got %q", result.AI)
	}
	if !strings.Contains(result.Summary, "续航与游戏") {
		t.Fatalf("unexpected summary %q", result.Summary)
	}
	if len(result.Items) == 0 {
		t.Fatal("expected recommendation items")
	}
	if result.Items[0].ProductID != "redmi-k80" {
		t.Fatalf("unexpected top item %q", result.Items[0].ProductID)
	}
	if result.Items[0].FitScore != 93 {
		t.Fatalf("unexpected fit score %d", result.Items[0].FitScore)
	}
	if len(result.Items[0].Reasons) != 2 {
		t.Fatalf("expected 2 reasons, got %d", len(result.Items[0].Reasons))
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
									"productId": "redmi-k80",
									"fitScore": 88,
									"suitableFor": "适合游戏用户",
									"reasons": [
										{"label": "外星科技", "text": "不能编造的参数"},
										{"label": "续航", "text": "6550mAh 大电池"}
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
	minBudget := 2000
	maxBudget := 3000
	result, err := service.Query(context.Background(), Request{
		Category:  "phone",
		BudgetMin: &minBudget,
		BudgetMax: &maxBudget,
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(result.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(result.Items))
	}
	for _, reason := range result.Items[0].Reasons {
		if reason.Label == "外星科技" {
			t.Fatal("unknown reason label leaked through")
		}
	}
	if len(result.Items[0].Reasons) == 0 {
		t.Fatal("expected sanitized fallback reasons")
	}
}
