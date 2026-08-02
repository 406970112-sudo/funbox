package foodrecommendation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"my-first-expo-app/backend/internal/config"
)

const (
	AIDeepSeek = "deepseek"
	AIFallback = "fallback"

	disclaimer = "图片、价格与营业时间来自美食库快照，实际以商家页面为准。"
)

type Service struct {
	cfg     config.DeepSeekConfig
	client  *http.Client
	catalog Catalog
	store   *Store
}

type deepSeekResponsePayload struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

type deepSeekAnalysis struct {
	Summary string `json:"summary"`
	Items   []struct {
		DishID   string   `json:"dishId"`
		FitScore int      `json:"fitScore"`
		Reasons  []Reason `json:"reasons"`
	} `json:"items"`
}

func NewService(cfg config.DeepSeekConfig, store *Store) *Service {
	catalog, err := LoadCatalog()
	if err != nil {
		panic(err)
	}
	return &Service{
		cfg:     cfg,
		client:  &http.Client{Timeout: cfg.RequestTimeout},
		catalog: catalog,
		store:   store,
	}
}

func (s *Service) Catalog(_ context.Context) (CatalogResponse, error) {
	return CatalogResponse{
		Dishes:    append([]Dish(nil), s.catalog...),
		UpdatedAt: "2026-08-01T00:00:00Z",
	}, nil
}

func (s *Service) Query(ctx context.Context, request Request, userID string) (Response, error) {
	request = normalizeRequest(request)
	if err := validateRequest(request); err != nil {
		return Response{}, err
	}

	parsed := parseRequest(request)
	candidates := s.recall(parsed)
	ranked := s.rankCandidates(candidates, parsed)
	if len(ranked) > 8 {
		ranked = ranked[:8]
	}

	response := Response{
		QueryID:     "food_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
		City:        parsed.City,
		District:    parsed.District,
		Disclaimer:  disclaimer,
		GeneratedAt: nowISO(),
	}

	if len(ranked) == 0 {
		response.Summary = buildEmptySummary(parsed)
		response.AI = AIFallback
	} else if s.cfg.APIKey == "" {
		response.Summary = buildFallbackSummary(parsed, len(ranked))
		response.AI = AIFallback
		response.Items = buildFallbackItems(ranked, parsed)
	} else {
		analysis, err := s.analyzeWithDeepSeek(ctx, parsed, ranked)
		if err != nil {
			response.Summary = buildFallbackSummary(parsed, len(ranked))
			response.AI = AIFallback
			response.Items = buildFallbackItems(ranked, parsed)
		} else {
			response.Summary = strings.TrimSpace(analysis.Summary)
			if response.Summary == "" {
				response.Summary = buildFallbackSummary(parsed, len(ranked))
			}
			response.AI = AIDeepSeek
			response.Items = mergeAnalysisItems(ranked, analysis, parsed)
		}
	}
	response.AvailableFilters = buildAvailableFilters(response.Items)

	if s.store != nil {
		responseJSON, _ := json.Marshal(response)
		_ = s.store.SaveQuery(ctx, userID, response.QueryID, request.Query, response.City, response.District, string(responseJSON))
	}
	return response, nil
}

func (s *Service) History(ctx context.Context, userID string, limit int) ([]HistoryItem, error) {
	if s.store == nil {
		return []HistoryItem{}, nil
	}
	return s.store.ListQueries(ctx, userID, limit)
}

func (s *Service) QueryByID(ctx context.Context, userID, queryID string) (Response, error) {
	if s.store == nil {
		return Response{}, ErrQueryNotFound
	}
	return s.store.GetQuery(ctx, userID, queryID)
}

func (s *Service) Feedback(ctx context.Context, userID string, input FeedbackInput) error {
	input.Note = strings.TrimSpace(input.Note)
	if len([]rune(input.Note)) > 200 {
		return fmt.Errorf("note exceeds 200 characters")
	}
	if s.store == nil {
		return nil
	}
	return s.store.SaveFeedback(ctx, userID, input)
}

type parsedRequest struct {
	City          string
	District      string
	Cuisines      []string
	Spiciness     []string
	PriceMin      *int
	PriceMax      *int
	DistanceMaxKm *float64
	Dietary       []string
	Scenarios     []string
}

