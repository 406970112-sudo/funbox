package translation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"my-first-expo-app/backend/internal/config"
)

type Service struct {
	client *http.Client
	cfg    config.DeepSeekConfig
}

type TranslateRequest struct {
	SourceText      string `json:"sourceText"`
	SourceLanguage  string `json:"sourceLanguage"`
	TargetLanguage  string `json:"targetLanguage"`
	Scene           string `json:"scene"`
	Tone            string `json:"tone"`
	PreserveFormat  bool   `json:"preserveFormat"`
	Bilingual       bool   `json:"bilingual"`
	PrioritizeTerms bool   `json:"prioritizeTerms"`
}

type TranslateResponse struct {
	DetectedLanguage string               `json:"detectedLanguage"`
	TargetLanguage   string               `json:"targetLanguage"`
	Summary          string               `json:"summary"`
	Versions         []TranslationVersion `json:"versions"`
	Explanation      Explanation          `json:"explanation"`
	Model            string               `json:"model"`
}

type TranslationVersion struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Summary string `json:"summary"`
	Text    string `json:"text"`
}

type Explanation struct {
	Rationale    []string       `json:"rationale"`
	Alternatives []string       `json:"alternatives"`
	Terminology  []GlossaryItem `json:"terminology"`
}

type GlossaryItem struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Reason string `json:"reason"`
}

type deepSeekResponsePayload struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type deepSeekTranslationPayload struct {
	DetectedLanguage string `json:"detectedLanguage"`
	TargetLanguage   string `json:"targetLanguage"`
	Summary          string `json:"summary"`
	Versions         []struct {
		Label   string `json:"label"`
		Summary string `json:"summary"`
		Text    string `json:"text"`
	} `json:"versions"`
	Explanation Explanation `json:"explanation"`
}

func NewService(cfg config.DeepSeekConfig) *Service {
	return &Service{
		cfg: cfg,
		client: &http.Client{
			Timeout: cfg.RequestTimeout,
		},
	}
}

func (s *Service) Translate(ctx context.Context, request TranslateRequest) (TranslateResponse, error) {
	request = normalizeRequest(request)

	if err := s.validateRequest(request); err != nil {
		return TranslateResponse{}, err
	}

	deepSeekRequestBody := s.buildDeepSeekRequest(request)
	bodyBytes, err := json.Marshal(deepSeekRequestBody)
	if err != nil {
		return TranslateResponse{}, fmt.Errorf("marshal deepseek request failed: %w", err)
	}

	endpoint := strings.TrimRight(s.cfg.BaseURL, "/") + "/chat/completions"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return TranslateResponse{}, fmt.Errorf("build deepseek request failed: %w", err)
	}

	httpRequest.Header.Set("Authorization", "Bearer "+s.cfg.APIKey)
	httpRequest.Header.Set("Content-Type", "application/json")

	httpResponse, err := s.client.Do(httpRequest)
	if err != nil {
		return TranslateResponse{}, fmt.Errorf("request deepseek failed: %w", err)
	}
	defer httpResponse.Body.Close()

	if httpResponse.StatusCode >= 400 {
		var errorBody map[string]any
		_ = json.NewDecoder(httpResponse.Body).Decode(&errorBody)
		return TranslateResponse{}, fmt.Errorf(
			"deepseek request failed with status %d: %s",
			httpResponse.StatusCode,
			extractDeepSeekErrorMessage(errorBody),
		)
	}

	var payload deepSeekResponsePayload
	if err := json.NewDecoder(httpResponse.Body).Decode(&payload); err != nil {
		return TranslateResponse{}, fmt.Errorf("decode deepseek response failed: %w", err)
	}

	rawText := extractDeepSeekText(payload)
	if rawText == "" {
		return TranslateResponse{}, fmt.Errorf("deepseek returned empty translation payload")
	}

	translated, err := decodeTranslationResponse(rawText)
	if err != nil {
		return TranslateResponse{}, err
	}
	if err := validateTranslatedResponse(translated); err != nil {
		return TranslateResponse{}, err
	}

	translated.Model = s.cfg.Model
	return translated, nil
}

func (s *Service) buildDeepSeekRequest(request TranslateRequest) map[string]any {
	return map[string]any{
		"model": s.cfg.Model,
		"messages": []map[string]any{
			{
				"role":    "system",
				"content": buildDeveloperPrompt(),
			},
			{
				"role":    "user",
				"content": buildUserPrompt(request),
			},
		},
		"response_format": map[string]any{
			"type": "json_object",
		},
	}
}

func (s *Service) validateRequest(request TranslateRequest) error {
	if request.SourceText == "" {
		return fmt.Errorf("sourceText is required")
	}

	if len([]rune(request.SourceText)) > s.cfg.MaxTextLength {
		return fmt.Errorf("sourceText exceeds %d characters", s.cfg.MaxTextLength)
	}

	if request.TargetLanguage == "" || request.TargetLanguage == "auto" {
		return fmt.Errorf("targetLanguage is required")
	}

	return nil
}

func normalizeRequest(request TranslateRequest) TranslateRequest {
	request.SourceText = strings.TrimSpace(request.SourceText)
	request.SourceLanguage = strings.TrimSpace(strings.ToLower(request.SourceLanguage))
	request.TargetLanguage = strings.TrimSpace(strings.ToLower(request.TargetLanguage))
	request.Scene = strings.TrimSpace(strings.ToLower(request.Scene))
	request.Tone = strings.TrimSpace(strings.ToLower(request.Tone))
	return request
}

