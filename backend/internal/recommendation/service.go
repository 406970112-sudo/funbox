package recommendation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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

	disclaimer = "参考价来自商品库快照，实际价格与库存以平台页面为准。"
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
		ProductID   string   `json:"productId"`
		FitScore    int      `json:"fitScore"`
		SuitableFor string   `json:"suitableFor"`
		Reasons     []Reason `json:"reasons"`
	} `json:"items"`
}

type deepSeekParse struct {
	Category    string   `json:"category"`
	BudgetMin   *int     `json:"budgetMin"`
	BudgetMax   *int     `json:"budgetMax"`
	Brands      []string `json:"brands"`
	Preferences []string `json:"preferences"`
	Platforms   []string `json:"platforms"`
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
		Products:  append([]Product(nil), s.catalog...),
		UpdatedAt: "2026-08-01T00:00:00Z",
	}, nil
}

func (s *Service) Query(ctx context.Context, request Request, userID string) (Response, error) {
	request = normalizeRequest(request)
	if err := validateRequest(request); err != nil {
		return Response{}, err
	}

	parsed := parseRequest(request)
	if parsed.Category == "" {
		parsed.Category = inferCategoryFromCatalog(request.Query, s.catalog)
	}
	if s.cfg.APIKey != "" && (parsed.Category == "" || len(s.recall(parsed)) == 0) {
		if llmParsed, err := s.parseWithDeepSeek(ctx, request); err == nil {
			parsed = mergeLLMParse(parsed, llmParsed)
		}
	}
	candidates := s.recall(parsed)
	ranked := s.rankCandidates(candidates, parsed)
	if len(ranked) > 6 {
		ranked = ranked[:6]
	}

	response := Response{
		QueryID:     "rec_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
		Category:    parsed.Category,
		Budget:      parsed.Budget,
		Preferences: parsed.Preferences,
		Disclaimer:  disclaimer,
		GeneratedAt: nowISO(),
	}

	if len(ranked) == 0 {
		response.Summary = "当前条件没有找到匹配商品，试试放宽预算或品牌偏好。"
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
		_ = s.store.SaveQuery(ctx, userID, response.QueryID, request.Query, response.Category, string(responseJSON))
	}
	return response, nil
}

func buildAvailableFilters(items []Item) AvailableFilters {
	filters := AvailableFilters{
		BudgetRanges: []FilterOption{},
		Brands:       []string{},
		Scenarios:    []string{},
		Platforms:    []string{},
	}
	seenBrands := map[string]bool{}
	seenScenarios := map[string]bool{}
	seenPlatforms := map[string]bool{}

	for _, item := range items {
		if brand := strings.TrimSpace(item.Brand); brand != "" && !seenBrands[brand] {
			seenBrands[brand] = true
			filters.Brands = append(filters.Brands, brand)
		}
		for _, link := range item.Links {
			if platform := strings.TrimSpace(link.Platform); platform != "" && !seenPlatforms[platform] {
				seenPlatforms[platform] = true
				filters.Platforms = append(filters.Platforms, platform)
			}
		}
		for _, scenario := range inferItemScenarios(item) {
			if !seenScenarios[scenario] {
				seenScenarios[scenario] = true
				filters.Scenarios = append(filters.Scenarios, scenario)
			}
		}
	}

	ranges := []struct {
		min   *int
		max   *int
		label string
	}{
		{min: nil, max: intPtr(1000), label: "1000以内"},
		{min: intPtr(1000), max: intPtr(2000), label: "1000-2000"},
		{min: intPtr(2000), max: intPtr(3000), label: "2000-3000"},
		{min: intPtr(3000), max: intPtr(5000), label: "3000-5000"},
		{min: intPtr(5000), max: nil, label: "5000+"},
	}
	for _, option := range ranges {
		if hasItemInPriceRange(items, option.min, option.max) {
			filters.BudgetRanges = append(filters.BudgetRanges, FilterOption{
				Min:   option.min,
				Max:   option.max,
				Label: option.label,
			})
		}
	}
	return filters
}

func hasItemInPriceRange(items []Item, min, max *int) bool {
	for _, item := range items {
		if min != nil && item.ReferencePrice < *min {
			continue
		}
		if max != nil && item.ReferencePrice > *max {
			continue
		}
		return true
	}
	return false
}