func normalizeRequest(request Request) Request {
	request.Query = strings.TrimSpace(request.Query)
	request.City = strings.TrimSpace(request.City)
	request.District = strings.TrimSpace(request.District)
	request.Cuisines = normalizeTokens(request.Cuisines)
	request.Spiciness = normalizeTokens(request.Spiciness)
	request.Dietary = normalizeTokens(request.Dietary)
	request.Scenarios = normalizeTokens(request.Scenarios)
	return request
}

func validateRequest(request Request) error {
	if strings.TrimSpace(request.Query) == "" && request.City == "" && (request.Lat == nil || request.Lng == nil) {
		return fmt.Errorf("query, city, or coordinates are required")
	}
	if len([]rune(request.Query)) > 200 {
		return fmt.Errorf("query exceeds 200 characters")
	}
	if request.PriceMin != nil && request.PriceMax != nil && *request.PriceMin > *request.PriceMax {
		return fmt.Errorf("priceMin must not exceed priceMax")
	}
	return nil
}

func parseRequest(request Request) parsedRequest {
	parsed := parsedRequest{
		City:          request.City,
		District:      request.District,
		Cuisines:      request.Cuisines,
		Spiciness:     request.Spiciness,
		PriceMin:      request.PriceMin,
		PriceMax:      request.PriceMax,
		DistanceMaxKm: request.DistanceMaxKm,
		Dietary:       request.Dietary,
		Scenarios:     request.Scenarios,
	}
	text := request.Query
	if parsed.City == "" {
		parsed.City = inferCity(text)
	}
	if parsed.District == "" {
		parsed.District = inferDistrict(text, parsed.City)
	}
	if parsed.City == "" && request.Lat != nil && request.Lng != nil {
		if city, district, ok := resolveLocationFromCoords(*request.Lat, *request.Lng); ok {
			parsed.City = city
			parsed.District = district
		}
	}
	if len(parsed.Cuisines) == 0 {
		parsed.Cuisines = inferCuisines(text)
	}
	if len(parsed.Spiciness) == 0 {
		parsed.Spiciness = inferSpiciness(text)
	}
	if parsed.PriceMin == nil && parsed.PriceMax == nil {
		parsed.PriceMin, parsed.PriceMax = inferPrice(text)
	}
	if parsed.DistanceMaxKm == nil {
		parsed.DistanceMaxKm = inferDistance(text)
	}
	if len(parsed.Dietary) == 0 {
		parsed.Dietary = inferDietary(text)
	}
	if len(parsed.Scenarios) == 0 {
		parsed.Scenarios = inferScenarios(text)
	}
	if parsed.City == "" && (request.Lat == nil || request.Lng == nil) {
		parsed.City = "成都"
		parsed.District = "武侯区"
	}
	return parsed
}

func resolveLocationFromCoords(lat, lng float64) (string, string, bool) {
	centers := []struct {
		city     string
		district string
		lat      float64
		lng      float64
		radiusKm float64
	}{
		{city: "成都", district: "武侯区", lat: 30.6409, lng: 104.0611, radiusKm: 30},
		{city: "成都", district: "锦江区", lat: 30.6572, lng: 104.0865, radiusKm: 30},
		{city: "重庆", district: "渝中区", lat: 29.5620, lng: 106.5740, radiusKm: 30},
	}
	best := ""
	bestDistance := math.MaxFloat64
	for _, center := range centers {
		distance := haversineKm(lat, lng, center.lat, center.lng)
		if distance < bestDistance {
			bestDistance = distance
			best = center.city + "|" + center.district
		}
	}
	if bestDistance <= 30 && best != "" {
		parts := strings.Split(best, "|")
		return parts[0], parts[1], true
	}
	return "", "", false
}

