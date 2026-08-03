package stockalert

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	CacheTTL            time.Duration
	MonitorInterval     time.Duration
	IntradayRefresh     time.Duration
	QuoteBaseURL        string
	DelayedQuoteBaseURL string
	HistoryBaseURL      string
	SearchBaseURL       string
	TencentBaseURL      string
	TencentQuoteBaseURL string
	RequestTimeout      time.Duration
	MaxWatchPerUser     int
	AnalysisDailyLimit  int
	MinKlines           int
	QuoteMaxAge         time.Duration
	SendKey             string
	Secret              string
	Enabled             bool
	DeepSeekBaseURL     string
	DeepSeekAPIKey      string
	DeepSeekModel       string
}

type Provider struct {
	cfg    Config
	client *http.Client
}

const requestRetries = 1

func NewProvider(cfg Config) *Provider {
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 12 * time.Second
	}
	if cfg.QuoteBaseURL == "" {
		cfg.QuoteBaseURL = "https://push2.eastmoney.com"
	}
	if cfg.DelayedQuoteBaseURL == "" {
		cfg.DelayedQuoteBaseURL = "https://push2delay.eastmoney.com"
	}
	if cfg.HistoryBaseURL == "" {
		cfg.HistoryBaseURL = "https://push2his.eastmoney.com"
	}
	if cfg.SearchBaseURL == "" {
		cfg.SearchBaseURL = "https://searchapi.eastmoney.com"
	}
	if cfg.TencentBaseURL == "" {
		cfg.TencentBaseURL = "https://web.ifzq.gtimg.cn"
	}
	if cfg.TencentQuoteBaseURL == "" {
		cfg.TencentQuoteBaseURL = "https://qt.gtimg.cn"
	}
	return &Provider{
		cfg: cfg,
		client: &http.Client{
			Timeout: cfg.RequestTimeout,
			Transport: &http.Transport{
				ForceAttemptHTTP2: false,
				Proxy:             http.ProxyFromEnvironment,
				TLSNextProto:      map[string]func(string, *tls.Conn) http.RoundTripper{},
			},
		},
	}
}

type suggestItem struct {
	Code             string `json:"Code"`
	Name             string `json:"Name"`
	MktNum           string `json:"MktNum"`
	QuoteID          string `json:"QuoteID"`
	SecurityTypeName string `json:"SecurityTypeName"`
}

type suggestResponse struct {
	QuotationCodeTable struct {
		Data []suggestItem `json:"Data"`
	} `json:"QuotationCodeTable"`
}

func (p *Provider) SearchSymbols(ctx context.Context, query string) ([]Symbol, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("%w: empty query", ErrInvalidInput)
	}
	params := url.Values{}
	params.Set("input", query)
	params.Set("type", "14")
	params.Set("token", "D43BF722C8E33BDC906FB84D85E326E8")
	params.Set("count", "10")
	endpoint := strings.TrimRight(p.cfg.SearchBaseURL, "/") + "/api/suggest/get?" + params.Encode()

	var response suggestResponse
	if err := p.getJSON(ctx, endpoint, &response); err != nil {
		return nil, fmt.Errorf("search upstream: %w", err)
	}
	symbols := make([]Symbol, 0, len(response.QuotationCodeTable.Data))
	for _, item := range response.QuotationCodeTable.Data {
		symbol, ok := buildSymbol(item)
		if !ok {
			continue
		}
		symbols = append(symbols, symbol)
	}
	if len(symbols) == 0 {
		return nil, fmt.Errorf("%w: no symbol matched %q", ErrSourceInvalid, query)
	}
	return symbols, nil
}

func buildSymbol(item suggestItem) (Symbol, bool) {
	code := strings.TrimSpace(item.Code)
	mkt := strings.TrimSpace(item.MktNum)
	name := strings.TrimSpace(item.Name)
	if code == "" || name == "" || mkt == "" {
		return Symbol{}, false
	}
	secID := strings.TrimSpace(item.QuoteID)
	if !strings.Contains(secID, ".") {
		secID = mkt + "." + code
	}
	market, region := marketRegion(mkt, code)
	return Symbol{
		Code:   code,
		Name:   name,
		Market: market,
		SecID:  secID,
		Region: region,
	}, true
}

