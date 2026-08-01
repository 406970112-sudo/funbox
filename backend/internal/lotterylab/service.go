package lotterylab

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
)

const (
	defaultFetchCount         = 400
	maxFetchCount             = 1000
	minFetchCount             = 100
	minimumDrawsForLargeCount = 360
)

var (
	ErrSourceInvalid     = errors.New("lottery lab source invalid")
	ErrSourceUnavailable = errors.New("lottery lab source unavailable")
)

type Config struct {
	CacheTTL          time.Duration
	DefaultFetchCount int
	MaxFetchCount     int
	Referer           string
	RequestTimeout    time.Duration
	SourceURL         string
}

type Draw struct {
	Blue        int    `json:"blue"`
	Date        string `json:"date"`
	Issue       string `json:"issue"`
	Red         []int  `json:"red"`
	FirstPrize  int64  `json:"firstPrize"`
	SecondPrize int64  `json:"secondPrize"`
}

type HistorySnapshot struct {
	Count     int       `json:"count"`
	Draws     []Draw    `json:"draws"`
	FetchedAt time.Time `json:"fetchedAt"`
	Source    string    `json:"source"`
	SourceURL string    `json:"sourceUrl"`
	Stale     bool      `json:"stale"`
}

type upstreamResponse struct {
	Result []upstreamDraw `json:"result"`
	State  int            `json:"state"`
}

type upstreamDraw struct {
	Blue        string               `json:"blue"`
	Code        string               `json:"code"`
	Date        string               `json:"date"`
	Red         string               `json:"red"`
	PrizeGrades []upstreamPrizeGrade `json:"prizegrades"`
}

type upstreamPrizeGrade struct {
	Type      int    `json:"type"`
	TypeMoney string `json:"typemoney"`
}

type cachedSnapshot struct {
	fetchedAt time.Time
	snapshot  HistorySnapshot
}

type Service struct {
	cacheTTL  time.Duration
	client    *http.Client
	config    Config
	mu        sync.Mutex
	now       func() time.Time
	snapshots map[int]cachedSnapshot
}

func NewService(cfg Config) *Service {
	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 15 * time.Minute
	}
	if cfg.DefaultFetchCount <= 0 {
		cfg.DefaultFetchCount = defaultFetchCount
	}
	if cfg.MaxFetchCount <= 0 {
		cfg.MaxFetchCount = maxFetchCount
	}
	if cfg.MaxFetchCount > maxFetchCount {
		cfg.MaxFetchCount = maxFetchCount
	}
	if strings.TrimSpace(cfg.Referer) == "" {
		cfg.Referer = "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/"
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 10 * time.Second
	}
	if strings.TrimSpace(cfg.SourceURL) == "" {
		cfg.SourceURL = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=1000"
	}

	return &Service{
		cacheTTL:  cfg.CacheTTL,
		client:    &http.Client{Timeout: cfg.RequestTimeout},
		config:    cfg,
		now:       time.Now,
		snapshots: make(map[int]cachedSnapshot),
	}
}

func (s *Service) History(ctx context.Context, requestedCount int) (HistorySnapshot, error) {
	count := s.normalizeCount(requestedCount)
	now := s.now()

	s.mu.Lock()
	if cached, ok := s.snapshots[count]; ok && now.Sub(cached.fetchedAt) < s.cacheTTL {
		snapshot := cloneSnapshot(cached.snapshot)
		s.mu.Unlock()
		return snapshot, nil
	}
	s.mu.Unlock()

	snapshot, err := s.fetch(ctx, count, now)
	if err == nil {
		s.mu.Lock()
		s.snapshots[count] = cachedSnapshot{
			fetchedAt: now,
			snapshot:  cloneSnapshot(snapshot),
		}
		s.mu.Unlock()
		return snapshot, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if cached, ok := s.snapshots[count]; ok {
		stale := cloneSnapshot(cached.snapshot)
		stale.Stale = true
		return stale, nil
	}
	return HistorySnapshot{}, err
}

func (s *Service) normalizeCount(count int) int {
	if count <= 0 {
		count = s.config.DefaultFetchCount
	}
	if count < minFetchCount {
		count = minFetchCount
	}
	if count > s.config.MaxFetchCount {
		count = s.config.MaxFetchCount
	}
	return count
}

func (s *Service) fetch(ctx context.Context, count int, fetchedAt time.Time) (HistorySnapshot, error) {
	requestURL, err := url.Parse(s.config.SourceURL)
	if err != nil {
		return HistorySnapshot{}, fmt.Errorf("%w: invalid source URL", ErrSourceUnavailable)
	}
	query := requestURL.Query()
	query.Set("issueCount", strconv.Itoa(count))
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

	required := count
	if required > minimumDrawsForLargeCount {
		required = minimumDrawsForLargeCount
	}
	if len(draws) < required {
		return HistorySnapshot{}, fmt.Errorf("%w: only %d valid draws", ErrSourceInvalid, len(draws))
	}

	sort.Slice(draws, func(left int, right int) bool {
		return draws[left].Issue > draws[right].Issue
	})
	return HistorySnapshot{
		Count:     count,
		Draws:     draws,
		FetchedAt: fetchedAt,
		Source:    "cwl",
		SourceURL: requestURL.String(),
		Stale:     false,
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
	firstPrize, secondPrize := parsePrizeGrades(item.PrizeGrades)
	draw := Draw{
		Blue:        blue,
		Date:        normalizeDate(item.Date),
		Issue:       strings.TrimSpace(item.Code),
		Red:         red,
		FirstPrize:  firstPrize,
		SecondPrize: secondPrize,
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

func parsePrizeGrades(grades []upstreamPrizeGrade) (int64, int64) {
	var firstPrize int64
	var secondPrize int64
	for _, grade := range grades {
		money, err := strconv.ParseInt(strings.TrimSpace(grade.TypeMoney), 10, 64)
		if err != nil || money < 0 {
			continue
		}
		switch grade.Type {
		case 1:
			firstPrize = money
		case 2:
			secondPrize = money
		}
	}
	return firstPrize, secondPrize
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