func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthRadiusKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func (s *Service) recall(parsed parsedRequest) []Dish {
	dishes := make([]Dish, 0, len(s.catalog))
	for _, dish := range s.catalog {
		if dish.City != parsed.City {
			continue
		}
		if parsed.District != "" && dish.District != parsed.District {
			continue
		}
		if len(parsed.Cuisines) > 0 && !contains(parsed.Cuisines, dish.Cuisine) {
			continue
		}
		if len(parsed.Spiciness) > 0 && !contains(parsed.Spiciness, dish.Spiciness) {
			continue
		}
		if parsed.PriceMin != nil && dish.AvgPrice < *parsed.PriceMin {
			continue
		}
		if parsed.PriceMax != nil && dish.AvgPrice > *parsed.PriceMax {
			continue
		}
		if parsed.DistanceMaxKm != nil && dish.Restaurant.DistanceKm > *parsed.DistanceMaxKm {
			continue
		}
		if !matchesDietary(dish, parsed.Dietary) {
			continue
		}
		if len(parsed.Scenarios) > 0 && !matchesScenarios(dish, parsed.Scenarios) {
			continue
		}
		dishes = append(dishes, dish)
	}
	return dishes
}

func (s *Service) rankCandidates(candidates []Dish, parsed parsedRequest) []Dish {
	scored := append([]Dish(nil), candidates...)
	sort.SliceStable(scored, func(i, j int) bool {
		left := scoreDish(scored[i], parsed)
		right := scoreDish(scored[j], parsed)
		if left == right {
			return scored[i].Restaurant.DistanceKm < scored[j].Restaurant.DistanceKm
		}
		return left > right
	})
	return scored
}

func scoreDish(dish Dish, parsed parsedRequest) int {
	score := 50
	score += int(dish.Rating * 8)
	if dish.Restaurant.DistanceKm <= 1 {
		score += 10
	} else if dish.Restaurant.DistanceKm <= 2 {
		score += 7
	} else if dish.Restaurant.DistanceKm <= 3 {
		score += 4
	}
	if parsed.PriceMin != nil && parsed.PriceMax != nil && dish.AvgPrice >= *parsed.PriceMin && dish.AvgPrice <= *parsed.PriceMax {
		score += 8
	}
	score += minInt(len(matchingScenarios(dish, parsed.Scenarios))*6, 12)
	if len(dish.Reasons) > 0 {
		score += 3
	}
	if score > 99 {
		score = 99
	}
	return score
}

func buildFallbackSummary(parsed parsedRequest, count int) string {
	distanceText := ""
	if parsed.DistanceMaxKm != nil {
		distanceText = fmt.Sprintf("、%.0fkm 内", *parsed.DistanceMaxKm)
	}
	return fmt.Sprintf("为你在%s%s找到 %d 道本地美食，优先推荐距离近、人均合适的代表味道%s。", parsed.City, parsed.District, count, distanceText)
}

func buildEmptySummary(parsed parsedRequest) string {
	if parsed.City == "" {
		return "当前定位暂未覆盖，暂只支持成都武侯区、锦江区和重庆渝中区，可手动输入这些区域地址。"
	}
	return fmt.Sprintf("%s%s暂未收录符合条件的美食，试试放宽距离、口味或人均范围。", parsed.City, parsed.District)
}

func buildFallbackItems(dishes []Dish, parsed parsedRequest) []Item {
	items := make([]Item, 0, len(dishes))
	for _, dish := range dishes {
		item := buildItem(dish, dish.Reasons)
		item.FitScore = scoreDish(dish, parsed)
		items = append(items, item)
	}
	return items
}

func buildItem(dish Dish, reasons []Reason) Item {
	if len(reasons) == 0 {
		reasons = dish.Reasons
	}
	return Item{
		DishID:        dish.ID,
		Name:          dish.Name,
		Cuisine:       dish.Cuisine,
		City:          dish.City,
		District:      dish.District,
		Image:         dish.Image,
		Ingredients:   append([]string(nil), dish.Ingredients...),
		FlavorProfile: append([]string(nil), dish.FlavorProfile...),
		Spiciness:     dish.Spiciness,
		AvgPrice:      dish.AvgPrice,
		Rating:        dish.Rating,
		DistanceKm:    dish.Restaurant.DistanceKm,
		Restaurant:    dish.Restaurant,
		BestTime:      dish.BestTime,
		SuitableFor:   append([]string(nil), dish.SuitableFor...),
		Reasons:       append([]Reason(nil), reasons...),
		Source:        dish.Source,
		UpdatedAt:     dish.UpdatedAt,
	}
}

