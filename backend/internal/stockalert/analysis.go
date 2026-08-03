package stockalert

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
)

type DeepSeekClient struct {
	BaseURL string
	APIKey  string
	Model   string
	client  *http.Client
}

func NewDeepSeekClient(baseURL string, apiKey string, model string, timeout time.Duration) *DeepSeekClient {
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	return &DeepSeekClient{
		BaseURL: baseURL,
		APIKey:  apiKey,
		Model:   model,
		client:  &http.Client{Timeout: timeout},
	}
}

type rulePayload struct {
	BuySignal struct {
		TriggerPrice  float64  `json:"triggerPrice"`
		Conditions    []string `json:"conditions"`
		ReferenceZone struct {
			Low  float64 `json:"low"`
			High float64 `json:"high"`
		} `json:"referenceZone"`
	} `json:"buySignal"`
	SellSignal struct {
		TriggerPrice  float64  `json:"triggerPrice"`
		Conditions    []string `json:"conditions"`
		ReferenceZone struct {
			Low  float64 `json:"low"`
			High float64 `json:"high"`
		} `json:"referenceZone"`
	} `json:"sellSignal"`
	StopLoss struct {
		TriggerPrice float64 `json:"triggerPrice"`
		Condition    string  `json:"condition"`
	} `json:"stopLoss"`
	ValidTradingDays int      `json:"validTradingDays"`
	Reasons          []string `json:"reasons"`
	Summary          string   `json:"summary"`
}

func (c *DeepSeekClient) Analyze(ctx context.Context, features Features) (SignalRule, error) {
	if c.APIKey == "" {
		return SignalRule{}, fmt.Errorf("%w: DEEPSEEK_API_KEY 未配置", ErrAnalysisUnavailable)
	}
	featureJSON, _ := json.Marshal(features)
	systemPrompt := strings.Join([]string{
		"You are a disciplined intraday trading assistant.",
		"You only receive real OHLCV and intraday features. Never invent news, earnings, policy, or price data.",
		"Generate one JSON object with exact schema: buySignal(triggerPrice, conditions, referenceZone), sellSignal(triggerPrice, conditions, referenceZone), stopLoss(triggerPrice, condition), validTradingDays, reasons, summary.",
		"Every triggerPrice must be a concrete price based on the provided features. Conditions must stay within supported primitives: price vs trigger, price vs intraday average, volume ratio, 5-minute change.",
		"Rules: stopLoss.triggerPrice < buySignal.triggerPrice <= sellSignal.triggerPrice.",
		"Return one valid JSON object only, no markdown fences.",
	}, " ")
	userPrompt := "Analyze these real features and return today's intraday signal rules as JSON:\n" + string(featureJSON)

	body, _ := json.Marshal(map[string]any{
		"model": c.Model,
		"messages": []map[string]any{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"response_format": map[string]any{"type": "json_object"},
	})
	endpoint := strings.TrimRight(c.BaseURL, "/") + "/chat/completions"

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return SignalRule{}, err
		}
		request.Header.Set("Authorization", "Bearer "+c.APIKey)
		request.Header.Set("Content-Type", "application/json")
		response, err := c.client.Do(request)
		if err != nil {
			return SignalRule{}, fmt.Errorf("%w: %v", ErrAnalysisUnavailable, err)
		}
		var payload struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		decodeErr := json.NewDecoder(response.Body).Decode(&payload)
		response.Body.Close()
		if decodeErr != nil {
			lastErr = fmt.Errorf("%w: decode response: %v", ErrAnalysisUnavailable, decodeErr)
			continue
		}
		if response.StatusCode >= 400 {
			lastErr = fmt.Errorf("%w: upstream status=%d", ErrAnalysisUnavailable, response.StatusCode)
			continue
		}
		rawText := ""
		for _, choice := range payload.Choices {
			if strings.TrimSpace(choice.Message.Content) != "" {
				rawText = strings.TrimSpace(choice.Message.Content)
				break
			}
		}
		if rawText == "" {
			lastErr = fmt.Errorf("%w: empty model output", ErrAnalysisUnavailable)
			continue
		}
		rule, err := parseRule(rawText, features)
		if err == nil {
			return rule, nil
		}
		lastErr = err
	}
	return SignalRule{}, lastErr
}

