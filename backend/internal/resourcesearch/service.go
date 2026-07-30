package resourcesearch

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"my-first-expo-app/backend/internal/config"
)

const laoerSourceID = "laoer-motewan"

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

type sourceDefinition struct {
	FallbackURL string
	Message     string
	Status      SourceStatus
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

type Service struct {
	cache      map[string]cacheEntry
	cacheTTL   time.Duration
	maxResults int
	mu         sync.Mutex
	providers  map[string]provider
	references map[string]resultReference
	sources    map[string]sourceDefinition
}

func NewService(cfg config.ResourceSearchConfig) *Service {
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
	return newService(cacheTTL, maxResults, []provider{laoer})
}

func newService(cacheTTL time.Duration, maxResults int, providers []provider) *Service {
	providerMap := make(map[string]provider, len(providers))
	for _, item := range providers {
		providerMap[item.SourceID()] = item
	}

	return &Service{
		cache:      make(map[string]cacheEntry),
		cacheTTL:   cacheTTL,
		maxResults: maxResults,
		providers:  providerMap,
		references: make(map[string]resultReference),
		sources: map[string]sourceDefinition{
			"quark-pan-search": {
				FallbackURL: "https://www.quarkpanso.com/",
				Message:     "来源站要求浏览器签名验证，暂无法站内聚合。",
				Status:      StatusRestricted,
			},
			"panyq": {
				FallbackURL: "https://panyq.com/",
				Message:     "来源站启用了安全挑战，暂无法站内聚合。",
				Status:      StatusRestricted,
			},
			"tvso": {
				FallbackURL: "https://www.tvso.uk/",
				Message:     "来源站尚未提供稳定的公开搜索接口。",
				Status:      StatusUnavailable,
			},
			"funletu-pan": {
				FallbackURL: "https://pan.funletu.com/",
				Message:     "来源站当前返回占位页面，暂无法检索。",
				Status:      StatusUnavailable,
			},
			"yunso": {
				FallbackURL: "https://www.yunso.net/",
				Message:     "来源站启用了访问保护，暂无法站内聚合。",
				Status:      StatusRestricted,
			},
			laoerSourceID: {
				FallbackURL: "https://laoer.motewan.com/",
				Status:      StatusSuccess,
			},
		},
	}
}

func (s *Service) Search(ctx context.Context, sourceID string, rawQuery string) (SourceResult, error) {
	query := normalizeQuery(rawQuery)
	definition, known := s.sources[sourceID]
	if !known {
		return SourceResult{}, fmt.Errorf("unknown source: %s", sourceID)
	}
	if query == "" {
		return SourceResult{}, errors.New("query is required")
	}

	cacheKey := sourceID + "\x00" + strings.ToLower(query)
	if cached, ok := s.cached(cacheKey); ok {
		return cached, nil
	}

	providerItem, supported := s.providers[sourceID]
	if !supported {
		return SourceResult{
			FallbackURL: definition.FallbackURL,
			Message:     definition.Message,
			Query:       query,
			Results:     []Result{},
			SourceID:    sourceID,
			Status:      definition.Status,
		}, nil
	}

	startedAt := time.Now()
	items, err := providerItem.Search(ctx, query, s.maxResults)
	durationMS := time.Since(startedAt).Milliseconds()
	if err != nil {
		status := StatusError
		message := "来源搜索失败，请稍后重试。"
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			status = StatusTimeout
			message = "来源响应超时，可稍后重试或前往原站。"
		}
		return SourceResult{
			DurationMS:  durationMS,
			FallbackURL: definition.FallbackURL,
			Message:     message,
			Query:       query,
			Results:     []Result{},
			SourceID:    sourceID,
			Status:      status,
		}, nil
	}

	results := make([]Result, 0, len(items))
	references := make(map[string]resultReference)
	now := time.Now()
	for _, item := range items {
		resultID := resultID(sourceID, query, item.Reference, item.Title)
		originURL := laoerSearchURL(query)
		result := Result{
			Category:        item.Category,
			DiskType:        item.DiskType,
			ID:              resultID,
			OriginURL:       originURL,
			RequiresResolve: item.TargetURL == "" && item.Reference != "",
			Size:            item.Size,
			SourceID:        sourceID,
			TargetURL:       item.TargetURL,
			Title:           item.Title,
			UpdatedAt:       item.UpdatedAt,
		}
		results = append(results, result)
		if result.RequiresResolve {
			references[resultID] = resultReference{
				expiresAt: now.Add(s.cacheTTL),
				provider:  providerItem,
				result:    item,
			}
		}
	}

	status := StatusSuccess
	message := ""
	if len(results) == 0 {
		status = StatusEmpty
		message = "该来源暂未找到相关结果。"
	}
	response := SourceResult{
		Count:       len(results),
		DurationMS:  durationMS,
		FallbackURL: definition.FallbackURL,
		Message:     message,
		Query:       query,
		Results:     results,
		SourceID:    sourceID,
		Status:      status,
	}

	s.mu.Lock()
	s.cache[cacheKey] = cacheEntry{expiresAt: now.Add(s.cacheTTL), response: response}
	for key, reference := range references {
		s.references[key] = reference
	}
	s.pruneLocked(now)
	s.mu.Unlock()
	return response, nil
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

func laoerSearchURL(query string) string {
	return "https://laoer.motewan.com/s/" + url.PathEscape(strings.ReplaceAll(query, " ", "")) + ".html"
}
