package procrastinator

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/config"
)

func TestSuggestStepsUsesDeepSeekAndSanitizes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("unexpected authorization header")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{
				"message": map[string]any{"content": `{
					"summary": "先把桌面上的垃圾清掉",
					"steps": [
						{"title": "只把桌上的垃圾扔掉", "estimatedMinutes": 3},
						{"title": "桌面物品放回原位", "estimatedMinutes": 5},
						{"title": "只把桌上的垃圾扔掉", "estimatedMinutes": 9},
						{"title": "扫地并拖地", "estimatedMinutes": 200}
					]
				}`},
			}},
		})
	}))
	defer server.Close()
	result, err := SuggestSteps(context.Background(), config.DeepSeekConfig{
		APIKey: "test-key", BaseURL: server.URL, Model: "deepseek-chat", RequestTimeout: 5 * time.Second,
	}, SuggestRequest{Title: "整理房间"})
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}
	if !strings.Contains(result.Summary, "垃圾") {
		t.Fatalf("unexpected summary %q", result.Summary)
	}
	if len(result.Steps) != 3 || result.Steps[2].EstimatedMinutes != 120 {
		t.Fatalf("unexpected sanitized steps %+v", result.Steps)
	}
}

func TestSuggestStepsRequiresAPIKey(t *testing.T) {
	_, err := SuggestSteps(context.Background(), config.DeepSeekConfig{}, SuggestRequest{Title: "整理房间"})
	if !errors.Is(err, ErrAIUnavailable) {
		t.Fatalf("expected AI unavailable, got %v", err)
	}
}
