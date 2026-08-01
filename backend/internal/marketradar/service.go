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
	historyLines         = 30
	trendPoints          = 21
	quotePageSize        = 100
	maxQuotePages        = 8
	requestRetries       = 1
	minCategoryBoards    = 3
	volumeRatioThreshold = 1.5
	reversalThreshold    = 3.0
	breadthThreshold     = 0.7
	signalLeaderCount    = 5
	boardListPageSize    = 100
	maxBoardListPages    = 8
	historyWorkers       = 2
	historyCacheTTL      = 15 * time.Minute
	historyEnrichTimeout = 8 * time.Second
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
	Amount float64 `json:"amount,omitempty"`
}

type Indicator struct {
	Advancing       int     `json:"advancing"`
	Amount          float64 `json:"amount"`
	AverageAmount   float64 `json:"averageAmount"`
	AverageTurnover float64 `json:"averageTurnover"`
	Close           float64 `json:"close"`
	Coverage        int     `json:"coverage"`
	Declining       int     `json:"declining"`
	Turnover        float64 `json:"turnover"`
}

type Pulse struct {
	Advancing         int    `json:"advancing"`
	Declining         int    `json:"declining"`
	Score             int    `json:"score"`
	State             string `json:"state"`
	StrongestSectorID string `json:"strongestSectorId"`
}

type Sector struct {
	CategoryIDs  []string           `json:"categoryIds"`
	Changes      map[string]float64 `json:"changes"`
	Constituents []Constituent      `json:"constituents"`
	ID           string             `json:"id"`
	Indicator    Indicator          `json:"indicator"`
	Methodology  string             `json:"methodology"`
	Name         string             `json:"name"`
	Series       []float64          `json:"series"`
	VolumeRatio  float64            `json:"volumeRatio,omitempty"`
}

type Index struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Code   string  `json:"code"`
	Close  float64 `json:"close"`
	Change float64 `json:"change"`
	Region string  `json:"region"`
}

type Signal struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Title       string `json:"title"`
	Description string `json:"description"`
	SectorID    string `json:"sectorId"`
	Severity    int    `json:"severity"`
}

type RelatedSector struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Score float64 `json:"score"`
}

type Snapshot struct {
	Categories []Category                  `json:"categories"`
	Coverage   Coverage                    `json:"coverage"`
	FetchedAt  time.Time                   `json:"fetchedAt"`
	Indices    []Index                     `json:"indices"`
	Periods    []Period                    `json:"periods"`
	Pulses     map[string]map[string]Pulse `json:"pulses"`
	Sectors    []Sector                    `json:"sectors"`
	Signals    []Signal                    `json:"signals"`
	Source     string                      `json:"source"`
	SourceURL  string                      `json:"sourceUrl"`
	Stale      bool                        `json:"stale"`
}

type SectorDetail struct {
	Sector
	Related []RelatedSector `json:"related"`
}

type boardDefinition struct {
	Category string
	ID       string
	Name     string
	Keywords []string
}

