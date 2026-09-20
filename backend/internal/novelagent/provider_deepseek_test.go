package novelagent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"my-first-expo-app/backend/internal/config"
)

func TestDeepSeekProviderSendsRoleModelAndParsesUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/chat/completions" {
			t.Fatalf("path = %s, want /chat/completions", request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload["model"] != "writer-model" {
			t.Fatalf("model = %v, want writer-model", payload["model"])
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"model":"writer-model","choices":[{"message":{"content":"{\"title\":\"x\"}"}}],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}`))
	}))
	defer server.Close()

	provider := NewDeepSeekProvider(
		config.DeepSeekConfig{APIKey: "test-key", BaseURL: server.URL},
		config.NovelAgentConfig{ModelA: "planner-model", ModelB: "writer-model", ModelC: "reviewer-model", MaxOutputTokens: 123},
		server.Client(),
	)
	result, err := provider.Generate(context.Background(), GenerateRequest{Role: RoleWriter, SystemPrompt: "system", UserPrompt: "user"})
	if err != nil {
		t.Fatalf("Generate() error = %v", err)
	}
	if result.Content != `{"title":"x"}` || result.Model != "writer-model" || result.TotalTokens != 18 {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestDeepSeekProviderDoesNotExposeUpstreamBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Error(writer, `{"error":{"message":"secret upstream detail"}}`, http.StatusTooManyRequests)
	}))
	defer server.Close()

	provider := NewDeepSeekProvider(
		config.DeepSeekConfig{APIKey: "test-key", BaseURL: server.URL},
		config.NovelAgentConfig{ModelA: "planner-model", ModelB: "writer-model", ModelC: "reviewer-model"},
		server.Client(),
	)
	_, err := provider.Generate(context.Background(), GenerateRequest{Role: RolePlanner})
	if err == nil || err.Error() == "" {
		t.Fatal("Generate() expected an HTTP error")
	}
	if contains := err.Error(); contains == "" || strings.Contains(contains, "secret upstream detail") {
		t.Fatalf("error leaked upstream body: %v", err)
	}
}
