package resourcesearch

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"my-first-expo-app/backend/internal/config"
)

const (
	laoerSourceID       = "laoer-motewan"
	adapterLaoerSSE     = "laoer_sse"
	adapterDirectLink   = "direct_link"
	adapterHomepageOnly = "homepage_only"
)

var (
	ErrResultNotFound = errors.New("resource search result not found")
	ErrResolveFailed  = errors.New("resource search result resolve failed")
)

type SourceStatus string

const (
	StatusEmpty       SourceStatus = "empty"
	StatusError       SourceStatus = "error"
	StatusRestricted  SourceStatus = "restricted"
	StatusSuccess     SourceStatus = "success"
	StatusTimeout     SourceStatus = "timeout"
	StatusUnavailable SourceStatus = "unavailable"
	StatusDirect      SourceStatus = "direct"
	StatusUnknown     SourceStatus = "unknown"
)

type Result struct {
	Category        string `json:"category"`
	DiskType        string `json:"diskType,omitempty"`
	ID              string `json:"id"`
	OriginURL       string `json:"originUrl"`
	RequiresResolve bool   `json:"requiresResolve"`
	Size            string `json:"size,omitempty"`
	SourceID        string `json:"sourceId"`
	TargetURL       string `json:"targetUrl,omitempty"`
	Title           string `json:"title"`
	UpdatedAt       string `json:"updatedAt,omitempty"`
}

type SourceResult struct {
	Count       int          `json:"count"`
	DurationMS  int64        `json:"durationMs"`
	FallbackURL string       `json:"fallbackUrl"`
	Message     string       `json:"message,omitempty"`
	Query       string       `json:"query"`
	Results     []Result     `json:"results"`
	SourceID    string       `json:"sourceId"`
	Status      SourceStatus `json:"status"`
}

type ResolvedResult struct {
	ExtractionCode string `json:"extractionCode,omitempty"`
	ResultID       string `json:"resultId"`
	TargetURL      string `json:"targetUrl"`
}

type providerResult struct {
	Category  string
	DiskType  string
	Reference string
	Size      string
	TargetURL string
	Title     string
	UpdatedAt string
}

type provider interface {
	Resolve(context.Context, providerResult) (ResolvedResult, error)
	Search(context.Context, string, int) ([]providerResult, error)
	SourceID() string
}

type cacheEntry struct {
	expiresAt time.Time
	response  SourceResult
}

type resultReference struct {
	expiresAt time.Time
	provider  provider
	result    providerResult
}

type PublicSource struct {
	ID                string         `json:"id"`
	Name              string         `json:"name"`
	Description       string         `json:"description"`
	Category          string         `json:"category"`
	Domain            string         `json:"domain"`
	URL               string         `json:"url"`
	SearchURLTemplate string         `json:"searchUrlTemplate,omitempty"`
	Mode              SourceMode     `json:"mode"`
	AdapterKey        string         `json:"adapterKey"`
	Logo              string         `json:"logo"`
	LogoBackground    string         `json:"logoBackground"`
	LogoColor         string         `json:"logoColor"`
	LogoImagePath     string         `json:"logoImagePath,omitempty"`
	DefaultSelected   bool           `json:"defaultSelected"`
	Enabled           bool           `json:"enabled"`
	SortOrder         int            `json:"sortOrder"`
	MaxResults        int            `json:"maxResults"`
	TimeoutMS         int64          `json:"timeoutMs"`
	CacheTTLMS        int64          `json:"cacheTtlMs"`
	Health            *HealthSummary `json:"health"`
	UpdatedAt         string         `json:"updatedAt"`
}

type HealthSummary struct {
	Status     SourceStatus `json:"status"`
	HTTPStatus int          `json:"httpStatus,omitempty"`
	LatencyMS  int64        `json:"latencyMs,omitempty"`
	CheckedAt  string       `json:"checkedAt,omitempty"`
	Message    string       `json:"message,omitempty"`
}