var boardDefinitions = []boardDefinition{
	{Category: "ai", ID: "BK1134", Name: "算力概念", Keywords: []string{"算力", "AI服务器", "数据中心"}},
	{Category: "ai", ID: "BK1128", Name: "CPO概念", Keywords: []string{"CPO", "光模块"}},
	{Category: "ai", ID: "BK1127", Name: "AI芯片", Keywords: []string{"AI芯片", "GPU", "NPU"}},
	{Category: "ai", ID: "BK0800", Name: "人工智能", Keywords: []string{"人工智能", "大模型", "AI"}},
	{Category: "ai", ID: "BK0579", Name: "云计算", Keywords: []string{"云计算", "云服务"}},
	{Category: "ai", ID: "BK0634", Name: "大数据", Keywords: []string{"大数据", "数据"}},
	{Category: "ai", ID: "BK1104", Name: "信创", Keywords: []string{"信创", "国产软件", "自主可控"}},
	{Category: "ai", ID: "BK1184", Name: "人形机器人", Keywords: []string{"人形机器人", "机器人"}},
	{Category: "ai", ID: "BK0802", Name: "无人驾驶", Keywords: []string{"无人驾驶", "自动驾驶", "智能驾驶"}},
	{Category: "ai", ID: "BK1036", Name: "半导体", Keywords: []string{"半导体", "芯片", "晶圆"}},
	{Category: "new-energy", ID: "BK1031", Name: "光伏设备", Keywords: []string{"光伏", "太阳能"}},
	{Category: "new-energy", ID: "BK1303", Name: "锂电池", Keywords: []string{"锂电池", "锂电", "电池"}},
	{Category: "new-energy", ID: "BK0989", Name: "储能概念", Keywords: []string{"储能", "电化学"}},
	{Category: "new-energy", ID: "BK1032", Name: "风电设备", Keywords: []string{"风电", "风机"}},
	{Category: "new-energy", ID: "BK0700", Name: "充电桩", Keywords: []string{"充电桩", "充电"}},
	{Category: "new-energy", ID: "BK0968", Name: "固态电池", Keywords: []string{"固态电池", "电池技术"}},
	{Category: "health", ID: "BK1106", Name: "创新药", Keywords: []string{"创新药", "医药", "药物"}},
	{Category: "health", ID: "BK1041", Name: "医疗器械", Keywords: []string{"医疗器械", "医疗设备"}},
	{Category: "health", ID: "BK1044", Name: "生物制品", Keywords: []string{"生物医药", "生物制品", "疫苗"}},
	{Category: "health", ID: "BK0896", Name: "白酒", Keywords: []string{"白酒", "酒"}},
	{Category: "health", ID: "BK0438", Name: "食品饮料", Keywords: []string{"食品", "饮料", "消费"}},
	{Category: "health", ID: "BK0727", Name: "医疗服务", Keywords: []string{"医疗服务", "医院", "医疗"}},
	{Category: "finance", ID: "BK0473", Name: "证券Ⅱ", Keywords: []string{"证券", "券商", "投行"}},
	{Category: "finance", ID: "BK1283", Name: "银行", Keywords: []string{"银行", "信贷"}},
	{Category: "finance", ID: "BK0474", Name: "保险Ⅱ", Keywords: []string{"保险"}},
	{Category: "finance", ID: "BK1202", Name: "房地产", Keywords: []string{"房地产", "地产"}},
	{Category: "finance", ID: "BK0738", Name: "多元金融", Keywords: []string{"金融", "信托", "金融科技"}},
	{Category: "finance", ID: "BK0637", Name: "互联网金融", Keywords: []string{"互联网金融", "支付", "金融科技"}},
	{Category: "manufacturing", ID: "BK0478", Name: "有色金属", Keywords: []string{"有色金属", "铜", "铝"}},
	{Category: "manufacturing", ID: "BK0732", Name: "贵金属", Keywords: []string{"贵金属", "黄金", "白银"}},
	{Category: "manufacturing", ID: "BK0479", Name: "钢铁", Keywords: []string{"钢铁"}},
	{Category: "manufacturing", ID: "BK0437", Name: "煤炭", Keywords: []string{"煤炭", "煤"}},
	{Category: "manufacturing", ID: "BK0464", Name: "石油石化", Keywords: []string{"石油", "石化", "油气"}},
	{Category: "manufacturing", ID: "BK1206", Name: "基础化工", Keywords: []string{"化工", "化学"}},
	{Category: "manufacturing", ID: "BK0490", Name: "军工", Keywords: []string{"军工", "国防"}},
	{Category: "manufacturing", ID: "BK0739", Name: "工程机械", Keywords: []string{"工程机械", "机械"}},
	{Category: "themes", ID: "BK1166", Name: "低空经济", Keywords: []string{"低空经济", "eVTOL", "飞行汽车"}},
	{Category: "themes", ID: "BK0921", Name: "卫星互联网", Keywords: []string{"卫星互联网", "卫星", "星链"}},
	{Category: "themes", ID: "BK0710", Name: "量子科技", Keywords: []string{"量子", "量子计算"}},
	{Category: "themes", ID: "BK1135", Name: "数据要素", Keywords: []string{"数据要素", "数据确权"}},
	{Category: "themes", ID: "BK0854", Name: "华为概念", Keywords: []string{"华为", "鸿蒙", "昇腾"}},
	{Category: "themes", ID: "BK1138", Name: "液冷概念", Keywords: []string{"液冷", "服务器散热"}},
	{Category: "themes", ID: "BK0877", Name: "PCB", Keywords: []string{"PCB", "印制电路板"}},
	{Category: "themes", ID: "BK0577", Name: "核能核电", Keywords: []string{"核电", "核能"}},
	{Category: "themes", ID: "BK0922", Name: "数据中心", Keywords: []string{"数据中心", "IDC", "算力租赁"}},
	{Category: "themes", ID: "BK1174", Name: "合成生物", Keywords: []string{"合成生物", "生物制造"}},
}