func mergeAnalysisItems(dishes []Dish, analysis deepSeekAnalysis, parsed parsedRequest) []Item {
	byID := map[string]Dish{}
	for _, dish := range dishes {
		byID[dish.ID] = dish
	}

	items := []Item{}
	for _, entry := range analysis.Items {
		dish, ok := byID[entry.DishID]
		if !ok {
			continue
		}
		reasons := sanitizeReasons(entry.Reasons, dish)
		if len(reasons) == 0 {
			reasons = dish.Reasons
		}
		item := buildItem(dish, reasons)
		item.FitScore = clampScore(entry.FitScore)
		if item.FitScore == 0 {
			item.FitScore = scoreDish(dish, parsed)
		}
		items = append(items, item)
	}
	if len(items) == 0 {
		return buildFallbackItems(dishes, parsed)
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].FitScore > items[j].FitScore
	})
	return items
}

func sanitizeReasons(reasons []Reason, dish Dish) []Reason {
	allowed := map[string]bool{}
	for _, reason := range dish.Reasons {
		allowed[reason.Label] = true
	}
	for _, label := range []string{"本地味", "距离", "人均低", "评分", "口味", "出餐快", "位置", "适合分享", "经典", "下饭", "解辣", "老字号", "名店", "分量足", "本地人气", "便宜", "招牌"} {
		allowed[label] = true
	}
	result := []Reason{}
	for _, reason := range reasons {
		reason.Label = strings.TrimSpace(reason.Label)
		reason.Text = strings.TrimSpace(reason.Text)
		if !allowed[reason.Label] || reason.Text == "" {
			continue
		}
		if len([]rune(reason.Text)) > 60 {
			runes := []rune(reason.Text)
			reason.Text = string(runes[:60])
		}
		result = append(result, reason)
		if len(result) >= 3 {
			break
		}
	}
	return result
}

func clampScore(score int) int {
	if score < 55 {
		return 55
	}
	if score > 99 {
		return 99
	}
	return score
}

func buildAvailableFilters(items []Item) AvailableFilters {
	filters := AvailableFilters{
		Cuisines:       []string{},
		Spiciness:      []string{},
		PriceRanges:    []FilterOption{},
		DistanceRanges: []FilterOption{},
		Dietary:        []string{},
		Scenarios:      []string{},
	}
	seenCuisines := map[string]bool{}
	seenSpiciness := map[string]bool{}
	seenScenarios := map[string]bool{}
	seenDietary := map[string]bool{}

	for _, item := range items {
		if cuisine := strings.TrimSpace(item.Cuisine); cuisine != "" && !seenCuisines[cuisine] {
			seenCuisines[cuisine] = true
			filters.Cuisines = append(filters.Cuisines, cuisine)
		}
		if spiciness := strings.TrimSpace(item.Spiciness); spiciness != "" && !seenSpiciness[spiciness] {
			seenSpiciness[spiciness] = true
			filters.Spiciness = append(filters.Spiciness, spiciness)
		}
		for _, scenario := range item.SuitableFor {
			if !seenScenarios[scenario] {
				seenScenarios[scenario] = true
				filters.Scenarios = append(filters.Scenarios, scenario)
			}
		}
		for _, diet := range dietaryForItem(item) {
			if !seenDietary[diet] {
				seenDietary[diet] = true
				filters.Dietary = append(filters.Dietary, diet)
			}
		}
	}
	filters.PriceRanges = append(filters.PriceRanges,
		FilterOption{Max: float64Ptr(30), Label: "30以内"},
		FilterOption{Min: float64Ptr(30), Max: float64Ptr(60), Label: "30-60"},
		FilterOption{Min: float64Ptr(60), Max: float64Ptr(100), Label: "60-100"},
		FilterOption{Min: float64Ptr(100), Label: "100+"},
	)
	filters.DistanceRanges = append(filters.DistanceRanges,
		FilterOption{Max: float64Ptr(1), Label: "1km内"},
		FilterOption{Max: float64Ptr(3), Label: "3km内"},
		FilterOption{Max: float64Ptr(5), Label: "5km内"},
	)
	return filters
}

