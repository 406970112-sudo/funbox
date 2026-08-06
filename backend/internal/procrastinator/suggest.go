package procrastinator

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"my-first-expo-app/backend/internal/config"
)

type deepSeekResponsePayload struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type deepSeekSuggestPayload struct {
	Summary string `json:"summary"`
	Steps   []struct {
		Title            string `json:"title"`
		EstimatedMinutes int    `json:"estimatedMinutes"`
	} `json:"steps"`
}

func SuggestSteps(ctx context.Context, cfg config.DeepSeekConfig, request SuggestRequest) (SuggestResult, error) {
	request.Title = strings.TrimSpace(request.Title)
	request.Note = strings.TrimSpace(request.Note)
	if _, err := normalizeTitle(request.Title, 60); err != nil {
		return SuggestResult{}, err
	}
	if len([]rune(request.Note)) > 500 {
		return SuggestResult{}, ErrInvalidInput
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return SuggestResult{}, ErrAIUnavailable
	}
	payload := map[string]any{
		"model": cfg.Model,
		"messages": []map[string]any{
			{"role": "system", "content": buildSuggestSystemPrompt()},
			{"role": "user", "content": buildSuggestUserPrompt(request)},
		},
		"response_format": map[string]any{"type": "json_object"},
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return SuggestResult{}, fmt.Errorf("marshal deepseek suggest request: %w", err)
	}
	endpoint := strings.TrimRight(cfg.BaseURL, "/") + "/chat/completions"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return SuggestResult{}, fmt.Errorf("build deepseek suggest request: %w", err)
	}
	httpRequest.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	httpRequest.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: cfg.RequestTimeout}
	httpResponse, err := client.Do(httpRequest)
	if err != nil {
		return SuggestResult{}, fmt.Errorf("request deepseek suggest: %w", err)
	}
	defer httpResponse.Body.Close()
	if httpResponse.StatusCode >= 400 {
		return SuggestResult{}, fmt.Errorf("deepseek suggest request failed with status %d", httpResponse.StatusCode)
	}
	var response deepSeekResponsePayload
	if err := json.NewDecoder(httpResponse.Body).Decode(&response); err != nil {
		return SuggestResult{}, fmt.Errorf("decode deepseek suggest response: %w", err)
	}
	rawText := ""
	for _, choice := range response.Choices {
		if content := strings.TrimSpace(choice.Message.Content); content != "" {
			rawText = content
			break
		}
	}
	if rawText == "" {
		return SuggestResult{}, fmt.Errorf("deepseek suggest returned empty response")
	}
	var parsed deepSeekSuggestPayload
	if err := json.Unmarshal([]byte(normalizeJSON(rawText)), &parsed); err != nil {
		return SuggestResult{}, fmt.Errorf("parse deepseek suggest response: %w", err)
	}
	return sanitizeSuggestResult(parsed)
}

func sanitizeSuggestResult(parsed deepSeekSuggestPayload) (SuggestResult, error) {
	steps := make([]SuggestedStep, 0, len(parsed.Steps))
	seen := map[string]bool{}
	for _, raw := range parsed.Steps {
		title, err := normalizeTitle(raw.Title, 60)
		if err != nil || seen[title] {
			continue
		}
		minutes := raw.EstimatedMinutes
		if minutes < 1 {
			minutes = 5
		}
		if minutes > 120 {
			minutes = 120
		}
		seen[title] = true
		steps = append(steps, SuggestedStep{Title: title, EstimatedMinutes: minutes})
		if len(steps) >= MaxSteps {
			break
		}
	}
	if len(steps) == 0 {
		return SuggestResult{}, ErrInvalidInput
	}
	summary := strings.TrimSpace(parsed.Summary)
	if summary == "" {
		summary = "已生成建议步骤，请确认后保存"
	}
	return SuggestResult{Summary: summary, Steps: steps}, nil
}

func buildSuggestSystemPrompt() string {
	schema, _ := json.Marshal(suggestSchema())
	return strings.Join([]string{
		"You are a practical task breakdown assistant for Chinese users.",
		"Only use the user's own task title and note to generate micro steps.",
		"Each step must describe one small, immediately executable action.",
		"Estimated minutes must be an integer between 1 and 120.",
		"Return 5 to 20 steps unless the task clearly cannot be split that way.",
		"Never invent completed records, fake progress, or unrelated facts.",
		"Return exactly one valid JSON object with no markdown fences or commentary.",
		"The JSON object must match this schema: " + string(schema),
	}, " ")
}

func buildSuggestUserPrompt(request SuggestRequest) string {
	payload := map[string]any{"title": request.Title, "note": request.Note}
	body, _ := json.Marshal(payload)
	return string(body)
}

func suggestSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"summary": map[string]any{"type": "string"},
			"steps": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"title":            map[string]any{"type": "string"},
						"estimatedMinutes": map[string]any{"type": "integer"},
					},
					"required":             []string{"title", "estimatedMinutes"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"summary", "steps"},
		"additionalProperties": false,
	}
}

func normalizeJSON(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}
	if firstLine := strings.Index(trimmed, "\n"); firstLine >= 0 {
		trimmed = trimmed[firstLine+1:]
	}
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(trimmed), "```"))
}