func buildDeveloperPrompt() string {
	schema, _ := json.Marshal(translationJSONSchema())
	return strings.Join([]string{
		"You are an expert translation engine.",
		"Always translate the full source text, never partially translate or leave mixed-language fragments unless the source intentionally contains fixed product names or API identifiers.",
		"Respect the requested scene and tone.",
		"When preserveFormat is true, keep line breaks, numbering, and list structure.",
		"When bilingual is true, still return only translated text in each version; the frontend handles parallel display.",
		"When prioritizeTerms is true, keep terminology consistent across all versions.",
		"The versions array must contain exactly three items in this order: standard, natural, formal. Their id values must be those exact strings.",
		"Return exactly one valid JSON object with no markdown fences or commentary.",
		"The JSON object must match this schema: " + string(schema),
	}, " ")
}

func buildUserPrompt(request TranslateRequest) string {
	payload := map[string]any{
		"sourceText":      request.SourceText,
		"sourceLanguage":  request.SourceLanguage,
		"targetLanguage":  request.TargetLanguage,
		"scene":           request.Scene,
		"tone":            request.Tone,
		"preserveFormat":  request.PreserveFormat,
		"bilingual":       request.Bilingual,
		"prioritizeTerms": request.PrioritizeTerms,
	}

	body, _ := json.Marshal(payload)
	return string(body)
}

func translationJSONSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"detectedLanguage": map[string]any{"type": "string"},
			"targetLanguage":   map[string]any{"type": "string"},
			"summary":          map[string]any{"type": "string"},
			"versions": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"id":      map[string]any{"type": "string"},
						"label":   map[string]any{"type": "string"},
						"summary": map[string]any{"type": "string"},
						"text":    map[string]any{"type": "string"},
					},
					"required":             []string{"id", "label", "summary", "text"},
					"additionalProperties": false,
				},
				"minItems": 3,
			},
			"explanation": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"rationale": map[string]any{
						"type":  "array",
						"items": map[string]any{"type": "string"},
					},
					"alternatives": map[string]any{
						"type":  "array",
						"items": map[string]any{"type": "string"},
					},
					"terminology": map[string]any{
						"type": "array",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"source": map[string]any{"type": "string"},
								"target": map[string]any{"type": "string"},
								"reason": map[string]any{"type": "string"},
							},
							"required":             []string{"source", "target", "reason"},
							"additionalProperties": false,
						},
					},
				},
				"required":             []string{"rationale", "alternatives", "terminology"},
				"additionalProperties": false,
			},
		},
		"required":             []string{"detectedLanguage", "targetLanguage", "summary", "versions", "explanation"},
		"additionalProperties": false,
	}
}

func extractDeepSeekText(payload deepSeekResponsePayload) string {
	for _, choice := range payload.Choices {
		if content := strings.TrimSpace(choice.Message.Content); content != "" {
			return content
		}
	}

	return ""
}

func normalizeJSONResponse(rawText string) string {
	trimmed := strings.TrimSpace(rawText)
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}

	if firstLineEnd := strings.Index(trimmed, "\n"); firstLineEnd >= 0 {
		trimmed = trimmed[firstLineEnd+1:]
	}

	return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(trimmed), "```"))
}

func decodeTranslationResponse(rawText string) (TranslateResponse, error) {
	var payload deepSeekTranslationPayload
	if err := json.Unmarshal([]byte(normalizeJSONResponse(rawText)), &payload); err != nil {
		return TranslateResponse{}, fmt.Errorf("parse translation json failed: %w", err)
	}

	versionIDs := []string{"standard", "natural", "formal"}
	versions := make([]TranslationVersion, 0, len(payload.Versions))
	for index, version := range payload.Versions {
		if index >= len(versionIDs) {
			break
		}
		versions = append(versions, TranslationVersion{
			ID:      versionIDs[index],
			Label:   version.Label,
			Summary: version.Summary,
			Text:    version.Text,
		})
	}

	return TranslateResponse{
		DetectedLanguage: payload.DetectedLanguage,
		TargetLanguage:   payload.TargetLanguage,
		Summary:          payload.Summary,
		Versions:         versions,
		Explanation:      payload.Explanation,
	}, nil
}

func validateTranslatedResponse(response TranslateResponse) error {
	if response.DetectedLanguage == "" || response.TargetLanguage == "" {
		return fmt.Errorf("deepseek returned translation without language metadata")
	}
	if len(response.Versions) != 3 {
		return fmt.Errorf("deepseek returned %d translation versions, expected 3", len(response.Versions))
	}

	for _, version := range response.Versions {
		if version.ID == "" || strings.TrimSpace(version.Text) == "" {
			return fmt.Errorf("deepseek returned an invalid translation version")
		}
	}

	return nil
}

func extractDeepSeekErrorMessage(payload map[string]any) string {
	errorValue, ok := payload["error"].(map[string]any)
	if !ok {
		return "unknown_error"
	}

	message, ok := errorValue["message"].(string)
	if !ok || strings.TrimSpace(message) == "" {
		return "unknown_error"
	}

	return message
}
