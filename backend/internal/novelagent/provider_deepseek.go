package novelagent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"my-first-expo-app/backend/internal/config"
)

type DeepSeekProvider struct {
	apiKey    string
	baseURL   string
	models    map[Role]string
	maxOutput int
	client    *http.Client
}

type deepSeekChatRequest struct {
	Model          string            `json:"model"`
	Messages       []deepSeekMessage `json:"messages"`
	ResponseFormat map[string]string `json:"response_format"`
	MaxTokens      int               `json:"max_tokens,omitempty"`
}

type deepSeekMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type deepSeekChatResponse struct {
	Choices []struct {
		Message deepSeekMessage `json:"message"`
	} `json:"choices"`
	Model string `json:"model"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func NewDeepSeekProvider(deepSeek config.DeepSeekConfig, novel config.NovelAgentConfig, client *http.Client) *DeepSeekProvider {
	if client == nil {
		client = &http.Client{Timeout: novel.RequestTimeout}
	}
	return &DeepSeekProvider{
		apiKey:    deepSeek.APIKey,
		baseURL:   strings.TrimRight(deepSeek.BaseURL, "/"),
		models:    map[Role]string{RolePlanner: novel.ModelA, RoleWriter: novel.ModelB, RoleReviewer: novel.ModelC},
		maxOutput: novel.MaxOutputTokens,
		client:    client,
	}
}

func (p *DeepSeekProvider) Generate(ctx Context, request GenerateRequest) (GenerateResponse, error) {
	model := p.models[request.Role]
	if model == "" {
		return GenerateResponse{}, fmt.Errorf("unsupported novel agent role %q", request.Role)
	}
	if strings.TrimSpace(p.apiKey) == "" {
		return GenerateResponse{}, fmt.Errorf("deepseek API key is not configured")
	}

	body, err := json.Marshal(deepSeekChatRequest{
		Model: model,
		Messages: []deepSeekMessage{
			{Role: "system", Content: request.SystemPrompt},
			{Role: "user", Content: request.UserPrompt},
		},
		ResponseFormat: map[string]string{"type": "json_object"},
		MaxTokens:      p.maxOutput,
	})
	if err != nil {
		return GenerateResponse{}, fmt.Errorf("marshal model request: %w", err)
	}

	httpRequest, err := http.NewRequestWithContext(contextFromInterface(ctx), http.MethodPost, p.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return GenerateResponse{}, fmt.Errorf("build model request: %w", err)
	}
	httpRequest.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")

	response, err := p.client.Do(httpRequest)
	if err != nil {
		return GenerateResponse{}, fmt.Errorf("request model: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		return GenerateResponse{}, fmt.Errorf("model request returned HTTP %d", response.StatusCode)
	}

	var payload deepSeekChatResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return GenerateResponse{}, fmt.Errorf("decode model response: %w", err)
	}
	for _, choice := range payload.Choices {
		if content := strings.TrimSpace(choice.Message.Content); content != "" {
			modelName := payload.Model
			if modelName == "" {
				modelName = model
			}
			return GenerateResponse{
				Content:          content,
				Model:            modelName,
				PromptTokens:     payload.Usage.PromptTokens,
				CompletionTokens: payload.Usage.CompletionTokens,
				TotalTokens:      payload.Usage.TotalTokens,
			}, nil
		}
	}
	return GenerateResponse{}, fmt.Errorf("model returned empty content")
}

func contextFromInterface(ctx Context) context.Context {
	if native, ok := ctx.(context.Context); ok {
		return native
	}
	return context.Background()
}