type HealthResult struct {
	SourceID   string       `json:"sourceId"`
	Status     SourceStatus `json:"status"`
	HTTPStatus int          `json:"httpStatus,omitempty"`
	LatencyMS  int64        `json:"latencyMs,omitempty"`
	FinalURL   string       `json:"finalUrl,omitempty"`
	Message    string       `json:"message,omitempty"`
	Trigger    string       `json:"trigger"`
	CheckedAt  string       `json:"checkedAt"`
}

type TestResultItem struct {
	Title     string `json:"title"`
	Size      string `json:"size,omitempty"`
	DiskType  string `json:"diskType,omitempty"`
	Category  string `json:"category,omitempty"`
	Reference string `json:"reference,omitempty"`
}

type TestResult struct {
	SourceID   string           `json:"sourceId"`
	Query      string           `json:"query"`
	Status     SourceStatus     `json:"status"`
	Count      int              `json:"count"`
	DurationMS int64            `json:"durationMs"`
	SearchURL  string           `json:"searchUrl,omitempty"`
	Message    string           `json:"message,omitempty"`
	Results    []TestResultItem `json:"results"`
}

type AdminStats struct {
	Days          int          `json:"days"`
	TotalSearches int          `json:"totalSearches"`
	Sources       []UsageStats `json:"sources"`
	TopKeywords   []TopKeyword `json:"topKeywords"`
}

type Service struct {
	cache      map[string]cacheEntry
	cacheTTL   time.Duration
	maxResults int
	mu         sync.Mutex
	providers  map[string]provider
	adapters   map[string]provider
	references map[string]resultReference
	sources    map[string]Source
	store      *Store
	client     *http.Client
}

func NewService(cfg config.ResourceSearchConfig, store *Store) *Service {
	timeout := cfg.RequestTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	cacheTTL := cfg.CacheTTL
	if cacheTTL <= 0 {
		cacheTTL = 2 * time.Minute
	}
	maxResults := cfg.MaxResults
	if maxResults <= 0 {
		maxResults = 20
	}

	client := &http.Client{Timeout: timeout}
	laoer := newLaoerProvider(client, "https://laoer.motewan.com")
	service := newService(cacheTTL, maxResults, []provider{laoer})
	service.store = store
	service.client = client
	return service
}

func newService(cacheTTL time.Duration, maxResults int, providers []provider) *Service {
	providerMap := make(map[string]provider, len(providers))
	adapterMap := make(map[string]provider, len(providers))
	for _, item := range providers {
		providerMap[item.SourceID()] = item
		if item.SourceID() == laoerSourceID {
			adapterMap[adapterLaoerSSE] = item
		}
	}

	return &Service{
		cache:      make(map[string]cacheEntry),
		cacheTTL:   cacheTTL,
		maxResults: maxResults,
		providers:  providerMap,
		adapters:   adapterMap,
		references: make(map[string]resultReference),
		sources: map[string]Source{
			"quark-pan-search": {
				ID:              "quark-pan-search",
				Name:            "夸克盘搜",
				HomepageURL:     "https://www.quarkpanso.com/",
				Mode:            SourceModeDirect,
				AdapterKey:      adapterHomepageOnly,
				DefaultSelected: true,
				Enabled:         true,
				SortOrder:       2,
			},
			"panyq": {
				ID:              "panyq",
				Name:            "盘友圈",
				HomepageURL:     "https://panyq.com/",
				Mode:            SourceModeDirect,
				AdapterKey:      adapterHomepageOnly,
				DefaultSelected: true,
				Enabled:         true,
				SortOrder:       3,
			},
			"tvso": {
				ID:              "tvso",
				Name:            "TV 搜",
				HomepageURL:     "https://www.tvso.uk/",
				Mode:            SourceModeDirect,
				AdapterKey:      adapterHomepageOnly,
				DefaultSelected: true,
				Enabled:         true,
				SortOrder:       4,
			},
			"funletu-pan": {
				ID:              "funletu-pan",
				Name:            "趣盘搜",
				HomepageURL:     "https://pan.funletu.com/",
				Mode:            SourceModeDirect,
				AdapterKey:      adapterHomepageOnly,
				DefaultSelected: true,
				Enabled:         true,
				SortOrder:       5,
			},
			"yunso": {
				ID:              "yunso",
				Name:            "云搜",
				HomepageURL:     "https://www.yunso.net/",
				Mode:            SourceModeDirect,
				AdapterKey:      adapterHomepageOnly,
				DefaultSelected: true,
				Enabled:         true,
				SortOrder:       6,
			},
			laoerSourceID: {
				ID:                laoerSourceID,
				Name:              "老二搜索",
				HomepageURL:       "https://laoer.motewan.com/",
				SearchURLTemplate: "https://laoer.motewan.com/s/{keyword}.html",
				Mode:              SourceModeAggregate,
				AdapterKey:        adapterLaoerSSE,
				DefaultSelected:   true,
				Enabled:           true,
				SortOrder:         1,
			},
		},
	}
}