func inferItemScenarios(item Item) []string {
	text := strings.ToLower(
		item.SuitableFor + " " + strings.Join(mapValues(item.Specs), " ") + " " + reasonTexts(item.Reasons),
	)
	scenarios := []string{}
	preferred := []struct {
		id      string
		matches []string
	}{
		{id: "游戏", matches: []string{"游戏", "电竞", "elite", "天玑 9400", "144hz"}},
		{id: "影像", matches: []string{"影像", "拍照", "摄影", "相机", "蔡司", "潜望", "50mp", "200mp"}},
		{id: "续航", matches: []string{"续航", "电池", "mah"}},
		{id: "画质", matches: []string{"画质", "屏幕", "2k", "oled", "mini led"}},
		{id: "办公", matches: []string{"办公", "学习"}},
		{id: "轻便", matches: []string{"轻便", "轻薄", "手感", "便携", "约 18"}},
	}
	for _, entry := range preferred {
		for _, match := range entry.matches {
			if strings.Contains(text, match) {
				scenarios = append(scenarios, entry.id)
				break
			}
		}
	}
	return scenarios
}

func reasonTexts(reasons []Reason) string {
	parts := make([]string, 0, len(reasons))
	for _, reason := range reasons {
		parts = append(parts, reason.Label+" "+reason.Text)
	}
	return strings.Join(parts, " ")
}