var categories = []Category{
	{ID: "market", Label: "全市场"},
	{ID: "ai", Label: "AI科技"},
	{ID: "new-energy", Label: "新能源"},
	{ID: "health", Label: "医药消费"},
	{ID: "finance", Label: "金融地产"},
	{ID: "manufacturing", Label: "周期制造"},
	{ID: "themes", Label: "热门题材"},
}

var periods = []Period{
	{ID: "1d", Label: "1日"},
	{ID: "5d", Label: "5日"},
	{ID: "20d", Label: "20日"},
}

var indexDefinitions = []indexDefinition{
	{ID: "sh", SecID: "1.000001", Code: "000001", Name: "上证指数", Region: "A股"},
	{ID: "sz", SecID: "0.399001", Code: "399001", Name: "深证成指", Region: "A股"},
	{ID: "cyb", SecID: "0.399006", Code: "399006", Name: "创业板指", Region: "A股"},
	{ID: "kc50", SecID: "1.000688", Code: "000688", Name: "科创50", Region: "A股"},
	{ID: "hs300", SecID: "1.000300", Code: "000300", Name: "沪深300", Region: "A股"},
	{ID: "zz500", SecID: "1.000905", Code: "000905", Name: "中证500", Region: "A股"},
	{ID: "hsi", SecID: "100.HSI", Code: "HSI", Name: "恒生指数", Region: "港股"},
	{ID: "hstech", SecID: "124.HSTECH", Code: "HSTECH", Name: "恒生科技", Region: "港股"},
	{ID: "ndx", SecID: "100.NDX", Code: "NDX", Name: "纳斯达克", Region: "海外"},
	{ID: "spx", SecID: "100.SPX", Code: "SPX", Name: "标普500", Region: "海外"},
	{ID: "djia", SecID: "100.DJIA", Code: "DJIA", Name: "道琼斯", Region: "海外"},
	{ID: "n225", SecID: "100.N225", Code: "N225", Name: "日经225", Region: "海外"},
}

type indexDefinition struct {
	ID     string
	SecID  string
	Code   string
	Name   string
	Region string
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
	F6  float64 `json:"f6"`
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

type flexFloat float64

func (f *flexFloat) UnmarshalJSON(data []byte) error {
	text := strings.TrimSpace(string(data))
	text = strings.Trim(text, `"`)
	if text == "" || text == "-" || text == "null" {
		*f = 0
		return nil
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return err
	}
	*f = flexFloat(value)
	return nil
}

type boardQuote struct {
	F2   flexFloat `json:"f2"`
	F3   flexFloat `json:"f3"`
	F6   flexFloat `json:"f6"`
	F8   flexFloat `json:"f8"`
	F10  flexFloat `json:"f10"`
	F12  string    `json:"f12"`
	F14  string    `json:"f14"`
	F104 flexFloat `json:"f104"`
	F105 flexFloat `json:"f105"`
	F109 flexFloat `json:"f109"`
	F110 flexFloat `json:"f110"`
	F134 flexFloat `json:"f134"`
}

type boardQuoteResponse struct {
	Data *struct {
		Diff  []boardQuote `json:"diff"`
		Total int          `json:"total"`
	} `json:"data"`
	Rc int `json:"rc"`
}

type indexRow struct {
	F2  float64 `json:"f2"`
	F3  float64 `json:"f3"`
	F12 string  `json:"f12"`
	F14 string  `json:"f14"`
}

type indexResponse struct {
	Data *struct {
		Diff []indexRow `json:"diff"`
	} `json:"data"`
	Rc int `json:"rc"`
}

type historyCacheEntry struct {
	fetchedAt      time.Time
	closes         []float64
	amountTotal    float64
	turnoverTotal  float64
	latestAmount   float64
	latestTurnover float64
}

type Config struct {
	CacheTTL       time.Duration
	HistoryBaseURL string
	QuoteBaseURL   string
	RequestTimeout time.Duration
}

type Service struct {
	cacheTTL         time.Duration
	client           *http.Client
	config           Config
	hasSnapshot      bool
	historyMu        sync.Mutex
	historyCache     map[string]historyCacheEntry
	historyDownUntil time.Time
	historyRunning   bool
	mu               sync.Mutex
	now              func() time.Time
	snapshot         Snapshot
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
				Proxy:             http.ProxyFromEnvironment,
				TLSNextProto:      map[string]func(string, *tls.Conn) http.RoundTripper{},
			},
		},
		config:       cfg,
		historyCache: make(map[string]historyCacheEntry),
		now:          time.Now,
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
		s.refreshHistoryInBackground()
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
	quotes, err := s.fetchBoardQuotes(ctx)
	if err != nil {
		return Snapshot{}, err
	}

	sectors := make([]Sector, 0, len(boardDefinitions))
	loadedByCategory := make(map[string]int)
	var firstErr error
	for _, board := range boardDefinitions {
		quote, exists := quotes[board.ID]
		if !exists {
			if firstErr == nil {
				firstErr = fmt.Errorf("%w: board %s missing from list", ErrSourceInvalid, board.ID)
			}
			continue
		}
		sectors = append(sectors, buildSector(board, quote))
		loadedByCategory[primaryCategory(sectors[len(sectors)-1])]++
	}
	if len(sectors) == 0 {
		if firstErr != nil {
			return Snapshot{}, fmt.Errorf("%w: %v", ErrInsufficientCoverage, firstErr)
		}
		return Snapshot{}, fmt.Errorf("%w: no board data loaded", ErrInsufficientCoverage)
	}
	for _, category := range categories {
		if category.ID == "market" {
			continue
		}
		if loadedByCategory[category.ID] < minCategoryBoards {
			return Snapshot{}, fmt.Errorf(
				"%w: %s=%d",
				ErrInsufficientCoverage,
				category.ID,
				loadedByCategory[category.ID],
			)
		}
	}

	sort.Slice(sectors, func(left int, right int) bool {
		return sectors[left].ID < sectors[right].ID
	})
	indices, _ := s.fetchIndices(ctx)
	pulses := buildPulses(sectors)
	signals := buildSignals(sectors)

	return Snapshot{
		Categories: categories,
		Coverage: Coverage{
			Loaded:    len(sectors),
			Requested: len(boardDefinitions),
		},
		FetchedAt: fetchedAt,
		Indices:   indices,
		Periods:   periods,
		Pulses:    pulses,
		Sectors:   sectors,
		Signals:   signals,
		Source:    "eastmoney",
		SourceURL: "https://quote.eastmoney.com",
		Stale:     false,
	}, nil
}