func (s *Service) Search(ctx context.Context, sourceID string, rawQuery string) (SourceResult, error) {
	query := normalizeQuery(rawQuery)
	source, err := s.loadSource(ctx, sourceID)
	if err != nil {
		return SourceResult{}, err
	}
	if !source.Enabled {
		return SourceResult{}, ErrSourceNotFound
	}
	if query == "" {
		return SourceResult{}, errors.New("query is required")
	}

	cacheTTL := s.cacheTTL
	if source.CacheTTLMS > 0 {
		cacheTTL = time.Duration(source.CacheTTLMS) * time.Millisecond
	}
	cacheKey := sourceID + "\x00" + strings.ToLower(query)
	if cached, ok := s.cached(cacheKey); ok {
		return cached, nil
	}

	startedAt := time.Now()
	response := s.searchSource(ctx, source, query)
	response.DurationMS = time.Since(startedAt).Milliseconds()
	if s.store != nil {
		userID := ""
		_ = s.store.LogUsage(ctx, sourceID, query, string(response.Status), response.Count, response.DurationMS, userID)
	}

	if response.Status == StatusSuccess || response.Status == StatusEmpty || response.Status == StatusDirect {
		s.mu.Lock()
		s.cache[cacheKey] = cacheEntry{expiresAt: time.Now().Add(cacheTTL), response: response}
		s.pruneLocked(time.Now())
		s.mu.Unlock()
	}
	return response, nil
}

func (s *Service) searchSource(ctx context.Context, source Source, query string) SourceResult {
	fallback := SourceResult{
		FallbackURL: source.HomepageURL,
		Message:     "",
		Query:       query,
		Results:     []Result{},
		SourceID:    source.ID,
		Status:      StatusRestricted,
	}

	if source.Mode == SourceModeAggregate {
		adapter, supported := s.adapterFor(source)
		if !supported {
			fallback.Message = "该来源暂未提供可用的站内聚合适配器。"
			return fallback
		}
		maxResults := source.MaxResults
		if maxResults <= 0 {
			maxResults = s.maxResults
		}
		items, err := adapter.Search(ctx, query, maxResults)
		if err != nil {
			status := StatusError
			message := "来源搜索失败，请稍后重试。"
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
				status = StatusTimeout
				message = "来源响应超时，可稍后重试或前往原站。"
			}
			fallback.Status = status
			fallback.Message = message
			return fallback
		}
		return s.buildAggregateResult(ctx, source, query, adapter, items)
	}

	if source.SearchURLTemplate != "" && source.AdapterKey == adapterDirectLink {
		target, err := buildSearchURL(source.SearchURLTemplate, query)
		if err != nil {
			fallback.Message = "搜索模板无效，请联系管理员。"
			return fallback
		}
		fallback.FallbackURL = target
		fallback.Status = StatusDirect
		fallback.Message = "已生成原站搜索链接。"
		return fallback
	}

	fallback.Message = "该来源仅支持原站直达。"
	return fallback
}