func dietaryForItem(item Item) []string {
	result := []string{}
	if item.Spiciness == "不辣" {
		result = append(result, "不吃辣")
	}
	if !containsAny(item.Ingredients, meatKeywords) {
		result = append(result, "素食")
		result = append(result, "清真")
	}
	if !containsAny(item.Ingredients, organKeywords) {
		result = append(result, "不吃内脏")
	}
	if !containsAny(item.Ingredients, []string{"香菜"}) {
		result = append(result, "不吃香菜")
	}
	return result
}

func matchesDietary(dish Dish, dietary []string) bool {
	if len(dietary) == 0 {
		return true
	}
	for _, diet := range dietary {
		switch diet {
		case "不吃辣":
			if dish.Spiciness != "不辣" {
				return false
			}
		case "不吃香菜":
			if containsAny(dish.Ingredients, []string{"香菜"}) {
				return false
			}
		case "素食", "清真":
			if containsAny(dish.Ingredients, meatKeywords) {
				return false
			}
		case "不吃内脏":
			if containsAny(dish.Ingredients, organKeywords) {
				return false
			}
		}
	}
	return true
}

func matchesScenarios(dish Dish, scenarios []string) bool {
	if len(scenarios) == 0 {
		return true
	}
	for _, scenario := range scenarios {
		if contains(dish.SuitableFor, scenario) {
			return true
		}
	}
	return false
}

func matchingScenarios(dish Dish, scenarios []string) []string {
	if len(scenarios) == 0 {
		return nil
	}
	result := []string{}
	for _, scenario := range scenarios {
		if contains(dish.SuitableFor, scenario) {
			result = append(result, scenario)
		}
	}
	return result
}

func (s *Service) analyzeWithDeepSeek(ctx context.Context, parsed parsedRequest, dishes []Dish) (deepSeekAnalysis, error) {
	rawText, err := s.callDeepSeek(ctx, buildSystemPrompt(), buildUserPrompt(parsed, dishes))
	if err != nil {
		return deepSeekAnalysis{}, err
	}
	var analysis deepSeekAnalysis
	if err := json.Unmarshal([]byte(normalizeJSON(rawText)), &analysis); err != nil {
		return deepSeekAnalysis{}, fmt.Errorf("parse deepseek food analysis failed: %w", err)
	}
	if strings.TrimSpace(analysis.Summary) == "" || len(analysis.Items) == 0 {
		return deepSeekAnalysis{}, fmt.Errorf("deepseek food analysis is incomplete")
	}
	return analysis, nil
}

func (s *Service) callDeepSeek(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	payload := map[string]any{
		"model": s.cfg.Model,
		"messages": []map[string]any{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"response_format": map[string]any{"type": "json_object"},
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal deepseek request failed: %w", err)
	}
	endpoint := strings.TrimRight(s.cfg.BaseURL, "/") + "/chat/completions"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("build deepseek request failed: %w", err)
	}
	httpRequest.Header.Set("Authorization", "Bearer "+s.cfg.APIKey)
	httpRequest.Header.Set("Content-Type", "application/json")

	httpResponse, err := s.client.Do(httpRequest)
	if err != nil {
		return "", fmt.Errorf("request deepseek failed: %w", err)
	}
	defer httpResponse.Body.Close()
	if httpResponse.StatusCode >= 400 {
		return "", fmt.Errorf("deepseek request failed with status %d", httpResponse.StatusCode)
	}

	var responsePayload deepSeekResponsePayload
	if err := json.NewDecoder(httpResponse.Body).Decode(&responsePayload); err != nil {
		return "", fmt.Errorf("decode deepseek response failed: %w", err)
	}
	for _, choice := range responsePayload.Choices {
		if content := strings.TrimSpace(choice.Message.Content); content != "" {
			return content, nil
		}
	}
	return "", fmt.Errorf("deepseek returned empty response")
}