func (s *Service) fetchBoardQuotes(ctx context.Context) (map[string]boardQuote, error) {
	result := make(map[string]boardQuote, len(boardDefinitions))
	filters := []string{"m:90+t:2+f:!50", "m:90+t:3+f:!50"}

	type firstPage struct {
		rows  []boardQuote
		total int
		err   error
	}
	firstPages := make([]firstPage, len(filters))
	var firstWG sync.WaitGroup
	for index, fs := range filters {
		firstWG.Add(1)
		go func(index int, fs string) {
			defer firstWG.Done()
			firstPages[index].rows, firstPages[index].total, firstPages[index].err = s.fetchBoardListPage(ctx, fs, 1)
		}(index, fs)
	}
	firstWG.Wait()

	type pageSpec struct {
		fs   string
		page int
	}
	var firstErr error
	pages := make([]pageSpec, 0, maxBoardListPages*len(filters))
	for index, fs := range filters {
		first := firstPages[index]
		if first.err != nil {
			firstErr = first.err
			continue
		}
		for _, row := range first.rows {
			result[row.F12] = row
		}
		pageCount := (first.total + boardListPageSize - 1) / boardListPageSize
		for page := 2; page <= pageCount && page <= maxBoardListPages; page++ {
			pages = append(pages, pageSpec{fs: fs, page: page})
		}
	}
	if len(result) == 0 && len(pages) == 0 {
		if firstErr != nil {
			return nil, firstErr
		}
		return nil, fmt.Errorf("%w: board list empty", ErrSourceInvalid)
	}

	work := make(chan pageSpec)
	var wg sync.WaitGroup
	var mu sync.Mutex
	for worker := 0; worker < 6; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for spec := range work {
				rows, _, err := s.fetchBoardListPage(ctx, spec.fs, spec.page)
				if err != nil {
					continue
				}
				mu.Lock()
				for _, row := range rows {
					result[row.F12] = row
				}
				mu.Unlock()
			}
		}()
	}
	for _, spec := range pages {
		work <- spec
	}
	close(work)
	wg.Wait()
	return result, nil
}

func (s *Service) fetchBoardListPage(ctx context.Context, fs string, page int) ([]boardQuote, int, error) {
	query := url.Values{}
	query.Set("ut", "fa5fd1943c7b386f172d6893dbfba10b")
	query.Set("pn", strconv.Itoa(page))
	query.Set("pz", strconv.Itoa(boardListPageSize))
	query.Set("po", "1")
	query.Set("np", "1")
	query.Set("fltt", "2")
	query.Set("invt", "2")
	query.Set("fid", "f3")
	query.Set("fs", fs)
	query.Set("fields", "f2,f3,f6,f8,f10,f12,f14,f104,f105,f109,f110,f134")
	endpoint := strings.TrimRight(s.config.QuoteBaseURL, "/") + "/api/qt/clist/get?" + query.Encode()

	var response boardQuoteResponse
	if err := s.getJSON(ctx, endpoint, &response); err != nil {
		return nil, 0, err
	}
	if response.Rc != 0 || response.Data == nil {
		return nil, 0, fmt.Errorf("%w: board list rc=%d", ErrSourceInvalid, response.Rc)
	}
	return response.Data.Diff, response.Data.Total, nil
}