func (s *Service) buildAggregateResult(
	ctx context.Context,
	source Source,
	query string,
	adapter provider,
	items []providerResult,
) SourceResult {
	results := make([]Result, 0, len(items))
	references := make(map[string]resultReference)
	now := time.Now()
	cacheTTL := s.cacheTTL
	if source.CacheTTLMS > 0 {
		cacheTTL = time.Duration(source.CacheTTLMS) * time.Millisecond
	}
	for _, item := range items {
		resultID := resultID(source.ID, query, item.Reference, item.Title)
		originURL := ""
		if source.SearchURLTemplate != "" {
			originURL, _ = buildSearchURL(source.SearchURLTemplate, query)
		}
		if originURL == "" {
			originURL = source.HomepageURL
		}
		result := Result{
			Category:        item.Category,
			DiskType:        item.DiskType,
			ID:              resultID,
			OriginURL:       originURL,
			RequiresResolve: item.TargetURL == "" && item.Reference != "",
			Size:            item.Size,
			SourceID:        source.ID,
			TargetURL:       item.TargetURL,
			Title:           item.Title,
			UpdatedAt:       item.UpdatedAt,
		}
		results = append(results, result)
		if result.RequiresResolve {
			references[resultID] = resultReference{
				expiresAt: now.Add(cacheTTL),
				provider:  adapter,
				result:    item,
			}
		}
	}

	status := StatusSuccess
	message := ""
	if len(results) == 0 {
		status = StatusEmpty
		message = "该来源暂无找到相关内容。"
	}
	response := SourceResult{
		Count:       len(results),
		FallbackURL: source.HomepageURL,
		Message:     message,
		Query:       query,
		Results:     results,
		SourceID:    source.ID,
		Status:      status,
	}
	if len(references) > 0 {
		s.mu.Lock()
		for key, reference := range references {
			s.references[key] = reference
		}
		s.mu.Unlock()
	}
	return response
}

func (s *Service) Resolve(ctx context.Context, resultID string) (ResolvedResult, error) {
	now := time.Now()
	s.mu.Lock()
	reference, ok := s.references[resultID]
	if ok && !reference.expiresAt.After(now) {
		delete(s.references, resultID)
		ok = false
	}
	s.mu.Unlock()
	if !ok {
		return ResolvedResult{}, ErrResultNotFound
	}

	resolved, err := reference.provider.Resolve(ctx, reference.result)
	if err != nil {
		return ResolvedResult{}, fmt.Errorf("%w: %v", ErrResolveFailed, err)
	}
	resolved.ResultID = resultID
	return resolved, nil
}

func (s *Service) Sources(ctx context.Context) ([]PublicSource, error) {
	if s.store == nil {
		return nil, errors.New("resource search store unavailable")
	}
	sources, err := s.store.ListSources(ctx, SourceFilter{Status: "enabled"})
	if err != nil {
		return nil, err
	}
	public := make([]PublicSource, 0, len(sources))
	for _, source := range sources {
		item, err := s.publicSource(ctx, source)
		if err != nil {
			return nil, err
		}
		public = append(public, item)
	}
	return public, nil
}

func (s *Service) publicSource(ctx context.Context, source Source) (PublicSource, error) {
	domain := ""
	if parsed, err := url.Parse(source.HomepageURL); err == nil {
		domain = parsed.Host
	}
	item := PublicSource{
		ID:                source.ID,
		Name:              source.Name,
		Description:       source.Description,
		Category:          source.Category,
		Domain:            domain,
		URL:               source.HomepageURL,
		SearchURLTemplate: source.SearchURLTemplate,
		Mode:              source.Mode,
		AdapterKey:        source.AdapterKey,
		Logo:              source.LogoText,
		LogoBackground:    source.LogoBackground,
		LogoColor:         source.LogoColor,
		LogoImagePath:     source.LogoImagePath,
		DefaultSelected:   source.DefaultSelected,
		Enabled:           source.Enabled,
		SortOrder:         source.SortOrder,
		MaxResults:        source.MaxResults,
		TimeoutMS:         source.TimeoutMS,
		CacheTTLMS:        source.CacheTTLMS,
		UpdatedAt:         source.UpdatedAt.Format(time.RFC3339),
	}
	if s.store != nil {
		if health, ok, err := s.store.LatestHealth(ctx, source.ID); err == nil && ok {
			item.Health = &HealthSummary{
				Status:     health.Status,
				HTTPStatus: health.HTTPStatus,
				LatencyMS:  health.LatencyMS,
				CheckedAt:  health.CheckedAt.Format(time.RFC3339),
				Message:    health.Message,
			}
		}
	}
	return item, nil
}