func parseRule(rawText string, features Features) (SignalRule, error) {
	var payload rulePayload
	if err := json.Unmarshal([]byte(normalizeJSONResponse(rawText)), &payload); err != nil {
		return SignalRule{}, fmt.Errorf("%w: parse rule json: %v", ErrAnalysisUnavailable, err)
	}
	rule := SignalRule{
		BuyTrigger:        payload.BuySignal.TriggerPrice,
		BuyConditions:     payload.BuySignal.Conditions,
		BuyReferenceLow:   payload.BuySignal.ReferenceZone.Low,
		BuyReferenceHigh:  payload.BuySignal.ReferenceZone.High,
		SellTrigger:       payload.SellSignal.TriggerPrice,
		SellConditions:    payload.SellSignal.Conditions,
		SellReferenceLow:  payload.SellSignal.ReferenceZone.Low,
		SellReferenceHigh: payload.SellSignal.ReferenceZone.High,
		StopLoss:          payload.StopLoss.TriggerPrice,
		ValidTradingDays:  payload.ValidTradingDays,
		Reasons:           payload.Reasons,
		Summary:           payload.Summary,
	}
	if payload.StopLoss.Condition != "" {
		rule.Reasons = append(rule.Reasons, payload.StopLoss.Condition)
	}
	if err := validateRule(rule, features); err != nil {
		return SignalRule{}, err
	}
	return rule, nil
}

func validateRule(rule SignalRule, features Features) error {
	prices := []float64{rule.BuyTrigger, rule.BuyReferenceLow, rule.BuyReferenceHigh, rule.SellTrigger, rule.SellReferenceLow, rule.SellReferenceHigh, rule.StopLoss}
	for _, price := range prices {
		if price <= 0 || math.IsNaN(price) || math.IsInf(price, 0) {
			return fmt.Errorf("%w: invalid price %v", ErrAnalysisUnavailable, price)
		}
	}
	if rule.StopLoss >= rule.BuyTrigger || rule.BuyTrigger > rule.SellTrigger {
		return fmt.Errorf("%w: invalid price ordering", ErrAnalysisUnavailable)
	}
	if rule.BuyReferenceLow <= 0 || rule.BuyReferenceLow > rule.BuyTrigger || rule.BuyTrigger > rule.BuyReferenceHigh {
		return fmt.Errorf("%w: invalid buy reference zone", ErrAnalysisUnavailable)
	}
	if rule.SellReferenceLow <= 0 || rule.SellReferenceLow > rule.SellTrigger || rule.SellTrigger > rule.SellReferenceHigh {
		return fmt.Errorf("%w: invalid sell reference zone", ErrAnalysisUnavailable)
	}
	if features.Low60 > 0 && features.High60 > 0 {
		lower := features.Low60 * 0.9
		upper := features.High60 * 1.1
		for _, price := range prices {
			if price < lower || price > upper {
				return fmt.Errorf("%w: price %v outside real range", ErrAnalysisUnavailable, price)
			}
		}
	}
	if rule.ValidTradingDays < 1 || rule.ValidTradingDays > 20 {
		return fmt.Errorf("%w: invalid validity", ErrAnalysisUnavailable)
	}
	if len(rule.Reasons) == 0 || len(rule.BuyConditions) == 0 || len(rule.SellConditions) == 0 {
		return fmt.Errorf("%w: missing reasons or conditions", ErrAnalysisUnavailable)
	}
	for _, text := range append(append([]string{}, rule.Reasons...), append(rule.BuyConditions, rule.SellConditions...)...) {
		if strings.TrimSpace(text) == "" || len([]rune(text)) > 120 {
			return fmt.Errorf("%w: invalid reason or condition text", ErrAnalysisUnavailable)
		}
	}
	return nil
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