func (s *Service) enrichSeries(ctx context.Context, sectors []Sector) int {
	historyCtx, cancel := context.WithTimeout(ctx, historyEnrichTimeout)
	defer cancel()

	work := make(chan struct{}, historyWorkers)
	var wg sync.WaitGroup
	var enriched int
	var enrichedMu sync.Mutex
	for index := range sectors {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			work <- struct{}{}
			defer func() { <-work }()

			history, ok := s.cachedHistory(historyCtx, sectors[index].ID)
			if !ok || len(history.closes) < trendPoints {
				return
			}
			enrichedMu.Lock()
			enriched++
			enrichedMu.Unlock()
			sectors[index].Series = normalizedSeries(history.closes)
			sectors[index].Indicator.AverageAmount = history.amountTotal / float64(len(history.closes))
			sectors[index].Indicator.AverageTurnover = history.turnoverTotal / float64(len(history.closes))
			if history.latestAmount > 0 {
				sectors[index].Indicator.Amount = history.latestAmount
			}
			if history.latestTurnover > 0 {
				sectors[index].Indicator.Turnover = history.latestTurnover
			}
		}(index)
	}
	wg.Wait()
	return enriched
}

func (s *Service) refreshHistoryInBackground() {
	s.historyMu.Lock()
	if s.historyRunning || s.now().Before(s.historyDownUntil) {
		s.historyMu.Unlock()
		return
	}
	s.historyRunning = true
	s.historyMu.Unlock()

	go func() {
		defer func() {
			s.historyMu.Lock()
			s.historyRunning = false
			s.historyMu.Unlock()
		}()

		ctx, cancel := context.WithTimeout(context.Background(), historyEnrichTimeout)
		defer cancel()

		s.mu.Lock()
		sectors := cloneSnapshot(s.snapshot).Sectors
		startedAt := s.snapshot.FetchedAt
		s.mu.Unlock()
		enriched := s.enrichSeries(ctx, sectors)
		if enriched == 0 {
			s.historyMu.Lock()
			s.historyDownUntil = s.now().Add(5 * time.Minute)
			s.historyMu.Unlock()
		}

		s.mu.Lock()
		defer s.mu.Unlock()
		if !s.hasSnapshot || !s.snapshot.FetchedAt.Equal(startedAt) {
			return
		}
		byID := make(map[string]Sector, len(sectors))
		for _, sector := range sectors {
			byID[sector.ID] = sector
		}
		for index := range s.snapshot.Sectors {
			if sector, exists := byID[s.snapshot.Sectors[index].ID]; exists {
				s.snapshot.Sectors[index] = sector
			}
		}
	}()
}

func (s *Service) cachedHistory(ctx context.Context, boardID string) (historyCacheEntry, bool) {
	now := s.now()
	s.historyMu.Lock()
	entry, exists := s.historyCache[boardID]
	if exists && now.Sub(entry.fetchedAt) < historyCacheTTL {
		s.historyMu.Unlock()
		return entry, true
	}
	s.historyMu.Unlock()

	history, err := s.fetchHistory(ctx, boardID)
	if err != nil {
		s.historyMu.Lock()
		entry, exists = s.historyCache[boardID]
		s.historyMu.Unlock()
		if exists && len(entry.closes) >= trendPoints {
			return entry, true
		}
		return historyCacheEntry{}, false
	}
	parsed, ok := parseKlines(history.Data.Klines)
	if !ok || len(parsed.closes) < trendPoints {
		return historyCacheEntry{}, false
	}
	parsed.fetchedAt = now
	s.historyMu.Lock()
	s.historyCache[boardID] = parsed
	s.historyMu.Unlock()
	return parsed, true
}