func marketRegion(mkt string, code string) (string, string) {
	switch mkt {
	case "1":
		return "SH", "A股"
	case "116":
		return "HK", "港股"
	case "105", "106", "107":
		return "US", "美股"
	case "0":
		if strings.HasPrefix(code, "4") || strings.HasPrefix(code, "8") || strings.HasPrefix(code, "92") {
			return "BJ", "A股"
		}
		return "SZ", "A股"
	default:
		return strings.ToUpper(mkt), "其他"
	}
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

type quoteResponse struct {
	Data *struct {
		F43  flexFloat `json:"f43"`
		F44  flexFloat `json:"f44"`
		F45  flexFloat `json:"f45"`
		F46  flexFloat `json:"f46"`
		F60  flexFloat `json:"f60"`
		F170 flexFloat `json:"f170"`
	} `json:"data"`
	Rc int `json:"rc"`
}

func (p *Provider) FetchQuote(ctx context.Context, secID string, delayed bool) (Quote, error) {
	baseURL := p.cfg.QuoteBaseURL
	if delayed {
		baseURL = p.cfg.DelayedQuoteBaseURL
	}
	params := url.Values{}
	params.Set("ut", "fa5fd1943c7b386f172d6893dbfba10b")
	params.Set("fltt", "2")
	params.Set("invt", "2")
	params.Set("secid", secID)
	params.Set("fields", "f43,f44,f45,f46,f60,f170")
	endpoint := strings.TrimRight(baseURL, "/") + "/api/qt/stock/get?" + params.Encode()

	var response quoteResponse
	if err := p.getJSON(ctx, endpoint, &response); err != nil {
		return Quote{}, fmt.Errorf("quote %s: %w", secID, err)
	}
	if response.Rc != 0 || response.Data == nil || response.Data.F43 <= 0 {
		return Quote{}, fmt.Errorf("%w: quote secid=%s rc=%d", ErrSourceInvalid, secID, response.Rc)
	}
	quote := Quote{
		Price:     float64(response.Data.F43),
		PrevClose: float64(response.Data.F60),
		Open:      float64(response.Data.F46),
		High:      float64(response.Data.F44),
		Low:       float64(response.Data.F45),
		ChangePct: float64(response.Data.F170),
		Delayed:   delayed,
		FetchedAt: time.Now(),
	}
	if quote.ChangePct == 0 && quote.PrevClose > 0 {
		quote.ChangePct = (quote.Price - quote.PrevClose) / quote.PrevClose * 100
	}
	return quote, nil
}

type klineResponse struct {
	Data *struct {
		Klines []string `json:"klines"`
		Name   string   `json:"name"`
	} `json:"data"`
	Rc int `json:"rc"`
}

func (p *Provider) FetchKlines(ctx context.Context, secID string) ([]Kline, error) {
	params := url.Values{}
	params.Set("secid", secID)
	params.Set("ut", "fa5fd1943c7b386f172d6893dbfba10b")
	params.Set("klt", "101")
	params.Set("fqt", "1")
	params.Set("lmt", "90")
	params.Set("end", "20500101")
	params.Set("fields1", "f1,f2,f3,f4,f5,f6")
	params.Set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61")
	endpoint := strings.TrimRight(p.cfg.HistoryBaseURL, "/") + "/api/qt/stock/kline/get?" + params.Encode()

	var response klineResponse
	if err := p.getJSON(ctx, endpoint, &response); err != nil {
		return nil, fmt.Errorf("kline %s: %w", secID, err)
	}
	if response.Rc != 0 || response.Data == nil || len(response.Data.Klines) == 0 {
		return nil, fmt.Errorf("%w: kline secid=%s rc=%d", ErrSourceInvalid, secID, response.Rc)
	}
	klines := make([]Kline, 0, len(response.Data.Klines))
	for _, line := range response.Data.Klines {
		parts := strings.Split(line, ",")
		if len(parts) < 11 {
			continue
		}
		kline := Kline{
			Date:   parts[0],
			Open:   parseFloat(parts[1]),
			Close:  parseFloat(parts[2]),
			High:   parseFloat(parts[3]),
			Low:    parseFloat(parts[4]),
			Volume: parseFloat(parts[5]),
			Amount: parseFloat(parts[6]),
		}
		if kline.Close > 0 {
			klines = append(klines, kline)
		}
	}
	if len(klines) == 0 {
		return nil, fmt.Errorf("%w: kline secid=%s empty", ErrSourceInvalid, secID)
	}
	return klines, nil
}

type intradayResponse struct {
	Data *struct {
		Trends   []string `json:"trends"`
		PrePrice string   `json:"prePrice"`
	} `json:"data"`
	Rc int `json:"rc"`
}

func (p *Provider) FetchIntraday(ctx context.Context, secID string) (IntradaySnapshot, error) {
	params := url.Values{}
	params.Set("secid", secID)
	params.Set("ut", "fa5fd1943c7b386f172d6893dbfba10b")
	params.Set("fields1", "f1,f2,f3,f7,f8")
	params.Set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58")
	params.Set("ndays", "1")
	params.Set("iscr", "0")
	endpoint := strings.TrimRight(p.cfg.HistoryBaseURL, "/") + "/api/qt/stock/trends2/get?" + params.Encode()

	var response intradayResponse
	if err := p.getJSON(ctx, endpoint, &response); err != nil {
		return IntradaySnapshot{}, fmt.Errorf("intraday %s: %w", secID, err)
	}
	if response.Rc != 0 || response.Data == nil || len(response.Data.Trends) == 0 {
		return IntradaySnapshot{}, fmt.Errorf("%w: intraday secid=%s rc=%d", ErrSourceInvalid, secID, response.Rc)
	}
	points := make([]IntradayPoint, 0, len(response.Data.Trends))
	date := ""
	for _, line := range response.Data.Trends {
		parts := strings.Split(line, ",")
		if len(parts) < 8 {
			continue
		}
		timePart := parts[0]
		price := parseFloat(parts[2])
		avg := parseFloat(parts[7])
		volume := parseFloat(parts[5])
		amount := parseFloat(parts[6])
		if price <= 0 {
			continue
		}
		if idx := strings.Index(timePart, " "); idx > 0 {
			date = timePart[:idx]
		}
		points = append(points, IntradayPoint{
			Time:     timePart,
			Price:    price,
			AvgPrice: avg,
			Volume:   volume,
			Amount:   amount,
		})
	}
	if len(points) == 0 {
		return IntradaySnapshot{}, fmt.Errorf("%w: intraday secid=%s empty", ErrSourceInvalid, secID)
	}
	return IntradaySnapshot{
		Date:      date,
		Points:    points,
		Latest:    points[len(points)-1],
		FetchedAt: time.Now(),
	}, nil
}

func (p *Provider) getJSON(ctx context.Context, endpoint string, target any) error {
	var lastErr error
	for attempt := 0; attempt <= requestRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(300 * time.Millisecond):
			}
		}
		err := p.requestJSON(ctx, endpoint, target)
		if err == nil {
			return nil
		}
		lastErr = err
		if !errors.Is(err, ErrSourceUnavailable) {
			return err
		}
	}
	return lastErr
}

func (p *Provider) requestJSON(ctx context.Context, endpoint string, target any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Referer", "https://quote.eastmoney.com/")
	request.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	response, err := p.client.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		return fmt.Errorf("%w: upstream status=%d", ErrSourceUnavailable, response.StatusCode)
	}
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("%w: %v", ErrSourceInvalid, err)
	}
	return nil
}

func parseFloat(raw string) float64 {
	value, _ := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return value
}
