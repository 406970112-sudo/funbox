package marketradar

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	historyLines     = 30
	trendPoints      = 21
	constituentLimit = 3
	quotePageSize    = 100
	maxQuotePages    = 8
	boardWorkers     = 5
)

var (
	ErrSourceUnavailable    = errors.New("market radar source unavailable")
	ErrSourceInvalid        = errors.New("market radar source invalid")
	ErrInsufficientCoverage = errors.New("market radar insufficient coverage")
)

type Category struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type Period struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type Coverage struct {
	Loaded    int `json:"loaded"`
	Requested int `json:"requested"`
}

type Constituent struct {
	Change float64 `json:"change"`
	Code   string  `json:"code"`
	Name   string  `json:"name"`
	Weight float64 `json:"weight"`
}

type Indicator struct {
	Advancing int     `json:"advancing"`
	Amount    float64 `json:"amount"`
	Close     float64 `json:"close"`
	Coverage  int     `json:"coverage"`
	Declining int     `json:"declining"`
	Turnover  float64 `json:"turnover"`
}

type Pulse struct {
	Advancing         int    `json:"advancing"`
	Declining         int    `json:"declining"`
	Score             int    `json:"score"`
	State             string `json:"state"`
	StrongestSectorID string `json:"strongestSectorId"`
}

type Sector struct {
	Anomaly      string             `json:"anomaly,omitempty"`
	CategoryIDs  []string           `json:"categoryIds"`
	Changes      map[string]float64 `json:"changes"`
	Constituents []Constituent      `json:"constituents"`
	ID           string             `json:"id"`
	Indicator    Indicator          `json:"indicator"`
	Methodology  string             `json:"methodology"`
	Name         string             `json:"name"`
	Series       []float64          `json:"series"`
}

type Snapshot struct {
	Categories []Category                  `json:"categories"`
	Coverage   Coverage                    `json:"coverage"`
	FetchedAt  time.Time                   `json:"fetchedAt"`
	Periods    []Period                    `json:"periods"`
	Pulses     map[string]map[string]Pulse `json:"pulses"`
	Sectors    []Sector                    `json:"sectors"`
	Source     string                      `json:"source"`
	SourceURL  string                      `json:"sourceUrl"`
	Stale      bool                        `json:"stale"`
}

type boardDefinition struct {
	Category string
	ID       string
	Name     string
}

var boardDefinitions = []boardDefinition{
	{Category: "ai", ID: "BK1134", Name: "算力概念"},
	{Category: "ai", ID: "BK1128", Name: "CPO概念"},
	{Category: "ai", ID: "BK1127", Name: "AI芯片"},
	{Category: "ai", ID: "BK0800", Name: "人工智能"},
	{Category: "ai", ID: "BK0579", Name: "云计算"},
	{Category: "metals", ID: "BK0732", Name: "贵金属"},
	{Category: "metals", ID: "BK1615", Name: "铜"},
	{Category: "metals", ID: "BK1613", Name: "铝"},
	{Category: "metals", ID: "BK1626", Name: "稀土"},
	{Category: "metals", ID: "BK0479", Name: "钢铁"},
}

var categories = []Category{
	{ID: "global", Label: "全球"},
	{ID: "ai", Label: "AI"},
	{ID: "metals", Label: "有色"},
}

var periods = []Period{
	{ID: "1d", Label: "1日"},
	{ID: "5d", Label: "5日"},
	{ID: "20d", Label: "20日"},
}

type historyResponse struct {
	Data *struct {
		Klines []string `json:"klines"`
		Name   string   `json:"name"`
	} `json:"data"`
	Rc int `json:"rc"`
}

type quoteRow struct {
	F3  float64 `json:"f3"`
	F12 string  `json:"f12"`
	F14 string  `json:"f14"`
	F21 float64 `json:"f21"`
}

type quoteResponse struct {
	Data *struct {
		Diff  []quoteRow `json:"diff"`
		Total int        `json:"total"`
	} `json:"data"`
	Rc int `json:"rc"`
}

type boardResult struct {
	err    error
	sector Sector
}