func parseKlines(lines []string) (historyCacheEntry, bool) {
	var result historyCacheEntry
	for _, line := range lines {
		parts := strings.Split(line, ",")
		if len(parts) < 11 {
			return historyCacheEntry{}, false
		}
		closePrice, err := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
		if err != nil {
			return historyCacheEntry{}, false
		}
		result.closes = append(result.closes, closePrice)
		if amount, err := strconv.ParseFloat(strings.TrimSpace(parts[6]), 64); err == nil {
			result.amountTotal += amount
		}
		if turnover, err := strconv.ParseFloat(strings.TrimSpace(parts[10]), 64); err == nil {
			result.turnoverTotal += turnover
		}
	}
	if len(result.closes) == 0 {
		return historyCacheEntry{}, false
	}
	if amount, err := strconv.ParseFloat(strings.TrimSpace(strings.Split(lines[len(lines)-1], ",")[6]), 64); err == nil {
		result.latestAmount = amount
	}
	if turnover, err := strconv.ParseFloat(strings.TrimSpace(strings.Split(lines[len(lines)-1], ",")[10]), 64); err == nil {
		result.latestTurnover = turnover
	}
	return result, true
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
	query.Set("fields", "f3,f6,f12,f14,f21")

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

func (s *Service) fetchIndices(ctx context.Context) ([]Index, error) {
	secids := make([]string, 0, len(indexDefinitions))
	for _, definition := range indexDefinitions {
		secids = append(secids, definition.SecID)
	}

	query := url.Values{}
	query.Set("fltt", "2")
	query.Set("invt", "2")
	query.Set("secids", strings.Join(secids, ","))
	query.Set("fields", "f2,f3,f12,f14")
	endpoint := strings.TrimRight(s.config.QuoteBaseURL, "/") + "/api/qt/ulist.np/get?" + query.Encode()

	var response indexResponse
	if err := s.getJSON(ctx, endpoint, &response); err != nil {
		return nil, err
	}
	if response.Rc != 0 || response.Data == nil {
		return nil, fmt.Errorf("%w: index quote rc=%d", ErrSourceInvalid, response.Rc)
	}

	byCode := make(map[string]indexRow, len(response.Data.Diff))
	for _, row := range response.Data.Diff {
		if strings.TrimSpace(row.F12) != "" {
			byCode[row.F12] = row
		}
	}
	indices := make([]Index, 0, len(indexDefinitions))
	for _, definition := range indexDefinitions {
		row, exists := byCode[definition.Code]
		if !exists || row.F2 <= 0 {
			continue
		}
		indices = append(indices, Index{
			ID:     definition.ID,
			Name:   definition.Name,
			Code:   definition.Code,
			Close:  row.F2,
			Change: row.F3,
			Region: definition.Region,
		})
	}
	return indices, nil
}

func BoardKeywords(boardID string) []string {
	for _, board := range boardDefinitions {
		if board.ID == boardID {
			return append([]string(nil), board.Keywords...)
		}
	}
	return nil
}

func (s *Service) getJSON(ctx context.Context, endpoint string, target any) error {
	var lastErr error
	for attempt := 0; attempt <= requestRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(time.Duration(attempt) * 150 * time.Millisecond):
			case <-ctx.Done():
				return lastErr
			}
		}
		lastErr = s.getJSONAttempt(ctx, endpoint, target)
		if lastErr == nil {
			return nil
		}
		if !errors.Is(lastErr, ErrSourceUnavailable) || ctx.Err() != nil {
			return lastErr
		}
	}
	return lastErr
}