func (s *Service) ListSources(ctx context.Context, filter SourceFilter) ([]PublicSource, error) {
	if s.store == nil {
		return nil, errors.New("resource search store unavailable")
	}
	sources, err := s.store.ListSources(ctx, filter)
	if err != nil {
		return nil, err
	}
	public := make([]PublicSource, 0, len(sources))
	for _, source := range sources {
		item, err := s.publicSource(ctx, source)
		if err != nil {
			return nil, err
		}
		public = append(public, item)
	}
	return public, nil
}

func (s *Service) GetSource(ctx context.Context, id string) (Source, error) {
	if s.store == nil {
		return Source{}, errors.New("resource search store unavailable")
	}
	return s.store.GetSource(ctx, id)
}

func (s *Service) CreateSource(ctx context.Context, operatorID string, input SourceInput) (Source, error) {
	if s.store == nil {
		return Source{}, errors.New("resource search store unavailable")
	}
	if err := validateSourceInput(input); err != nil {
		return Source{}, err
	}
	return s.store.CreateSource(ctx, operatorID, input)
}

func (s *Service) UpdateSource(ctx context.Context, operatorID, id string, input SourceInput) (Source, error) {
	if s.store == nil {
		return Source{}, errors.New("resource search store unavailable")
	}
	if err := validateSourceInput(input); err != nil {
		return Source{}, err
	}
	return s.store.UpdateSource(ctx, operatorID, id, input)
}

func (s *Service) SetSourceEnabled(ctx context.Context, operatorID, id string, enabled bool) (Source, error) {
	if s.store == nil {
		return Source{}, errors.New("resource search store unavailable")
	}
	return s.store.SetSourceEnabled(ctx, operatorID, id, enabled)
}

func (s *Service) DeleteSource(ctx context.Context, operatorID, id string) (Source, error) {
	if s.store == nil {
		return Source{}, errors.New("resource search store unavailable")
	}
	count, err := s.store.CountUsage(ctx, id)
	if err != nil {
		return Source{}, err
	}
	if count > 0 {
		return Source{}, ErrSourceInUse
	}
	return s.store.DeleteSource(ctx, operatorID, id)
}

func (s *Service) HealthCheck(ctx context.Context, sourceID, trigger string) (HealthResult, error) {
	source, err := s.loadSource(ctx, sourceID)
	if err != nil {
		return HealthResult{}, err
	}
	timeout := time.Duration(source.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 12 * time.Second
	}
	client := s.client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	}
	startedAt := time.Now()
	status := StatusUnknown
	httpStatus := 0
	finalURL := source.HomepageURL
	message := ""

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, source.HomepageURL, nil)
	if err != nil {
		message = "站点地址无效。"
	} else {
		request.Header.Set("User-Agent", "FunBox/1.0 resource-search-health")
		response, requestErr := client.Do(request)
		if requestErr != nil {
			if errors.Is(requestErr, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
				status = StatusTimeout
				message = "连接超时。"
			} else {
				status = StatusError
				message = "请求失败：" + requestErr.Error()
			}
		} else {
			_ = response.Body.Close()
			httpStatus = response.StatusCode
			if final := response.Request.URL.String(); final != "" {
				finalURL = final
			}
			switch {
			case httpStatus >= 200 && httpStatus < 400:
				status = StatusSuccess
				message = "站点可访问。"
			case httpStatus >= 400 && httpStatus < 500:
				status = StatusRestricted
				message = "站点返回受限状态。"
			default:
				status = StatusUnavailable
				message = "站点返回异常状态。"
			}
		}
	}

	latencyMS := time.Since(startedAt).Milliseconds()
	result := HealthResult{
		SourceID:   sourceID,
		Status:     status,
		HTTPStatus: httpStatus,
		LatencyMS:  latencyMS,
		FinalURL:   finalURL,
		Message:    message,
		Trigger:    trigger,
		CheckedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	if s.store != nil {
		_ = s.store.SaveHealthCheck(ctx, HealthCheck{
			SourceID:   sourceID,
			CheckedAt:  time.Now().UTC(),
			Status:     status,
			HTTPStatus: httpStatus,
			LatencyMS:  latencyMS,
			FinalURL:   finalURL,
			Message:    message,
			Trigger:    trigger,
		})
	}
	return result, nil
}