func intPtr(value int) *int {
	return &value
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

func normalizeRequest(request Request) Request {
	request.Query = strings.TrimSpace(request.Query)
	request.Category = normalizeCategory(request.Category)
	request.Brands = normalizeTokens(request.Brands)
	request.Scenarios = normalizeTokens(request.Scenarios)
	request.Platforms = normalizeTokens(request.Platforms)
	return request
}

func validateRequest(request Request) error {
	if strings.TrimSpace(request.Query) == "" && request.Category == "" {
		return fmt.Errorf("query or category is required")
	}
	if len([]rune(request.Query)) > 200 {
		return fmt.Errorf("query exceeds 200 characters")
	}
	if request.BudgetMin != nil && request.BudgetMax != nil && *request.BudgetMin > *request.BudgetMax {
		return fmt.Errorf("budgetMin must not exceed budgetMax")
	}
	return nil
}

type parsedRequest struct {
	Category    string
	Budget      *Budget
	Brands      []string
	Preferences []string
	Platforms   []string
}

func parseRequest(request Request) parsedRequest {
	parsed := parsedRequest{
		Category:    request.Category,
		Budget:      budgetFromFields(request.BudgetMin, request.BudgetMax),
		Brands:      request.Brands,
		Preferences: request.Scenarios,
		Platforms:   request.Platforms,
	}
	text := strings.ToLower(request.Query)

	if parsed.Category == "" {
		parsed.Category = inferCategory(text)
	}
	if parsed.Budget == nil {
		parsed.Budget = inferBudget(text)
	}
	if len(parsed.Brands) == 0 {
		parsed.Brands = inferBrands(text)
	}
	if len(parsed.Preferences) == 0 {
		parsed.Preferences = inferPreferences(text)
	}
	if len(parsed.Platforms) == 0 {
		parsed.Platforms = inferPlatforms(text)
	}
	// Leave the category empty when no product word is recognized so recall
	// spans the whole catalog instead of silently falling back to phones.
	return parsed
}

func (s *Service) recall(parsed parsedRequest) []Product {
	products := make([]Product, 0, len(s.catalog))
	for _, product := range s.catalog {
		if parsed.Category != "" && product.Category != parsed.Category {
			continue
		}
		if !matchesBudget(product.ReferencePrice, parsed.Budget) {
			continue
		}
		if !matchesBrand(product, parsed.Brands) {
			continue
		}
		if !matchesPlatforms(product, parsed.Platforms) {
			continue
		}
		products = append(products, product)
	}
	return products
}

func (s *Service) rankCandidates(candidates []Product, parsed parsedRequest) []Product {
	scored := append([]Product(nil), candidates...)
	sort.SliceStable(scored, func(i, j int) bool {
		left := scoreProduct(scored[i], parsed)
		right := scoreProduct(scored[j], parsed)
		if left == right {
			return scored[i].ReferencePrice < scored[j].ReferencePrice
		}
		return left > right
	})
	return scored
}

func scoreProduct(product Product, parsed parsedRequest) int {
	score := 60
	if parsed.Budget != nil {
		if product.ReferencePrice >= parsed.Budget.Min && product.ReferencePrice <= parsed.Budget.Max {
			score += 12
			rangeWidth := parsed.Budget.Max - parsed.Budget.Min
			if rangeWidth > 0 {
				distance := product.ReferencePrice - parsed.Budget.Min
				score += int((1 - float64(distance)/float64(rangeWidth)) * 8)
			}
		} else {
			score -= 10
		}
	} else {
		score += 5
	}

	specsText := strings.ToLower(strings.Join(mapValues(product.Specs), " "))
	tags := strings.ToLower(strings.Join(product.FitTags, " "))
	for _, preference := range parsed.Preferences {
		switch preference {
		case "game", "gaming", "游戏":
			if strings.Contains(specsText, "elite") ||
				strings.Contains(specsText, "天玑 9400") ||
				strings.Contains(specsText, "144hz") ||
				strings.Contains(tags, "游戏") {
				score += 8
			}
		case "camera", "拍照", "影像":
			if strings.Contains(specsText, "50mp") ||
				strings.Contains(specsText, "200mp") ||
				strings.Contains(specsText, "蔡司") ||
				strings.Contains(specsText, "潜望") ||
				strings.Contains(tags, "影像") {
				score += 8
			}
		case "battery", "续航":
			if strings.Contains(specsText, "mAh") && !strings.Contains(specsText, "3561mAh") {
				score += 8
			} else {
				score += 4
			}
		case "office", "办公", "学习":
			if strings.Contains(tags, "办公") || strings.Contains(tags, "学习") {
				score += 6
			}
		case "portable", "轻便", "轻薄", "手感":
			if strings.Contains(specsText, "约 185g") ||
				strings.Contains(specsText, "约 183g") ||
				strings.Contains(specsText, "约 179g") ||
				strings.Contains(specsText, "约 170g") ||
				strings.Contains(specsText, "约 162g") ||
				strings.Contains(tags, "轻薄") ||
				strings.Contains(tags, "轻巧") {
				score += 6
			}
		case "screen", "屏幕", "画质":
			if strings.Contains(specsText, "2k") ||
				strings.Contains(specsText, "3.2k") ||
				strings.Contains(specsText, "mini led") ||
				strings.Contains(specsText, "oled") {
				score += 6
			}
		}
	}
	if strings.Contains(tags, "高性价比") || strings.Contains(tags, "性价比") {
		score += 4
	}
	if strings.Contains(tags, "旗舰") {
		score += 2
	}
	if score > 99 {
		score = 99
	}
	return score
}

func buildFallbackSummary(parsed parsedRequest, count int) string {
	budgetText := ""
	if parsed.Budget != nil {
		budgetText = fmt.Sprintf("%d-%d 元预算", parsed.Budget.Min, parsed.Budget.Max)
	} else {
		budgetText = "当前预算"
	}
	preferenceText := ""
	if len(parsed.Preferences) > 0 {
		preferenceText = "，优先" + strings.Join(parsed.Preferences, "、")
	}
	return fmt.Sprintf("已按%s%s，筛选出 %d 款%s。", budgetText, preferenceText, count, categoryLabel(parsed.Category))
}

func buildFallbackItems(products []Product, parsed parsedRequest) []Item {
	items := make([]Item, 0, len(products))
	for _, product := range products {
		item := buildItem(product, fallbackReasons(product), "")
		item.FitScore = scoreProduct(product, parsed)
		items = append(items, item)
	}
	return items
}

func fallbackReasons(product Product) []Reason {
	reasons := []Reason{}
	for key, value := range product.Specs {
		label, ok := specReasonLabel(key)
		if !ok {
			continue
		}
		reasons = append(reasons, Reason{Label: label, Text: strings.TrimSpace(value)})
	}
	for _, tag := range product.FitTags {
		if label, ok := tagReasonLabel(tag); ok && len(reasons) < 3 {
			reasons = append(reasons, Reason{Label: label, Text: tag})
		}
	}
	reasons = append(reasons, Reason{
		Label: "价格",
		Text:  fmt.Sprintf("参考价 ¥%d，处于预算区间内", product.ReferencePrice),
	})
	if len(reasons) > 3 {
		reasons = reasons[:3]
	}
	return reasons
}

func specReasonLabel(key string) (string, bool) {
	switch key {
	case "screen", "display", "refresh":
		return "屏幕", true
	case "chip":
		return "性能", true
	case "battery":
		return "续航", true
	case "camera":
		return "影像", true
	case "weight", "size":
		return "手感", true
	case "storage":
		return "存储", true
	case "sound":
		return "音质", true
	case "noise":
		return "降噪", true
	case "fastCharge":
		return "快充", true
	case "filter", "clean":
		return "净化", true
	case "safe":
		return "健康", true
	case "capacity":
		return "容量", true
	case "wash":
		return "洗涤", true
	case "dry":
		return "烘干", true
	case "energy":
		return "能效", true
	default:
		return "", false
	}
}

func tagReasonLabel(tag string) (string, bool) {
	switch tag {
	case "续航", "游戏", "影像", "性能", "轻薄", "轻巧", "性价比", "高性价比", "降噪", "音质", "画质", "办公", "学习", "便携", "快充", "大容量", "除菌", "节能", "静音":
		return tag, true
	default:
		return "", false
	}
}

func buildItem(product Product, reasons []Reason, suitableFor string) Item {
	if suitableFor == "" {
		suitableFor = "适合" + strings.Join(product.FitTags, "、") + "的用户"
	}
	return Item{
		ProductID:      product.ID,
		Name:           product.Name,
		Brand:          product.Brand,
		FitScore:       0,
		ReferencePrice: product.ReferencePrice,
		PriceSource:    product.PriceSource,
		Reasons:        reasons,
		SuitableFor:    suitableFor,
		Specs:          copySpecs(product.Specs),
		Links:          append([]Link(nil), product.Links...),
	}
}

func mergeAnalysisItems(products []Product, analysis deepSeekAnalysis, parsed parsedRequest) []Item {
	byID := map[string]Product{}
	for _, product := range products {
		byID[product.ID] = product
	}

	items := []Item{}
	for _, item := range analysis.Items {
		product, ok := byID[item.ProductID]
		if !ok {
			continue
		}
		reasons := sanitizeReasons(item.Reasons, product)
		if len(reasons) == 0 {
			reasons = fallbackReasons(product)
		}
		built := buildItem(product, reasons, item.SuitableFor)
		built.FitScore = clampScore(item.FitScore)
		if built.FitScore == 0 {
			built.FitScore = 85
		}
		items = append(items, built)
	}
	if len(items) == 0 {
		return buildFallbackItems(products, parsed)
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].FitScore > items[j].FitScore
	})
	return items
}