func buildSystemPrompt() string {
	schema, _ := json.Marshal(analysisSchema())
	return strings.Join([]string{
		"You are a pragmatic local food advisor for Chinese travelers.",
		"Only use the dish facts provided in the user message: name, cuisine, ingredients, flavor profile, spiciness, price, rating, distance, restaurant, and existing reasons.",
		"Never invent ingredients, prices, restaurants, ratings, or review claims.",
		"Generate a short summary in Chinese and per-dish reasons in Chinese.",
		"Each reason must have a label from the dish's existing reason labels or the allowed labels, and a one-sentence explanation tied to the provided facts.",
		"Keep at most three reasons per dish.",
		"Return exactly one valid JSON object with no markdown fences or commentary.",
		"The JSON object must match this schema: " + string(schema),
	}, " ")
}

func buildUserPrompt(parsed parsedRequest, dishes []Dish) string {
	compact := make([]map[string]any, 0, len(dishes))
	for _, dish := range dishes {
		compact = append(compact, map[string]any{
			"dishId":          dish.ID,
			"name":            dish.Name,
			"cuisine":         dish.Cuisine,
			"ingredients":     dish.Ingredients,
			"flavorProfile":   dish.FlavorProfile,
			"spiciness":       dish.Spiciness,
			"avgPrice":        dish.AvgPrice,
			"rating":          dish.Rating,
			"distanceKm":      dish.Restaurant.DistanceKm,
			"restaurant":      dish.Restaurant.Name,
			"existingReasons": dish.Reasons,
		})
	}
	payload := map[string]any{
		"city":          parsed.City,
		"district":      parsed.District,
		"cuisines":      parsed.Cuisines,
		"spiciness":     parsed.Spiciness,
		"priceMin":      parsed.PriceMin,
		"priceMax":      parsed.PriceMax,
		"distanceMaxKm": parsed.DistanceMaxKm,
		"dietary":       parsed.Dietary,
		"scenarios":     parsed.Scenarios,
		"candidates":    compact,
	}
	body, _ := json.Marshal(payload)
	return string(body)
}

func analysisSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"summary": map[string]any{"type": "string"},
			"items": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"dishId":   map[string]any{"type": "string"},
						"fitScore": map[string]any{"type": "integer"},
						"reasons": map[string]any{
							"type": "array",
							"items": map[string]any{
								"type": "object",
								"properties": map[string]any{
									"label": map[string]any{"type": "string"},
									"text":  map[string]any{"type": "string"},
								},
								"required":             []string{"label", "text"},
								"additionalProperties": false,
							},
						},
					},
					"required":             []string{"dishId", "fitScore", "reasons"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"summary", "items"},
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