func (s *Service) HealthCheckAll(ctx context.Context) ([]HealthResult, error) {
	sources, err := s.store.ListSources(ctx, SourceFilter{Status: "enabled"})
	if err != nil {
		return nil, err
	}
	results := make([]HealthResult, 0, len(sources))
	for _, source := range sources {
		result, err := s.HealthCheck(ctx, source.ID, "manual")
		if err != nil {
			continue
		}
		results = append(results, result)
	}
	return results, nil
}

func (s *Service) TestSearch(ctx context.Context, operatorID, sourceID, rawQuery string) (TestResult, error) {
	source, err := s.loadSource(ctx, sourceID)
	if err != nil {
		return TestResult{}, err
	}
	return s.runTestSearch(ctx, operatorID, source, rawQuery, true)
}

func (s *Service) TestSearchInput(ctx context.Context, operatorID string, input SourceInput, rawQuery string) (TestResult, error) {
	source := Source{
		ID:                "",
		Name:              input.Name,
		HomepageURL:       input.HomepageURL,
		SearchURLTemplate: input.SearchURLTemplate,
		Mode:              input.Mode,
		AdapterKey:        input.AdapterKey,
		MaxResults:        input.MaxResults,
		TimeoutMS:         input.TimeoutMS,
		CacheTTLMS:        input.CacheTTLMS,
	}
	return s.runTestSearch(ctx, operatorID, source, rawQuery, false)
}

func (s *Service) runTestSearch(ctx context.Context, operatorID string, source Source, rawQuery string, persist bool) (TestResult, error) {
	query := normalizeQuery(rawQuery)
	if query == "" {
		return TestResult{}, errors.New("query is required")
	}

	startedAt := time.Now()
	result := TestResult{
		SourceID: source.ID,
		Query:    query,
		Results:  []TestResultItem{},
	}

	if source.Mode == SourceModeAggregate {
		adapter, supported := s.adapterFor(source)
		if !supported {
			result.Status = StatusUnavailable
			result.Message = "该来源未注册可用聚合适配器。"
		} else {
			maxResults := source.MaxResults
			if maxResults <= 0 {
				maxResults = 10
			}
			items, searchErr := adapter.Search(ctx, query, maxResults)
			if searchErr != nil {
				result.Status = StatusError
				result.Message = "真实试搜失败：" + searchErr.Error()
			} else {
				result.Status = StatusSuccess
				result.Count = len(items)
				if result.Count == 0 {
					result.Status = StatusEmpty
					result.Message = "真实试搜完成，暂无结果。"
				}
				for _, item := range items {
					result.Results = append(result.Results, TestResultItem{
						Title:     item.Title,
						Size:      item.Size,
						DiskType:  item.DiskType,
						Category:  item.Category,
						Reference: item.Reference,
					})
				}
			}
		}
	} else if source.SearchURLTemplate != "" {
		target, buildErr := buildSearchURL(source.SearchURLTemplate, query)
		if buildErr != nil {
			result.Status = StatusError
			result.Message = "搜索模板无效：" + buildErr.Error()
		} else {
			result.Status = StatusDirect
			result.SearchURL = target
			result.Message = "已生成真实原站搜索链接。"
		}
	} else {
		result.Status = StatusRestricted
		result.SearchURL = source.HomepageURL
		result.Message = "该来源仅支持原站直达。"
	}

	result.DurationMS = time.Since(startedAt).Milliseconds()
	if s.store != nil && persist {
		_ = s.store.SaveTestRun(ctx, TestRun{
			SourceID:   source.ID,
			OperatorID: operatorID,
			Query:      query,
			Status:     result.Status,
			Count:      result.Count,
			DurationMS: result.DurationMS,
			Message:    result.Message,
			CreatedAt:  time.Now().UTC(),
		})
	}
	return result, nil
}