func sanitizeReasons(reasons []Reason, product Product) []Reason {
	allowed := map[string]bool{}
	for key := range product.Specs {
		if label, ok := specReasonLabel(key); ok {
			allowed[label] = true
		}
	}
	for _, tag := range product.FitTags {
		if label, ok := tagReasonLabel(tag); ok {
			allowed[label] = true
		}
	}
	allowed["价格"] = true
	allowed["性能"] = true
	allowed["续航"] = true
	allowed["影像"] = true
	allowed["屏幕"] = true
	allowed["手感"] = true
	allowed["便携"] = true
	allowed["快充"] = true
	allowed["降噪"] = true
	allowed["音质"] = true
	allowed["画质"] = true
	allowed["容量"] = true
	allowed["洗涤"] = true
	allowed["烘干"] = true
	allowed["能效"] = true
	allowed["大容量"] = true
	allowed["除菌"] = true
	allowed["节能"] = true
	allowed["静音"] = true

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

func (s *Service) analyzeWithDeepSeek(ctx context.Context, parsed parsedRequest, products []Product) (deepSeekAnalysis, error) {
	rawText, err := s.callDeepSeek(ctx, buildSystemPrompt(), buildUserPrompt(parsed, products))
	if err != nil {
		return deepSeekAnalysis{}, err
	}

	var analysis deepSeekAnalysis
	if err := json.Unmarshal([]byte(normalizeJSON(rawText)), &analysis); err != nil {
		return deepSeekAnalysis{}, fmt.Errorf("parse deepseek analysis failed: %w", err)
	}
	if strings.TrimSpace(analysis.Summary) == "" || len(analysis.Items) == 0 {
		return deepSeekAnalysis{}, fmt.Errorf("deepseek analysis is incomplete")
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

func (s *Service) parseWithDeepSeek(ctx context.Context, request Request) (deepSeekParse, error) {
	rawText, err := s.callDeepSeek(ctx, buildParseSystemPrompt(), buildParseUserPrompt(request))
	if err != nil {
		return deepSeekParse{}, err
	}
	var parsed deepSeekParse
	if err := json.Unmarshal([]byte(normalizeJSON(rawText)), &parsed); err != nil {
		return deepSeekParse{}, fmt.Errorf("parse deepseek request fields failed: %w", err)
	}
	category := normalizeCategory(parsed.Category)
	if strings.TrimSpace(parsed.Category) != "" && category == "" {
		return deepSeekParse{}, fmt.Errorf("deepseek returned unknown category %q", parsed.Category)
	}
	parsed.Category = category
	return parsed, nil
}

func mergeLLMParse(parsed parsedRequest, llm deepSeekParse) parsedRequest {
	if parsed.Category == "" {
		parsed.Category = llm.Category
	}
	if parsed.Budget == nil {
		minBudget := llm.BudgetMin
		maxBudget := llm.BudgetMax
		if minBudget != nil && *minBudget <= 0 {
			minBudget = nil
		}
		if maxBudget != nil && *maxBudget <= 0 {
			maxBudget = nil
		}
		parsed.Budget = budgetFromFields(minBudget, maxBudget)
	}
	if len(parsed.Brands) == 0 {
		parsed.Brands = normalizeTokens(llm.Brands)
	}
	if len(parsed.Preferences) == 0 {
		parsed.Preferences = normalizeTokens(llm.Preferences)
	}
	if len(parsed.Platforms) == 0 {
		parsed.Platforms = normalizeTokens(llm.Platforms)
	}
	return parsed
}

func buildSystemPrompt() string {
	schema, _ := json.Marshal(analysisSchema())
	return strings.Join([]string{
		"You are a pragmatic shopping advisor for Chinese consumers.",
		"Only use the product facts provided in the user message: name, brand, reference price, specs, and fit tags.",
		"Never invent specifications, prices, links, or review claims.",
		"Generate a short summary in Chinese and per-item reasons in Chinese.",
		"Each reason must have a label from the allowed set and a one-sentence explanation tied to the provided specs.",
		"Keep at most three reasons per item.",
		"Return exactly one valid JSON object with no markdown fences or commentary.",
		"The JSON object must match this schema: " + string(schema),
	}, " ")
}

func buildUserPrompt(parsed parsedRequest, products []Product) string {
	compact := make([]map[string]any, 0, len(products))
	for _, product := range products {
		compact = append(compact, map[string]any{
			"productId":      product.ID,
			"name":           product.Name,
			"brand":          product.Brand,
			"referencePrice": product.ReferencePrice,
			"specs":          product.Specs,
			"fitTags":        product.FitTags,
		})
	}
	payload := map[string]any{
		"category":    parsed.Category,
		"budget":      parsed.Budget,
		"preferences": parsed.Preferences,
		"brands":      parsed.Brands,
		"platforms":   parsed.Platforms,
		"candidates":  compact,
	}
	body, _ := json.Marshal(payload)
	return string(body)
}

func buildParseSystemPrompt() string {
	schema, _ := json.Marshal(parseSchema())
	return strings.Join([]string{
		"You are a shopping request parser for Chinese consumers.",
		"Extract structured fields from the user's natural language request.",
		"category must be one of: phone, tablet, earbuds, tv, small-appliance, large-appliance, accessory. Use an empty string when the request does not clearly name one of these categories.",
		"budgetMin and budgetMax are integer CNY prices; use null when the user does not mention a budget.",
		"brands can include any of the known brands or an empty array.",
		"preferences can include any of: 游戏, 影像, 续航, 办公, 轻便, 画质, or an empty array.",
		"platforms can include any of: jd, taobao, pdd, or an empty array.",
		"Return exactly one valid JSON object with no markdown fences or commentary.",
		"The JSON object must match this schema: " + string(schema),
	}, " ")
}

func buildParseUserPrompt(request Request) string {
	payload := map[string]any{
		"query":           request.Query,
		"knownCategories": []string{"phone", "tablet", "earbuds", "tv", "small-appliance", "large-appliance", "accessory"},
		"knownBrands":     []string{"小米", "华为", "苹果", "OPPO", "vivo", "荣耀", "一加", "三星", "Redmi", "realme", "真我", "米家", "海尔", "小天鹅", "美的", "TCL", "海信", "索尼"},
	}
	body, _ := json.Marshal(payload)
	return string(body)
}

func parseSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"category": map[string]any{"type": "string"},
			"budgetMin": map[string]any{
				"type": []string{"integer", "null"},
			},
			"budgetMax": map[string]any{
				"type": []string{"integer", "null"},
			},
			"brands": map[string]any{
				"type":  "array",
				"items": map[string]any{"type": "string"},
			},
			"preferences": map[string]any{
				"type":  "array",
				"items": map[string]any{"type": "string"},
			},
			"platforms": map[string]any{
				"type":  "array",
				"items": map[string]any{"type": "string"},
			},
		},
		"required":             []string{"category", "budgetMin", "budgetMax", "brands", "preferences", "platforms"},
		"additionalProperties": false,
	}
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
						"productId":   map[string]any{"type": "string"},
						"fitScore":    map[string]any{"type": "integer"},
						"suitableFor": map[string]any{"type": "string"},
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
					"required":             []string{"productId", "fitScore", "suitableFor", "reasons"},
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

var budgetPattern = regexp.MustCompile(`(?i)(\d{3,5})\s*(?:-|~|至|到)\s*(\d{3,5})`)
var maxBudgetPattern = regexp.MustCompile(`(?i)(?:以内|以下|不超过|低于)\s*(\d{3,5})`)
var minBudgetPattern = regexp.MustCompile(`(?i)(?:以上|起|超过)\s*(\d{3,5})`)
var aroundBudgetPattern = regexp.MustCompile(`(?i)(?:预算|左右|大概|约)\s*(\d{3,5})`)

func budgetFromFields(min, max *int) *Budget {
	if min == nil && max == nil {
		return nil
	}
	budget := &Budget{}
	if min != nil {
		budget.Min = *min
	}
	if max != nil {
		budget.Max = *max
	}
	if budget.Min == 0 {
		budget.Min = budget.Max / 5 * 4
	}
	if budget.Max == 0 {
		budget.Max = budget.Min + 1000
	}
	return budget
}

func inferBudget(text string) *Budget {
	if match := budgetPattern.FindStringSubmatch(text); len(match) == 3 {
		minValue, _ := strconv.Atoi(match[1])
		maxValue, _ := strconv.Atoi(match[2])
		return &Budget{Min: minValue, Max: maxValue}
	}
	if match := maxBudgetPattern.FindStringSubmatch(text); len(match) == 2 {
		value, _ := strconv.Atoi(match[1])
		return &Budget{Min: value / 5 * 4, Max: value}
	}
	if match := minBudgetPattern.FindStringSubmatch(text); len(match) == 2 {
		value, _ := strconv.Atoi(match[1])
		return &Budget{Min: value, Max: value + 1000}
	}
	if match := aroundBudgetPattern.FindStringSubmatch(text); len(match) == 2 {
		value, _ := strconv.Atoi(match[1])
		return &Budget{Min: value / 5 * 4, Max: value + value/5}
	}
	return nil
}

func inferCategory(text string) string {
	// Generic product words take priority so a brand cannot shadow the product
	// type, e.g. "小米洗衣机" must be a washing machine, not a phone.
	for _, entry := range categoryAliases {
		for _, alias := range entry.aliases {
			if strings.Contains(text, alias) {
				return entry.id
			}
		}
	}
	for _, brand := range phoneBrandAliases {
		if strings.Contains(text, brand) {
			return "phone"
		}
	}
	return ""
}

func inferCategoryFromCatalog(text string, catalog Catalog) string {
	lowered := strings.ToLower(text)
	for _, product := range catalog {
		brand := strings.ToLower(strings.TrimSpace(product.Brand))
		if brand == "" {
			continue
		}
		if strings.Contains(lowered, brand) {
			return product.Category
		}
	}
	return ""
}

var categoryAliases = []struct {
	id      string
	aliases []string
}{
	{id: "phone", aliases: []string{"手机", "智能手机", "phone", "iphone"}},
	{id: "tablet", aliases: []string{"平板", "平板电脑", "ipad", "matepad", "tablet"}},
	{id: "earbuds", aliases: []string{"耳机", "蓝牙耳机", "airpods", "buds", "earbuds", "降噪耳机"}},
	{id: "tv", aliases: []string{"电视", "电视机", "tv", "大屏"}},
	{id: "small-appliance", aliases: []string{"空气炸锅", "电饭煲", "电饭锅", "净化器", "吸尘器", "扫地机器人", "微波炉", "烤箱", "小家电"}},
	{id: "large-appliance", aliases: []string{"洗衣机", "滚筒洗衣机", "波轮洗衣机", "洗烘一体", "烘干机", "干衣机", "冰箱", "冰柜", "空调", "洗碗机", "热水器", "油烟机", "大家电"}},
	{id: "accessory", aliases: []string{"充电器", "数据线", "移动电源", "充电宝", "数码配件", "配件"}},
}

var phoneBrandAliases = []string{"小米", "华为", "一加", "oppo", "vivo", "荣耀", "红米", "iqoo"}

func normalizeCategory(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "手机", "phone", "phones", "手机平板":
		return "phone"
	case "平板", "平板电脑", "tablet", "tablets":
		return "tablet"
	case "耳机", "蓝牙耳机", "earbuds", "headphones":
		return "earbuds"
	case "电视", "tv", "television":
		return "tv"
	case "小家电", "家电", "small-appliance", "appliance":
		return "small-appliance"
	case "大家电", "large-appliance":
		return "large-appliance"
	case "数码配件", "配件", "accessory", "accessories":
		return "accessory"
	default:
		return ""
	}
}

