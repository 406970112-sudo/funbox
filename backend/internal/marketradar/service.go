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
	constituentLimit     = 3
	quotePageSize        = 100
	maxQuotePages        = 8
	boardWorkers         = 6
	requestRetries       = 1
	minCategoryBoards    = 3
	volumeRatioThreshold = 1.5
	reversalThreshold    = 3.0
	breadthThreshold     = 0.7
	signalLeaderCount    = 5
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

func buildSector(board boardDefinition, history historyResponse, quotes []quoteRow) (Sector, error) {
	closes := make([]float64, 0, len(history.Data.Klines))
	latestAmount := 0.0
	latestTurnover := 0.0
	amountTotal := 0.0
	turnoverTotal := 0.0
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
		if amount, err := strconv.ParseFloat(strings.TrimSpace(parts[6]), 64); err == nil {
			amountTotal += amount
		}
		if turnover, err := strconv.ParseFloat(strings.TrimSpace(parts[10]), 64); err == nil {
			turnoverTotal += turnover
		}
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
		CategoryIDs:  categoryIDs(board.Category),
		Changes:      intervalReturns(closes),
		Constituents: constituents,
		ID:           board.ID,
		Indicator: Indicator{
			Advancing:       advancing,
			Amount:          latestAmount,
			AverageAmount:   amountTotal / float64(len(closes)),
			AverageTurnover: turnoverTotal / float64(len(closes)),
			Close:           closes[len(closes)-1],
			Coverage:        coverage,
			Declining:       declining,
			Turnover:        latestTurnover,
		},
		Methodology: "东方财富公开板块行情 · 日K收盘价区间收益 · 成分按流通市值权重",
		Name:        name,
		Series:      normalizedSeries(closes),
	}, nil
}

func categoryIDs(category string) []string {
	return []string{"market", category}
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
			Amount: row.F6,
		})
	}
	return constituents, advancing, declining, len(valid), nil
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