func (s *Service) HealthCheckURL(ctx context.Context, rawURL string, timeoutMS int64, trigger string) (HealthResult, error) {
	if strings.TrimSpace(rawURL) == "" {
		return HealthResult{}, errors.New("url is required")
	}
	timeout := time.Duration(timeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 12 * time.Second
	}
	client := s.client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	}
	startedAt := time.Now()
	status := StatusUnknown
	httpStatus := 0
	finalURL := rawURL
	message := ""

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		message = "站点地址无效。"
	} else {
		request.Header.Set("User-Agent", "FunBox/1.0 resource-search-health")
		response, requestErr := client.Do(request)
		if requestErr != nil {
			if errors.Is(requestErr, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
				status = StatusTimeout
				message = "连接超时。"
			} else {
				status = StatusError
				message = "请求失败：" + requestErr.Error()
			}
		} else {
			_ = response.Body.Close()
			httpStatus = response.StatusCode
			if final := response.Request.URL.String(); final != "" {
				finalURL = final
			}
			switch {
			case httpStatus >= 200 && httpStatus < 400:
				status = StatusSuccess
				message = "站点可访问。"
			case httpStatus >= 400 && httpStatus < 500:
				status = StatusRestricted
				message = "站点返回受限状态。"
			default:
				status = StatusUnavailable
				message = "站点返回异常状态。"
			}
		}
	}
	return HealthResult{
		SourceID:   "",
		Status:     status,
		HTTPStatus: httpStatus,
		LatencyMS:  time.Since(startedAt).Milliseconds(),
		FinalURL:   finalURL,
		Message:    message,
		Trigger:    trigger,
		CheckedAt:  time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (s *Service) Stats(ctx context.Context, days int) (AdminStats, error) {
	if s.store == nil {
		return AdminStats{}, errors.New("resource search store unavailable")
	}
	stats, err := s.store.Stats(ctx, days)
	if err != nil {
		return AdminStats{}, err
	}
	keywords, err := s.store.TopKeywords(ctx, days, 10)
	if err != nil {
		return AdminStats{}, err
	}
	total := 0
	for _, item := range stats {
		total += item.SearchCount
	}
	return AdminStats{Days: days, Sources: stats, TopKeywords: keywords, TotalSearches: total}, nil
}

func (s *Service) Store() *Store {
	return s.store
}

func (s *Service) loadSource(ctx context.Context, sourceID string) (Source, error) {
	if s.store != nil {
		source, err := s.store.GetSource(ctx, sourceID)
		if err != nil {
			return Source{}, err
		}
		return source, nil
	}
	source, ok := s.sources[sourceID]
	if !ok {
		return Source{}, ErrSourceNotFound
	}
	return source, nil
}

func (s *Service) adapterFor(source Source) (provider, bool) {
	adapter, ok := s.adapters[source.AdapterKey]
	if ok {
		return adapter, true
	}
	providerItem, ok := s.providers[source.ID]
	return providerItem, ok
}

func (s *Service) cached(key string) (SourceResult, bool) {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.cache[key]
	if !ok {
		return SourceResult{}, false
	}
	if !entry.expiresAt.After(now) {
		delete(s.cache, key)
		return SourceResult{}, false
	}
	return entry.response, true
}

func (s *Service) pruneLocked(now time.Time) {
	for key, entry := range s.cache {
		if !entry.expiresAt.After(now) {
			delete(s.cache, key)
		}
	}
	for key, reference := range s.references {
		if !reference.expiresAt.After(now) {
			delete(s.references, key)
		}
	}
}

func normalizeQuery(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func resultID(sourceID string, query string, reference string, title string) string {
	digest := sha256.Sum256([]byte(sourceID + "\x00" + query + "\x00" + reference + "\x00" + title))
	return hex.EncodeToString(digest[:12])
}

func buildSearchURL(template string, query string) (string, error) {
	if !strings.Contains(template, "{keyword}") {
		return "", errors.New("search template must contain {keyword}")
	}
	target := strings.ReplaceAll(template, "{keyword}", url.PathEscape(strings.ReplaceAll(query, " ", "")))
	parsed, err := url.Parse(target)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return "", errors.New("search template must produce a valid URL")
	}
	return parsed.String(), nil
}

func laoerSearchURL(query string) string {
	return "https://laoer.motewan.com/s/" + url.PathEscape(strings.ReplaceAll(query, " ", "")) + ".html"
}

func validateSourceInput(input SourceInput) error {
	name := strings.TrimSpace(input.Name)
	if name == "" || len([]rune(name)) > 20 {
		return errors.New("source name is required and must be within 20 characters")
	}
	if input.Category == "" {
		input.Category = "综合"
	}
	if input.Mode != SourceModeAggregate && input.Mode != SourceModeDirect {
		return errors.New("source mode must be aggregate or direct")
	}
	if input.Mode == SourceModeAggregate && input.AdapterKey != adapterLaoerSSE {
		return errors.New("aggregate source requires a registered adapter")
	}
	if input.Mode == SourceModeDirect &&
		input.AdapterKey != adapterDirectLink &&
		input.AdapterKey != adapterHomepageOnly {
		return errors.New("direct source adapter is invalid")
	}
	if input.AdapterKey == adapterDirectLink && input.SearchURLTemplate == "" {
		return errors.New("direct link source requires a search URL template")
	}
	if input.LogoType != "" && input.LogoType != "text" && input.LogoType != "image" {
		return errors.New("logo type must be text or image")
	}
	if input.LogoType == "text" && strings.TrimSpace(input.LogoText) == "" {
		return errors.New("text logo requires logo text")
	}
	if input.MaxResults < 1 || input.MaxResults > 50 {
		return errors.New("max results must be between 1 and 50")
	}
	if input.TimeoutMS < 1000 || input.TimeoutMS > 30000 {
		return errors.New("timeout must be between 1000 and 30000 ms")
	}
	if input.CacheTTLMS < 0 || input.CacheTTLMS > 3600000 {
		return errors.New("cache ttl must be between 0 and 3600000 ms")
	}
	if input.SortOrder < 0 || input.SortOrder > 999 {
		return errors.New("sort order must be between 0 and 999")
	}
	parsed, err := url.Parse(input.HomepageURL)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return errors.New("homepage URL must be a valid http(s) URL")
	}
	if input.SearchURLTemplate != "" {
		if _, err := buildSearchURL(input.SearchURLTemplate, "test"); err != nil {
			return err
		}
	}
	return nil
}

func isPublicHost(ctx context.Context, rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	host := parsed.Hostname()
	if ip := net.ParseIP(host); ip != nil {
		return !isPrivateIP(ip)
	}
	addresses, err := net.DefaultResolver.LookupHost(ctx, host)
	if err != nil {
		return false
	}
	for _, address := range addresses {
		if ip := net.ParseIP(address); ip != nil && isPrivateIP(ip) {
			return false
		}
	}
	return true
}

func isPrivateIP(ip net.IP) bool {
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

func safeSourceID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return value[:min(len(value), 64)]
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
