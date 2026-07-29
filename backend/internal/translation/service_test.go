package translation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/config"
)

func TestTranslateUsesDeepSeekChatCompletions(t *testing.T) {
	var receivedBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("unexpected request path: %s", r.URL.Path)
		}
		if authorization := r.Header.Get("Authorization"); authorization != "Bearer test-key" {
			t.Fatalf("unexpected authorization header: %s", authorization)
		}
		if err := json.NewDecoder(r.Body).Decode(&receivedBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}

		response := map[string]any{
			"choices": []map[string]any{{
				"message": map[string]any{
					"content": `{"detectedLanguage":"zh","targetLanguage":"en","summary":"Translated","versions":[{"id":1,"label":"Standard","summary":"Balanced","text":"Hello"},{"id":2,"label":"Natural","summary":"Natural","text":"Hi"},{"id":3,"label":"Formal","summary":"Formal","text":"Greetings"}],"explanation":{"rationale":[],"alternatives":[],"terminology":[]}}`,
				},
			}},
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Fatalf("encode response: %v", err)
		}
	}))
	defer server.Close()

	service := NewService(config.DeepSeekConfig{
		APIKey:         "test-key",
		BaseURL:        server.URL,
		MaxTextLength:  8000,
		Model:          "deepseek-chat",
		RequestTimeout: time.Second,
	})

	result, err := service.Translate(context.Background(), TranslateRequest{
		SourceText:     "你好",
		SourceLanguage: "auto",
		TargetLanguage: "en",
		Scene:          "general",
		Tone:           "natural",
	})
	if err != nil {
		t.Fatalf("translate: %v", err)
	}

	if receivedBody["model"] != "deepseek-chat" {
		t.Fatalf("unexpected model: %v", receivedBody["model"])
	}
	responseFormat, ok := receivedBody["response_format"].(map[string]any)
	if !ok || responseFormat["type"] != "json_object" {
		t.Fatalf("unexpected response format: %#v", receivedBody["response_format"])
	}
	if result.Model != "deepseek-chat" || result.Versions[0].ID != "standard" || result.Versions[0].Text != "Hello" {
		t.Fatalf("unexpected translation result: %#v", result)
	}
}