var priceRangePattern = regexp.MustCompile(`人均\s*(\d+)\s*(?:-|~|至|到)\s*(\d+)`)
var priceMaxPattern = regexp.MustCompile(`人均\s*(\d+)\s*(?:以内|以下|不超过|低于)`)
var priceAroundPattern = regexp.MustCompile(`人均\s*(\d+)\s*(?:左右)`)
var distancePattern = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*(?:km|公里)`)

func inferCity(text string) string {
	text = strings.ToLower(text)
	if strings.Contains(text, "重庆") || strings.Contains(text, "渝中") || strings.Contains(text, "解放碑") || strings.Contains(text, "较场口") || strings.Contains(text, "八一路") {
		return "重庆"
	}
	if strings.Contains(text, "成都") || strings.Contains(text, "武侯") || strings.Contains(text, "锦江") || strings.Contains(text, "玉林") || strings.Contains(text, "春熙") {
		return "成都"
	}
	return ""
}

func inferDistrict(text string, city string) string {
	if strings.Contains(text, "武侯") || strings.Contains(text, "玉林") {
		return "武侯区"
	}
	if strings.Contains(text, "锦江") || strings.Contains(text, "春熙") {
		return "锦江区"
	}
	if strings.Contains(text, "渝中") || strings.Contains(text, "解放碑") || strings.Contains(text, "较场口") || strings.Contains(text, "八一路") {
		return "渝中区"
	}
	if city == "成都" {
		return "武侯区"
	}
	if city == "重庆" {
		return "渝中区"
	}
	return ""
}

func inferCuisines(text string) []string {
	cuisines := []string{}
	for _, entry := range []struct {
		id      string
		aliases []string
	}{
		{id: "火锅", aliases: []string{"火锅", "hotpot"}},
		{id: "川菜", aliases: []string{"川菜", "家常菜"}},
		{id: "小吃", aliases: []string{"小吃", "串串", "钵钵鸡"}},
		{id: "面食", aliases: []string{"面", "粉", "抄手", "水饺"}},
		{id: "甜品", aliases: []string{"甜品", "冰粉", "汤圆", "甜"}},
	} {
		for _, alias := range entry.aliases {
			if strings.Contains(text, alias) {
				cuisines = append(cuisines, entry.id)
				break
			}
		}
	}
	return cuisines
}

func inferSpiciness(text string) []string {
	if strings.Contains(text, "不要辣") || strings.Contains(text, "不吃辣") || strings.Contains(text, "不辣") {
		return []string{"不辣"}
	}
	spiciness := []string{}
	for _, entry := range []struct {
		id      string
		aliases []string
	}{
		{id: "微辣", aliases: []string{"微辣", "少辣"}},
		{id: "中辣", aliases: []string{"中辣"}},
		{id: "重辣", aliases: []string{"重辣", "特辣"}},
	} {
		for _, alias := range entry.aliases {
			if strings.Contains(text, alias) {
				spiciness = append(spiciness, entry.id)
				break
			}
		}
	}
	return spiciness
}

func inferDietary(text string) []string {
	dietary := []string{}
	for _, entry := range []struct {
		id      string
		aliases []string
	}{
		{id: "不吃辣", aliases: []string{"不要辣", "不吃辣", "不辣"}},
		{id: "不吃香菜", aliases: []string{"不吃香菜", "不要香菜"}},
		{id: "素食", aliases: []string{"素食", "素菜"}},
		{id: "清真", aliases: []string{"清真"}},
		{id: "不吃内脏", aliases: []string{"不吃内脏", "不要内脏"}},
	} {
		for _, alias := range entry.aliases {
			if strings.Contains(text, alias) {
				dietary = append(dietary, entry.id)
				break
			}
		}
	}
	return dietary
}

func inferScenarios(text string) []string {
	scenarios := []string{}
	for _, entry := range []struct {
		id      string
		aliases []string
	}{
		{id: "一人食", aliases: []string{"一个人", "一人食", "独自"}},
		{id: "朋友聚餐", aliases: []string{"聚餐", "朋友", "聚会"}},
		{id: "夜宵", aliases: []string{"夜宵", "深夜"}},
		{id: "带家人", aliases: []string{"带家人", "家庭", "长辈"}},
		{id: "约会", aliases: []string{"约会", "二人"}},
	} {
		for _, alias := range entry.aliases {
			if strings.Contains(text, alias) {
				scenarios = append(scenarios, entry.id)
				break
			}
		}
	}
	return scenarios
}

func inferPrice(text string) (*int, *int) {
	if match := priceRangePattern.FindStringSubmatch(text); len(match) == 3 {
		minValue, _ := strconv.Atoi(match[1])
		maxValue, _ := strconv.Atoi(match[2])
		return &minValue, &maxValue
	}
	if match := priceMaxPattern.FindStringSubmatch(text); len(match) == 2 {
		value, _ := strconv.Atoi(match[1])
		return nil, &value
	}
	if match := priceAroundPattern.FindStringSubmatch(text); len(match) == 2 {
		value, _ := strconv.Atoi(match[1])
		return nil, &value
	}
	return nil, nil
}

func inferDistance(text string) *float64 {
	if match := distancePattern.FindStringSubmatch(text); len(match) == 2 {
		value, _ := strconv.ParseFloat(match[1], 64)
		return &value
	}
	return nil
}

func normalizeTokens(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(strings.ToLower(value))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func containsAny(values []string, keywords []string) bool {
	for _, value := range values {
		for _, keyword := range keywords {
			if strings.Contains(value, keyword) {
				return true
			}
		}
	}
	return false
}

var meatKeywords = []string{"牛肉", "猪肉", "鸡肉", "鸭血", "鸭肠", "毛肚", "黄喉", "杂酱", "臊子", "肉"}
var organKeywords = []string{"毛肚", "鸭肠", "鸭血", "黄喉", "猪血", "肠"}

func float64Ptr(value float64) *float64 {
	return &value
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}
