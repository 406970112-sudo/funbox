package news

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"my-first-expo-app/backend/internal/config"
)

var (
	ErrSummaryInvalid     = errors.New("news summary invalid")
	ErrSummaryUnavailable = errors.New("news summary unavailable")
)

const maxDeepSeekResponseBytes = 1 << 20

type DeepSeekSummarizer struct {
	cfg    config.DeepSeekConfig
	client *http.Client
}

type deepSeekSummaryResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type summaryPayload struct {
	OneSentence string     `json:"oneSentence"`
	KeyPoints   []KeyPoint `json:"keyPoints"`
	Uncertainty string     `json:"uncertainty"`
}

type promptSource struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

func NewDeepSeekSummarizer(cfg config.DeepSeekConfig) *DeepSeekSummarizer {
	return &DeepSeekSummarizer{
		cfg: cfg,
		client: &http.Client{
			Timeout: cfg.RequestTimeout,
		},
	}
}

func (s *DeepSeekSummarizer) Summarize(ctx context.Context, event Event) (Summary, error) {
	if strings.TrimSpace(s.cfg.APIKey) == "" || strings.TrimSpace(s.cfg.BaseURL) == "" {
		return Summary{}, ErrSummaryUnavailable
	}

	requestBody := map[string]any{
		"model": s.cfg.Model,
		"messages": []map[string]any{
			{
				"role":    "system",
				"content": buildSummarySystemPrompt(),
			},
			{
				"role":    "user",
				"content": buildSummaryUserPrompt(event),
			},
		},
		"response_format": map[string]any{"type": "json_object"},
	}
	body, err := json.Marshal(requestBody)
	if err != nil {
		return Summary{}, fmt.Errorf("marshal deepseek summary request: %w", err)
	}

	endpoint := strings.TrimRight(s.cfg.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return Summary{}, fmt.Errorf("build deepseek summary request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return Summary{}, fmt.Errorf("%w: %v", ErrSummaryUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		return Summary{}, fmt.Errorf("%w: deepseek returned %d", ErrSummaryUnavailable, resp.StatusCode)
	}

	limitedBody, err := io.ReadAll(io.LimitReader(resp.Body, maxDeepSeekResponseBytes+1))
	if err != nil {
		return Summary{}, fmt.Errorf("%w: %v", ErrSummaryUnavailable, err)
	}
	if len(limitedBody) > maxDeepSeekResponseBytes {
		return Summary{}, fmt.Errorf("%w: response too large", ErrSummaryInvalid)
	}
	var response deepSeekSummaryResponse
	if err := json.Unmarshal(limitedBody, &response); err != nil {
		return Summary{}, fmt.Errorf("%w: decode response: %v", ErrSummaryInvalid, err)
	}
	rawContent := ""
	for _, choice := range response.Choices {
		if content := strings.TrimSpace(choice.Message.Content); content != "" {
			rawContent = content
			break
		}
	}
	if rawContent == "" {
		return Summary{}, fmt.Errorf("%w: empty model content", ErrSummaryInvalid)
	}

	var payload summaryPayload
	if err := json.Unmarshal([]byte(normalizeSummaryJSON(rawContent)), &payload); err != nil {
		return Summary{}, fmt.Errorf("%w: decode summary json: %v", ErrSummaryInvalid, err)
	}
	if err := validateSummaryPayload(payload, event); err != nil {
		return Summary{}, err
	}
	return Summary{
		OneSentence: strings.TrimSpace(payload.OneSentence),
		KeyPoints:   payload.KeyPoints,
		Uncertainty: strings.TrimSpace(payload.Uncertainty),
		Status:      "generated",
		Model:       s.cfg.Model,
	}, nil
}

func buildSummarySystemPrompt() string {
	return strings.Join([]string{
		"你是新闻摘要编辑，只能使用用户提供的来源内容，不得补充外部事实。",
		"合并重复信息，明确区分已确认事实与不确定信息。",
		"返回且仅返回一个 JSON 对象：oneSentence 为一句话摘要，keyPoints 为 1 到 4 条关键事实，每条包含 text 和 sourceIds，uncertainty 描述尚未确认的信息。",
		"sourceIds 只能使用输入中存在的来源编号，禁止编造来源编号。",
	}, " ")
}

func buildSummaryUserPrompt(event Event) string {
	sources := make([]promptSource, 0, len(event.Sources))
	for index, source := range event.Sources {
		article := Article{}
		if index < len(event.Articles) {
			article = event.Articles[index]
		}
		sources = append(sources, promptSource{
			ID:          source.ID,
			Name:        source.Name,
			Title:       truncateRunes(article.Title, 160),
			Description: truncateRunes(article.Description, 800),
		})
	}
	payload := map[string]any{
		"eventTitle": event.Title,
		"sources":    sources,
	}
	encoded, _ := json.Marshal(payload)
	return string(encoded)
}

func validateSummaryPayload(payload summaryPayload, event Event) error {
	if strings.TrimSpace(payload.OneSentence) == "" {
		return fmt.Errorf("%w: oneSentence is empty", ErrSummaryInvalid)
	}
	if len(payload.KeyPoints) < 1 || len(payload.KeyPoints) > 4 {
		return fmt.Errorf("%w: keyPoints count must be 1..4", ErrSummaryInvalid)
	}
	allowedSources := make(map[string]struct{}, len(event.Sources))
	for _, source := range event.Sources {
		allowedSources[source.ID] = struct{}{}
	}
	for index := range payload.KeyPoints {
		point := &payload.KeyPoints[index]
		point.Text = strings.TrimSpace(point.Text)
		if point.Text == "" || len(point.SourceIDs) == 0 {
			return fmt.Errorf("%w: key point is missing text or sources", ErrSummaryInvalid)
		}
		seen := make(map[string]struct{}, len(point.SourceIDs))
		normalizedIDs := make([]string, 0, len(point.SourceIDs))
		for _, sourceID := range point.SourceIDs {
			if _, exists := allowedSources[sourceID]; !exists {
				return fmt.Errorf("%w: unknown source %s", ErrSummaryInvalid, sourceID)
			}
			if _, duplicate := seen[sourceID]; duplicate {
				continue
			}
			seen[sourceID] = struct{}{}
			normalizedIDs = append(normalizedIDs, sourceID)
		}
		point.SourceIDs = normalizedIDs
	}
	return nil
}

func ExtractiveSummary(event Event) Summary {
	keyPoints := make([]KeyPoint, 0, minInt(3, len(event.Articles)))
	for index, article := range event.Articles {
		if len(keyPoints) == 3 {
			break
		}
		text := strings.TrimSpace(article.Description)
		if text == "" {
			text = strings.TrimSpace(article.Title)
		}
		if text == "" {
			continue
		}
		sourceID := ""
		if index < len(event.Sources) {
			sourceID = event.Sources[index].ID
		}
		if sourceID == "" {
			continue
		}
		keyPoints = append(keyPoints, KeyPoint{
			Text:      truncateRunes(text, 140),
			SourceIDs: []string{sourceID},
		})
	}
	oneSentence := ""
	if len(keyPoints) > 0 {
		oneSentence = keyPoints[0].Text
	} else {
		oneSentence = truncateRunes(strings.TrimSpace(event.Title), 140)
	}
	return Summary{
		OneSentence: oneSentence,
		KeyPoints:   keyPoints,
		Uncertainty: "AI 摘要暂不可用，当前内容来自来源标题与导语。",
		Status:      "fallback",
	}
}

func normalizeSummaryJSON(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}
	if firstLineEnd := strings.Index(trimmed, "\n"); firstLineEnd >= 0 {
		trimmed = trimmed[firstLineEnd+1:]
	}
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(trimmed), "```"))
}

func truncateRunes(value string, maximum int) string {
	runes := []rune(value)
	if maximum <= 0 || len(runes) <= maximum {
		return value
	}
	return strings.TrimSpace(string(runes[:maximum])) + "…"
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
