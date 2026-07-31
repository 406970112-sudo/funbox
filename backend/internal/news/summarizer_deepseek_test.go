package news

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

func TestDeepSeekSummarizerReusesConfiguredCredentialsAndReturnsCitedJSON(t *testing.T) {
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("path = %q, want /chat/completions", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer shared-key" {
			t.Fatalf("Authorization = %q, want shared DeepSeek key", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		response := map[string]any{
			"choices": []map[string]any{{
				"message": map[string]any{
					"content": `{"oneSentence":"DeepSeek 发布新模型。","keyPoints":[{"text":"模型性能有所提升。","sourceIds":["S1"]}],"uncertainty":"公开评测仍需更多验证。"}`,
				},
			}},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	summarizer := NewDeepSeekSummarizer(config.DeepSeekConfig{
		APIKey:         "shared-key",
		BaseURL:        server.URL,
		Model:          "shared-model",
		RequestTimeout: time.Second,
	})
	summary, err := summarizer.Summarize(context.Background(), sampleSummaryEvent())
	if err != nil {
		t.Fatalf("Summarize returned error: %v", err)
	}
	if summary.Status != "generated" || summary.Model != "shared-model" {
		t.Fatalf("summary metadata = %#v", summary)
	}
	if summary.OneSentence != "DeepSeek 发布新模型。" || len(summary.KeyPoints) != 1 {
		t.Fatalf("summary = %#v", summary)
	}
	if received["model"] != "shared-model" {
		t.Fatalf("model = %#v, want shared-model", received["model"])
	}
	format, ok := received["response_format"].(map[string]any)
	if !ok || format["type"] != "json_object" {
		t.Fatalf("response_format = %#v, want json_object", received["response_format"])
	}
	messages, ok := received["messages"].([]any)
	if !ok || len(messages) != 2 {
		t.Fatalf("messages = %#v, want system and user prompts", received["messages"])
	}
	userMessage := messages[1].(map[string]any)["content"].(string)
	if !strings.Contains(userMessage, `"id":"S1"`) || !strings.Contains(userMessage, "新模型性能提升") {
		t.Fatalf("user prompt does not contain bounded source data: %s", userMessage)
	}
}

func TestDeepSeekSummarizerRejectsUnknownSourceReferences(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{
				"message": map[string]any{
					"content": `{"oneSentence":"摘要","keyPoints":[{"text":"未经来源支持的事实","sourceIds":["S9"]}],"uncertainty":""}`,
				},
			}},
		})
	}))
	defer server.Close()

	summarizer := NewDeepSeekSummarizer(config.DeepSeekConfig{
		APIKey:         "shared-key",
		BaseURL:        server.URL,
		Model:          "shared-model",
		RequestTimeout: time.Second,
	})
	_, err := summarizer.Summarize(context.Background(), sampleSummaryEvent())
	if !errors.Is(err, ErrSummaryInvalid) {
		t.Fatalf("err = %v, want ErrSummaryInvalid", err)
	}
}

func TestExtractiveSummaryUsesOnlyEventArticles(t *testing.T) {
	summary := ExtractiveSummary(sampleSummaryEvent())
	if summary.Status != "fallback" || summary.Model != "" {
		t.Fatalf("summary metadata = %#v", summary)
	}
	if summary.OneSentence != "新模型性能提升，推理和编码能力改善。" {
		t.Fatalf("OneSentence = %q", summary.OneSentence)
	}
	if len(summary.KeyPoints) != 1 || len(summary.KeyPoints[0].SourceIDs) != 1 || summary.KeyPoints[0].SourceIDs[0] != "S1" {
		t.Fatalf("KeyPoints = %#v", summary.KeyPoints)
	}
}

func sampleSummaryEvent() Event {
	publishedAt := time.Date(2026, time.July, 31, 1, 0, 0, 0, time.UTC)
	return Event{
		ID:       "evt_1",
		Title:    "DeepSeek 发布新模型",
		Category: CategoryAI,
		Sources: []SourceReference{{
			ID:          "S1",
			Name:        "测试来源",
			URL:         "https://example.com/one",
			PublishedAt: publishedAt,
		}},
		Articles: []Article{{
			Source:      "测试来源",
			Title:       "DeepSeek 发布新模型",
			Description: "新模型性能提升，推理和编码能力改善。",
			URL:         "https://example.com/one",
			PublishedAt: publishedAt,
		}},
	}
}