type Config struct {
	CacheTTL       time.Duration
	HistoryBaseURL string
	QuoteBaseURL   string
	RequestTimeout time.Duration
}

type Service struct {
	cacheTTL    time.Duration
	client      *http.Client
	config      Config
	hasSnapshot bool
	mu          sync.Mutex
	now         func() time.Time
	snapshot    Snapshot
}

func NewService(cfg Config) *Service {
	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 2 * time.Minute
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 12 * time.Second
	}
	if strings.TrimSpace(cfg.HistoryBaseURL) == "" {
		cfg.HistoryBaseURL = "https://push2his.eastmoney.com"
	}
	if strings.TrimSpace(cfg.QuoteBaseURL) == "" {
		cfg.QuoteBaseURL = "https://push2delay.eastmoney.com"
	}

	return &Service{
		cacheTTL: cfg.CacheTTL,
		client: &http.Client{
			Timeout: cfg.RequestTimeout,
			Transport: &http.Transport{
				ForceAttemptHTTP2: false,
				TLSNextProto:      map[string]func(string, *tls.Conn) http.RoundTripper{},
			},
		},
		config: cfg,
		now:    time.Now,
	}
}

func (s *Service) Snapshot(ctx context.Context, force bool) (Snapshot, error) {
	now := s.now()
	s.mu.Lock()
	if !force && s.hasSnapshot && now.Sub(s.snapshot.FetchedAt) < s.cacheTTL {
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
	return Snapshot{}, err
}

func (s *Service) fetch(ctx context.Context, fetchedAt time.Time) (Snapshot, error) {
	results := make([]boardResult, len(boardDefinitions))
	work := make(chan struct{}, boardWorkers)
	var wg sync.WaitGroup
	for index, board := range boardDefinitions {
		wg.Add(1)
		go func(index int, board boardDefinition) {
			defer wg.Done()
			work <- struct{}{}
			defer func() { <-work }()
			sector, err := s.fetchBoard(ctx, board)
			results[index] = boardResult{err: err, sector: sector}
		}(index, board)
	}
	wg.Wait()

	sectors := make([]Sector, 0, len(boardDefinitions))
	loadedByCategory := make(map[string]int)
	var firstErr error
	for _, result := range results {
		if result.err != nil {
			if firstErr == nil {
				firstErr = result.err
			}
			continue
		}
		sectors = append(sectors, result.sector)
		loadedByCategory[primaryCategory(result.sector)]++
	}
	if len(sectors) == 0 {
		if firstErr != nil {
			return Snapshot{}, firstErr
		}
		return Snapshot{}, fmt.Errorf("%w: no board data loaded: %v", ErrInsufficientCoverage, firstErr)
	}
	if loadedByCategory["ai"] == 0 || loadedByCategory["metals"] == 0 {
		return Snapshot{}, fmt.Errorf(
			"%w: ai=%d metals=%d",
			ErrInsufficientCoverage,
			loadedByCategory["ai"],
			loadedByCategory["metals"],
		)
	}

	sort.Slice(sectors, func(left int, right int) bool {
		return sectors[left].ID < sectors[right].ID
	})
	annotateAnomalies(sectors)
	pulses := buildPulses(sectors)

	return Snapshot{
		Categories: categories,
		Coverage: Coverage{
			Loaded:    len(sectors),
			Requested: len(boardDefinitions),
		},
		FetchedAt: fetchedAt,
		Periods:   periods,
		Pulses:    pulses,
		Sectors:   sectors,
		Source:    "eastmoney",
		SourceURL: "https://quote.eastmoney.com",
		Stale:     false,
	}, nil
}

func (s *Service) fetchBoard(ctx context.Context, board boardDefinition) (Sector, error) {
	history, err := s.fetchHistory(ctx, board.ID)
	if err != nil {
		return Sector{}, err
	}
	quotes, err := s.fetchQuotes(ctx, board.ID)
	if err != nil {
		return Sector{}, err
	}
	return buildSector(board, history, quotes)
}

func (s *Service) fetchHistory(ctx context.Context, boardID string) (historyResponse, error) {
	query := url.Values{}
	query.Set("secid", "90."+boardID)
	query.Set("ut", "fa5fd1943c7b386f172d6893dbfba10b")
	query.Set("klt", "101")
	query.Set("fqt", "1")
	query.Set("lmt", strconv.Itoa(historyLines))
	query.Set("end", "20500101")
	query.Set("fields1", "f1,f2,f3,f4,f5,f6")
	query.Set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61")
	endpoint := strings.TrimRight(s.config.HistoryBaseURL, "/") + "/api/qt/stock/kline/get?" + query.Encode()

	var response historyResponse
	if err := s.getJSON(ctx, endpoint, &response); err != nil {
		return historyResponse{}, err
	}
	if response.Rc != 0 || response.Data == nil || len(response.Data.Klines) == 0 {
		return historyResponse{}, fmt.Errorf("%w: board %s kline rc=%d", ErrSourceInvalid, boardID, response.Rc)
	}
	return response, nil
}

func (s *Service) fetchQuotes(ctx context.Context, boardID string) ([]quoteRow, error) {
	query := url.Values{}
	query.Set("ut", "fa5fd1943c7b386f172d6893dbfba10b")
	query.Set("po", "1")
	query.Set("np", "1")
	query.Set("fltt", "2")
	query.Set("invt", "2")
	query.Set("fid", "f21")
	query.Set("fs", "b:"+boardID+"+f:!50")
	query.Set("fields", "f3,f12,f14,f21")

	rows := make([]quoteRow, 0)
	var total int
	for page := 1; page <= maxQuotePages; page++ {
		query.Set("pn", strconv.Itoa(page))
		query.Set("pz", strconv.Itoa(quotePageSize))
		endpoint := strings.TrimRight(s.config.QuoteBaseURL, "/") + "/api/qt/clist/get?" + query.Encode()

		var response quoteResponse
		if err := s.getJSON(ctx, endpoint, &response); err != nil {
			if page == 1 {
				return nil, err
			}
			break
		}
		if response.Rc != 0 || response.Data == nil {
			if page == 1 {
				return nil, fmt.Errorf("%w: board %s quote rc=%d", ErrSourceInvalid, boardID, response.Rc)
			}
			break
		}
		total = response.Data.Total
		rows = append(rows, response.Data.Diff...)
		if len(response.Data.Diff) < quotePageSize || len(rows) >= total {
			break
		}
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("%w: board %s has no constituents", ErrSourceInvalid, boardID)
	}
	return rows, nil
}

func (s *Service) getJSON(ctx context.Context, endpoint string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Referer", "https://quote.eastmoney.com/")
	request.Header.Set(
		"User-Agent",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
	)

	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("%w: upstream status %d", ErrSourceUnavailable, response.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(target); err != nil {
		return fmt.Errorf("%w: %v", ErrSourceInvalid, err)
	}
	return nil
}

func buildSector(board boardDefinition, history historyResponse, quotes []quoteRow) (Sector, error) {
	closes := make([]float64, 0, len(history.Data.Klines))
	latestAmount := 0.0
	latestTurnover := 0.0
	for _, line := range history.Data.Klines {
		parts := strings.Split(line, ",")
		if len(parts) < 11 {
			return Sector{}, fmt.Errorf("%w: malformed kline for %s", ErrSourceInvalid, board.ID)
		}
		closePrice, err := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
		if err != nil {
			return Sector{}, fmt.Errorf("%w: kline close for %s", ErrSourceInvalid, board.ID)
		}
		closes = append(closes, closePrice)
	}
	if len(closes) < trendPoints {
		return Sector{}, fmt.Errorf("%w: board %s only has %d closes", ErrSourceInvalid, board.ID, len(closes))
	}
	if amount, err := strconv.ParseFloat(strings.TrimSpace(strings.Split(history.Data.Klines[len(history.Data.Klines)-1], ",")[6]), 64); err == nil {
		latestAmount = amount
	}
	if turnover, err := strconv.ParseFloat(strings.TrimSpace(strings.Split(history.Data.Klines[len(history.Data.Klines)-1], ",")[10]), 64); err == nil {
		latestTurnover = turnover
	}

	constituents, advancing, declining, coverage, err := buildConstituents(quotes)
	if err != nil {
		return Sector{}, err
	}

	name := strings.TrimSpace(history.Data.Name)
	if name == "" {
		name = board.Name
	}
	return Sector{
		Anomaly:      "",
		CategoryIDs:  categoryIDs(board.Category),
		Changes:      intervalReturns(closes),
		Constituents: constituents,
		ID:           board.ID,
		Indicator: Indicator{
			Advancing: advancing,
			Amount:    latestAmount,
			Close:     closes[len(closes)-1],
			Coverage:  coverage,
			Declining: declining,
			Turnover:  latestTurnover,
		},
		Methodology: "东方财富公开板块行情 · 日K收盘价区间收益 · 成分按流通市值权重",
		Name:        name,
		Series:      normalizedSeries(closes),
	}, nil
}

func categoryIDs(category string) []string {
	if category == "global" {
		return []string{"global"}
	}
	if category == "metals" {
		return []string{"global", "metals"}
	}
	return []string{"global", "ai"}
}

func intervalReturns(closes []float64) map[string]float64 {
	latest := closes[len(closes)-1]
	return map[string]float64{
		"1d":  percentChange(latest, closes[len(closes)-2]),
		"5d":  percentChange(latest, closes[len(closes)-6]),
		"20d": percentChange(latest, closes[len(closes)-21]),
	}
}

func percentChange(current float64, previous float64) float64 {
	if previous == 0 {
		return 0
	}
	return (current - previous) / previous * 100
}

func normalizedSeries(closes []float64) []float64 {
	start := len(closes) - trendPoints
	base := closes[start]
	series := make([]float64, trendPoints)
	for index := range series {
		series[index] = closes[start+index] / base * 100
	}
	return series
}

func buildConstituents(rows []quoteRow) ([]Constituent, int, int, int, error) {
	valid := make([]quoteRow, 0, len(rows))
	advancing := 0
	declining := 0
	for _, row := range rows {
		if strings.TrimSpace(row.F12) == "" || strings.TrimSpace(row.F14) == "" {
			continue
		}
		valid = append(valid, row)
		if row.F3 > 0 {
			advancing++
		} else if row.F3 < 0 {
			declining++
		}
	}
	if len(valid) == 0 {
		return nil, 0, 0, 0, fmt.Errorf("%w: no valid constituents", ErrSourceInvalid)
	}

	sorted := append([]quoteRow(nil), valid...)
	sort.SliceStable(sorted, func(left int, right int) bool {
		return sorted[left].F21 > sorted[right].F21
	})
	top := make([]quoteRow, 0, constituentLimit)
	for _, row := range sorted {
		if row.F21 <= 0 {
			continue
		}
		top = append(top, row)
		if len(top) == constituentLimit {
			break
		}
	}
	if len(top) == 0 {
		return nil, 0, 0, 0, fmt.Errorf("%w: no weighted constituents", ErrSourceInvalid)
	}

	weights := normalizeWeights(top)
	constituents := make([]Constituent, 0, len(top))
	for index, row := range top {
		constituents = append(constituents, Constituent{
			Change: row.F3,
			Code:   row.F12,
			Name:   row.F14,
			Weight: weights[index],
		})
	}
	return constituents, advancing, declining, len(valid), nil
}

func normalizeWeights(rows []quoteRow) []float64 {
	totalCap := 0.0
	for _, row := range rows {
		totalCap += row.F21
	}
	if totalCap <= 0 {
		return nil
	}

	weights := make([]float64, len(rows))
	remainders := make([]float64, len(rows))
	assigned := 0
	for index, row := range rows {
		exact := row.F21 / totalCap * 100
		rounded := math.Round(exact)
		weights[index] = rounded
		assigned += int(rounded)
		remainders[index] = exact - rounded
	}
	for assigned < 100 {
		index := largestRemainderIndex(remainders, weights)
		weights[index]++
		assigned++
	}
	for assigned > 100 {
		index := smallestRemainderIndex(remainders, weights)
		weights[index]--
		assigned--
	}
	return weights
}

func largestRemainderIndex(remainders []float64, weights []float64) int {
	bestIndex := 0
	for index := 1; index < len(remainders); index++ {
		if remainders[index] > remainders[bestIndex] {
			bestIndex = index
		}
	}
	return bestIndex
}

func smallestRemainderIndex(remainders []float64, weights []float64) int {
	bestIndex := 0
	for index := 1; index < len(remainders); index++ {
		if remainders[index] < remainders[bestIndex] {
			bestIndex = index
		}
	}
	return bestIndex
}

func buildPulses(sectors []Sector) map[string]map[string]Pulse {
	pulses := make(map[string]map[string]Pulse, len(categories))
	for _, category := range categories {
		byPeriod := make(map[string]Pulse, len(periods))
		for _, period := range periods {
			var advancing int
			var declining int
			strongestID := ""
			strongestChange := math.Inf(-1)
			for _, sector := range sectors {
				if !containsCategory(sector.CategoryIDs, category.ID) {
					continue
				}
				change := sector.Changes[period.ID]
				if change > 0 {
					advancing++
				} else if change < 0 {
					declining++
				}
				if change > strongestChange || (change == strongestChange && (strongestID == "" || sector.ID < strongestID)) {
					strongestChange = change
					strongestID = sector.ID
				}
			}
			total := advancing + declining
			score := 0
			if total > 0 {
				score = int(math.Round(float64(advancing) / float64(total) * 100))
			}
			byPeriod[period.ID] = Pulse{
				Advancing:         advancing,
				Declining:         declining,
				Score:             score,
				State:             pulseState(score),
				StrongestSectorID: strongestID,
			}
		}
		pulses[category.ID] = byPeriod
	}
	return pulses
}

func pulseState(score int) string {
	switch {
	case score >= 80:
		return "强势"
	case score >= 60:
		return "偏强"
	case score >= 40:
		return "震荡"
	default:
		return "偏弱"
	}
}

func containsCategory(categoryIDs []string, target string) bool {
	for _, categoryID := range categoryIDs {
		if categoryID == target {
			return true
		}
	}
	return false
}

func primaryCategory(sector Sector) string {
	for _, categoryID := range sector.CategoryIDs {
		if categoryID == "ai" || categoryID == "metals" {
			return categoryID
		}
	}
	return "global"
}

func annotateAnomalies(sectors []Sector) {
	bestByCategory := make(map[string]string)
	bestChangeByCategory := make(map[string]float64)
	for _, sector := range sectors {
		for _, categoryID := range sector.CategoryIDs {
			best, exists := bestChangeByCategory[categoryID]
			if !exists || sector.Changes["5d"] > best {
				bestChangeByCategory[categoryID] = sector.Changes["5d"]
				bestByCategory[categoryID] = sector.ID
			}
		}
	}
	for index := range sectors {
		primary := primaryCategory(sectors[index])
		if sectors[index].ID == bestByCategory[primary] && sectors[index].Changes["5d"] > 0 {
			sectors[index].Anomaly = fmt.Sprintf(
				"近5日上涨%.2f%%，同类板块最强",
				sectors[index].Changes["5d"],
			)
		}
	}
}

func cloneSnapshot(snapshot Snapshot) Snapshot {
	cloned := snapshot
	cloned.Sectors = make([]Sector, len(snapshot.Sectors))
	for index, sector := range snapshot.Sectors {
		cloned.Sectors[index] = sector
		cloned.Sectors[index].CategoryIDs = append([]string(nil), sector.CategoryIDs...)
		cloned.Sectors[index].Changes = make(map[string]float64, len(sector.Changes))
		for key, value := range sector.Changes {
			cloned.Sectors[index].Changes[key] = value
		}
		cloned.Sectors[index].Constituents = append([]Constituent(nil), sector.Constituents...)
		cloned.Sectors[index].Series = append([]float64(nil), sector.Series...)
	}
	cloned.Pulses = make(map[string]map[string]Pulse, len(snapshot.Pulses))
	for categoryID, byPeriod := range snapshot.Pulses {
		clonedPeriod := make(map[string]Pulse, len(byPeriod))
		for periodID, pulse := range byPeriod {
			clonedPeriod[periodID] = pulse
		}
		cloned.Pulses[categoryID] = clonedPeriod
	}
	return cloned
}