func (s *Service) getJSONAttempt(ctx context.Context, endpoint string, target any) error {
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

func buildSector(board boardDefinition, quote boardQuote) Sector {
	name := strings.TrimSpace(quote.F14)
	if name == "" {
		name = board.Name
	}
	coverage := int(quote.F134)
	if coverage <= 0 {
		coverage = int(quote.F104) + int(quote.F105)
	}
	return Sector{
		CategoryIDs: categoryIDs(board.Category),
		Changes: map[string]float64{
			"1d":  float64(quote.F3),
			"5d":  float64(quote.F109),
			"20d": float64(quote.F110),
		},
		Constituents: []Constituent{},
		ID:           board.ID,
		Indicator: Indicator{
			Advancing:       int(quote.F104),
			Amount:          float64(quote.F6),
			AverageAmount:   0,
			AverageTurnover: 0,
			Close:           float64(quote.F2),
			Coverage:        coverage,
			Declining:       int(quote.F105),
			Turnover:        float64(quote.F8),
		},
		Methodology: "东方财富公开板块行情 · 板块指数区间涨跌幅 · 成分按流通市值权重",
		Name:        name,
		Series:      []float64{},
		VolumeRatio: float64(quote.F10),
	}
}

func categoryIDs(category string) []string {
	return []string{"market", category}
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

func buildFullConstituents(rows []quoteRow) ([]Constituent, error) {
	valid := make([]quoteRow, 0, len(rows))
	for _, row := range rows {
		if strings.TrimSpace(row.F12) == "" || strings.TrimSpace(row.F14) == "" || row.F21 <= 0 {
			continue
		}
		valid = append(valid, row)
	}
	if len(valid) == 0 {
		return nil, fmt.Errorf("%w: no weighted constituents", ErrSourceInvalid)
	}

	sort.SliceStable(valid, func(left int, right int) bool {
		return valid[left].F21 > valid[right].F21
	})
	weights := normalizeWeights(valid)
	if len(weights) == 0 {
		return nil, fmt.Errorf("%w: cannot normalize constituents", ErrSourceInvalid)
	}
	constituents := make([]Constituent, 0, len(valid))
	for index, row := range valid {
		constituents = append(constituents, Constituent{
			Change: row.F3,
			Code:   row.F12,
			Name:   row.F14,
			Weight: weights[index],
			Amount: row.F6,
		})
	}
	return constituents, nil
}

func (s *Service) SectorDetail(ctx context.Context, boardID string) (SectorDetail, error) {
	board, exists := findBoardDefinition(boardID)
	if !exists {
		return SectorDetail{}, fmt.Errorf("%w: sector %s not found", ErrSourceInvalid, boardID)
	}
	snapshot, err := s.Snapshot(ctx, false)
	if err != nil {
		return SectorDetail{}, err
	}

	var base *Sector
	for index := range snapshot.Sectors {
		if snapshot.Sectors[index].ID == boardID {
			base = &snapshot.Sectors[index]
			break
		}
	}
	if base == nil {
		return SectorDetail{}, fmt.Errorf("%w: sector %s missing from snapshot", ErrSourceInvalid, boardID)
	}

	quotes, err := s.fetchQuotes(ctx, board.ID)
	if err != nil {
		return SectorDetail{}, err
	}
	constituents, err := buildFullConstituents(quotes)
	if err != nil {
		return SectorDetail{}, err
	}

	detail := SectorDetail{
		Sector:  *base,
		Related: relatedSectors(snapshot.Sectors, boardID, board.Category),
	}
	detail.Constituents = constituents
	return detail, nil
}

func findBoardDefinition(boardID string) (boardDefinition, bool) {
	for _, board := range boardDefinitions {
		if board.ID == boardID {
			return board, true
		}
	}
	return boardDefinition{}, false
}

func relatedSectors(sectors []Sector, sectorID string, category string) []RelatedSector {
	var base *Sector
	candidates := make([]Sector, 0, len(sectors))
	for index := range sectors {
		if sectors[index].ID == sectorID {
			base = &sectors[index]
			continue
		}
		if containsCategory(sectors[index].CategoryIDs, category) {
			candidates = append(candidates, sectors[index])
		}
	}
	if base == nil {
		return nil
	}

	related := make([]RelatedSector, 0, len(candidates))
	for _, candidate := range candidates {
		score := correlationScore(base.Series, candidate.Series)
		if score <= 0 {
			continue
		}
		related = append(related, RelatedSector{
			ID:    candidate.ID,
			Name:  candidate.Name,
			Score: math.Round(score*1000) / 10,
		})
	}
	sort.SliceStable(related, func(left int, right int) bool {
		if related[left].Score == related[right].Score {
			return related[left].ID < related[right].ID
		}
		return related[left].Score > related[right].Score
	})
	if len(related) > 3 {
		related = related[:3]
	}
	return related
}

func correlationScore(left []float64, right []float64) float64 {
	if len(left) != len(right) || len(left) < 2 {
		return 0
	}
	leftMean := mean(left)
	rightMean := mean(right)
	var covariance, leftVariance, rightVariance float64
	for index := range left {
		leftDelta := left[index] - leftMean
		rightDelta := right[index] - rightMean
		covariance += leftDelta * rightDelta
		leftVariance += leftDelta * leftDelta
		rightVariance += rightDelta * rightDelta
	}
	if leftVariance == 0 || rightVariance == 0 {
		return 0
	}
	return covariance / math.Sqrt(leftVariance*rightVariance)
}

func mean(values []float64) float64 {
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func buildSignals(sectors []Sector) []Signal {
	signals := make([]Signal, 0, len(sectors))
	descending := sortedSectorsByChange(sectors, "1d", false)
	ascending := sortedSectorsByChange(sectors, "1d", true)

	for index, sector := range descending {
		if index >= signalLeaderCount || sector.Changes["1d"] <= 0 {
			break
		}
		signals = append(signals, Signal{
			ID:          "sig-leader-" + sector.ID,
			Type:        "leader",
			Title:       "领涨",
			Description: fmt.Sprintf("%s 近1日%s，处于当前板块领涨位置", sector.Name, formatChange(sector.Changes["1d"])),
			SectorID:    sector.ID,
			Severity:    3,
		})
	}
	for index, sector := range ascending {
		if index >= signalLeaderCount || sector.Changes["1d"] >= 0 {
			break
		}
		signals = append(signals, Signal{
			ID:          "sig-laggard-" + sector.ID,
			Type:        "laggard",
			Title:       "领跌",
			Description: fmt.Sprintf("%s 近1日%s，处于当前板块领跌位置", sector.Name, formatChange(sector.Changes["1d"])),
			SectorID:    sector.ID,
			Severity:    3,
		})
	}
	for _, sector := range sectors {
		ratio := volumeRatio(sector)
		if ratio < volumeRatioThreshold {
			continue
		}
		signals = append(signals, Signal{
			ID:          "sig-volume-" + sector.ID,
			Type:        "volume",
			Title:       "放量",
			Description: fmt.Sprintf("%s 成交额或换手率较20日均值放大%.1f倍", sector.Name, ratio),
			SectorID:    sector.ID,
			Severity:    2,
		})
	}
	for _, sector := range sectors {
		if !hasReversal(sector) {
			continue
		}
		signals = append(signals, Signal{
			ID:          "sig-reversal-" + sector.ID,
			Type:        "reversal",
			Title:       "反转",
			Description: fmt.Sprintf("%s 5日与20日走势背离，两个周期幅度均超过%.1f%%", sector.Name, reversalThreshold),
			SectorID:    sector.ID,
			Severity:    2,
		})
	}
	for _, sector := range sectors {
		total := sector.Indicator.Advancing + sector.Indicator.Declining
		if total == 0 {
			continue
		}
		ratio := float64(sector.Indicator.Advancing) / float64(total)
		if ratio < breadthThreshold || sector.Changes["1d"] <= 0 {
			continue
		}
		signals = append(signals, Signal{
			ID:          "sig-breadth-" + sector.ID,
			Type:        "breadth",
			Title:       "扩散",
			Description: fmt.Sprintf("%s 上涨家数占比%.0f%%，板块当日上涨", sector.Name, ratio*100),
			SectorID:    sector.ID,
			Severity:    2,
		})
	}

	sort.SliceStable(signals, func(left int, right int) bool {
		if signals[left].Severity == signals[right].Severity {
			if signals[left].Type == signals[right].Type {
				return signals[left].SectorID < signals[right].SectorID
			}
			return signals[left].Type < signals[right].Type
		}
		return signals[left].Severity > signals[right].Severity
	})
	return signals
}

func sortedSectorsByChange(sectors []Sector, periodID string, ascending bool) []Sector {
	result := append([]Sector(nil), sectors...)
	sort.SliceStable(result, func(left int, right int) bool {
		leftChange := result[left].Changes[periodID]
		rightChange := result[right].Changes[periodID]
		if leftChange == rightChange {
			return result[left].ID < result[right].ID
		}
		if ascending {
			return leftChange < rightChange
		}
		return leftChange > rightChange
	})
	return result
}

func volumeRatio(sector Sector) float64 {
	if sector.VolumeRatio > 0 {
		return sector.VolumeRatio
	}
	amountRatio := 0.0
	turnoverRatio := 0.0
	if sector.Indicator.AverageAmount > 0 {
		amountRatio = sector.Indicator.Amount / sector.Indicator.AverageAmount
	}
	if sector.Indicator.AverageTurnover > 0 {
		turnoverRatio = sector.Indicator.Turnover / sector.Indicator.AverageTurnover
	}
	return math.Max(amountRatio, turnoverRatio)
}

func hasReversal(sector Sector) bool {
	fiveDay := sector.Changes["5d"]
	twentyDay := sector.Changes["20d"]
	return fiveDay*twentyDay < 0 && math.Abs(fiveDay) >= reversalThreshold && math.Abs(twentyDay) >= reversalThreshold
}

func formatChange(value float64) string {
	return fmt.Sprintf("%+.2f%%", value)
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
		if categoryID != "market" {
			return categoryID
		}
	}
	return "market"
}

func cloneSnapshot(snapshot Snapshot) Snapshot {
	cloned := snapshot
	cloned.Indices = append([]Index(nil), snapshot.Indices...)
	cloned.Signals = append([]Signal(nil), snapshot.Signals...)
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
