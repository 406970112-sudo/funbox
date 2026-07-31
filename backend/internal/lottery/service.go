package lottery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"my-first-expo-app/backend/internal/config"
)

const analysisWindowMax = 300

var (
	ErrSourceInvalid     = errors.New("lottery source invalid")
	ErrSourceUnavailable = errors.New("lottery source unavailable")
)

type Draw struct {
	Blue  int    `json:"blue"`
	Date  string `json:"date"`
	Issue string `json:"issue"`
	Red   []int  `json:"red"`
}

type HistorySnapshot struct {
	AnalysisWindowMax int       `json:"analysisWindowMax"`
	Draws             []Draw    `json:"draws"`
	FetchedAt         time.Time `json:"fetchedAt"`
	Source            string    `json:"source"`
	SourceURL         string    `json:"sourceUrl"`
	Stale             bool      `json:"stale"`
}

type upstreamResponse struct {
	Result []upstreamDraw `json:"result"`
	State  int            `json:"state"`
}

type upstreamDraw struct {
	Blue string `json:"blue"`
	Code string `json:"code"`
	Date string `json:"date"`
	Red  string `json:"red"`
}

type Service struct {
	cacheTTL    time.Duration
	client      *http.Client
	config      config.LotteryConfig
	hasSnapshot bool
	mu          sync.Mutex
	now         func() time.Time
	snapshot    HistorySnapshot
}

func NewService(cfg config.LotteryConfig) *Service {
	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 15 * time.Minute
	}
	if cfg.FetchCount <= 0 {
		cfg.FetchCount = 400
	}
	if cfg.MinimumDraws <= 0 {
		cfg.MinimumDraws = 360
	}
	if strings.TrimSpace(cfg.Referer) == "" {
		cfg.Referer = "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/"
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 10 * time.Second
	}
	if strings.TrimSpace(cfg.SourceURL) == "" {
		cfg.SourceURL = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=400"
	}

	return &Service{
		cacheTTL: cfg.CacheTTL,
		client:   &http.Client{Timeout: cfg.RequestTimeout},
		config:   cfg,
		now:      time.Now,
	}
}

func (s *Service) History(ctx context.Context) (HistorySnapshot, error) {
	now := s.now()
	s.mu.Lock()
	if s.hasSnapshot && now.Sub(s.snapshot.FetchedAt) < s.cacheTTL {
		snapshot := cloneSnapshot(s.snapshot)
		s.mu.Unlock()
		return snapshot, nil
	}
	s.mu.Unlock()

	snapshot, err := s.fetch(ctx, now)
	if err == nil {
		s.mu.Lock()
		s.snapshot = cloneSnapshot(snapshot)
		s.hasSnapshot = true
		s.mu.Unlock()
		return snapshot, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.hasSnapshot {
		stale := cloneSnapshot(s.snapshot)
		stale.Stale = true
		return stale, nil
	}
	return HistorySnapshot{}, err
}

func (s *Service) fetch(ctx context.Context, fetchedAt time.Time) (HistorySnapshot, error) {
	requestURL, err := url.Parse(s.config.SourceURL)
	if err != nil {
		return HistorySnapshot{}, fmt.Errorf("%w: invalid source URL", ErrSourceUnavailable)
	}
	query := requestURL.Query()
	query.Set("issueCount", strconv.Itoa(s.config.FetchCount))
	requestURL.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return HistorySnapshot{}, fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Referer", s.config.Referer)
	request.Header.Set("User-Agent", "FunBox/1.0")

	response, err := s.client.Do(request)
	if err != nil {
		return HistorySnapshot{}, fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return HistorySnapshot{}, fmt.Errorf("%w: upstream status %d", ErrSourceUnavailable, response.StatusCode)
	}

	var payload upstreamResponse
	decoder := json.NewDecoder(io.LimitReader(response.Body, 4<<20))
	if err := decoder.Decode(&payload); err != nil {
		return HistorySnapshot{}, fmt.Errorf("%w: %v", ErrSourceInvalid, err)
	}
	if payload.State != 0 {
		return HistorySnapshot{}, fmt.Errorf("%w: upstream state %d", ErrSourceInvalid, payload.State)
	}

	draws := make([]Draw, 0, len(payload.Result))
	seenIssues := make(map[string]struct{}, len(payload.Result))
	for _, item := range payload.Result {
		draw, parseErr := parseDraw(item)
		if parseErr != nil {
			continue
		}
		if _, exists := seenIssues[draw.Issue]; exists {
			continue
		}
		seenIssues[draw.Issue] = struct{}{}
		draws = append(draws, draw)
	}
	if len(draws) < s.config.MinimumDraws {
		return HistorySnapshot{}, fmt.Errorf("%w: only %d valid draws", ErrSourceInvalid, len(draws))
	}

	sort.Slice(draws, func(left int, right int) bool {
		return draws[left].Issue > draws[right].Issue
	})
	return HistorySnapshot{
		AnalysisWindowMax: analysisWindowMax,
		Draws:             draws,
		FetchedAt:         fetchedAt,
		Source:            "cwl",
		SourceURL:         requestURL.String(),
		Stale:             false,
	}, nil
}

func ValidateDraw(draw Draw) error {
	if strings.TrimSpace(draw.Issue) == "" || strings.TrimSpace(draw.Date) == "" || len(draw.Red) != 6 || draw.Blue < 1 || draw.Blue > 16 {
		return ErrSourceInvalid
	}
	seen := make(map[int]struct{}, len(draw.Red))
	for _, ball := range draw.Red {
		if ball < 1 || ball > 33 {
			return ErrSourceInvalid
		}
		if _, exists := seen[ball]; exists {
			return ErrSourceInvalid
		}
		seen[ball] = struct{}{}
	}
	return nil
}

func parseDraw(item upstreamDraw) (Draw, error) {
	red, err := parseBalls(item.Red)
	if err != nil {
		return Draw{}, err
	}
	blue, err := strconv.Atoi(strings.TrimSpace(item.Blue))
	if err != nil {
		return Draw{}, ErrSourceInvalid
	}
	draw := Draw{
		Blue:  blue,
		Date:  normalizeDate(item.Date),
		Issue: strings.TrimSpace(item.Code),
		Red:   red,
	}
	if err := ValidateDraw(draw); err != nil {
		return Draw{}, err
	}
	sort.Ints(draw.Red)
	return draw, nil
}

func parseBalls(value string) ([]int, error) {
	parts := strings.Split(value, ",")
	if len(parts) != 6 {
		return nil, ErrSourceInvalid
	}
	balls := make([]int, 0, len(parts))
	for _, part := range parts {
		ball, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil {
			return nil, ErrSourceInvalid
		}
		balls = append(balls, ball)
	}
	return balls, nil
}

func normalizeDate(value string) string {
	value = strings.TrimSpace(value)
	if index := strings.IndexAny(value, "(（"); index >= 0 {
		value = value[:index]
	}
	return strings.TrimSpace(value)
}

func cloneSnapshot(snapshot HistorySnapshot) HistorySnapshot {
	cloned := snapshot
	cloned.Draws = make([]Draw, len(snapshot.Draws))
	for index, draw := range snapshot.Draws {
		cloned.Draws[index] = draw
		cloned.Draws[index].Red = append([]int(nil), draw.Red...)
	}
	return cloned
}