func categoryLabel(category string) string {
	switch category {
	case "phone":
		return "手机"
	case "tablet":
		return "平板"
	case "earbuds":
		return "耳机"
	case "tv":
		return "电视"
	case "small-appliance":
		return "小家电"
	case "large-appliance":
		return "大家电"
	case "accessory":
		return "数码配件"
	default:
		return "商品"
	}
}

func inferBrands(text string) []string {
	brands := []string{}
	for _, brand := range []string{"小米", "华为", "苹果", "oppo", "vivo", "荣耀", "一加", "三星", "iqoo", "redmi", "realme", "真我", "米家", "海尔", "小天鹅", "美的", "TCL", "海信", "索尼"} {
		if strings.Contains(text, strings.ToLower(brand)) {
			brands = append(brands, brand)
		}
	}
	return brands
}

func inferPreferences(text string) []string {
	preferences := []string{}
	for _, entry := range []struct {
		value   string
		aliases []string
	}{
		{value: "游戏", aliases: []string{"游戏", "打游戏", "电竞", "gaming"}},
		{value: "影像", aliases: []string{"拍照", "摄影", "影像", "相机", "camera"}},
		{value: "续航", aliases: []string{"续航", "电池", "待机", "battery"}},
		{value: "办公", aliases: []string{"办公", "学习", "写文档", "office"}},
		{value: "轻便", aliases: []string{"轻薄", "轻便", "手感", "便携", "portable"}},
		{value: "画质", aliases: []string{"画质", "屏幕", "显示", "display"}},
	} {
		for _, alias := range entry.aliases {
			if strings.Contains(text, strings.ToLower(alias)) {
				preferences = append(preferences, entry.value)
				break
			}
		}
	}
	return preferences
}

func inferPlatforms(text string) []string {
	platforms := []string{}
	for _, entry := range []struct {
		value   string
		aliases []string
	}{
		{value: "jd", aliases: []string{"京东", "jd"}},
		{value: "taobao", aliases: []string{"淘宝", "天猫", "taobao", "tmall"}},
		{value: "pdd", aliases: []string{"拼多多", "pdd", "多多"}},
	} {
		for _, alias := range entry.aliases {
			if strings.Contains(text, strings.ToLower(alias)) {
				platforms = append(platforms, entry.value)
				break
			}
		}
	}
	return platforms
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

func matchesBudget(price int, budget *Budget) bool {
	if budget == nil {
		return true
	}
	return price >= budget.Min && price <= budget.Max
}

func matchesBrand(product Product, brands []string) bool {
	if len(brands) == 0 {
		return true
	}
	haystack := strings.ToLower(product.Brand + " " + product.Name)
	for _, brand := range brands {
		if strings.Contains(haystack, strings.ToLower(brand)) {
			return true
		}
	}
	return false
}

func matchesPlatforms(product Product, platforms []string) bool {
	if len(platforms) == 0 {
		return true
	}
	available := map[string]bool{}
	for _, link := range product.Links {
		available[link.Platform] = true
	}
	for _, platform := range platforms {
		if available[platform] {
			return true
		}
	}
	return false
}

func mapValues(values map[string]string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func copySpecs(specs map[string]string) map[string]string {
	result := make(map[string]string, len(specs))
	for key, value := range specs {
		result[key] = value
	}
	return result
}
