package stockalert

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/text/encoding/simplifiedchinese"
)

type tencentMinuteResponse struct {
	Code int                          `json:"code"`
	Data map[string]tencentMinuteItem `json:"data"`
}

type tencentMinuteItem struct {
	Data tencentMinuteData `json:"data"`
}

type tencentMinuteData struct {
	Date string   `json:"date"`
	Data []string `json:"data"`
}

func (p *Provider) FetchKlinesTencent(ctx context.Context, code string, market string) ([]Kline, error) {
	tencentCode := tencentSymbol(code, market)
	if tencentCode == "" {
		return nil, fmt.Errorf("%w: no tencent fallback for market %s", ErrSourceInvalid, market)
	}
	params := url.Values{}
	params.Set("param", tencentCode+",day,,,90,qfq")
	endpoint := strings.TrimRight(p.cfg.TencentBaseURL, "/") + "/appstock/app/fqkline/get?" + params.Encode()

	var response struct {
		Code int `json:"code"`
		Data map[string]struct {
			QFQDay [][]string `json:"qfqday"`
			Day    [][]string `json:"day"`
		} `json:"data"`
	}
	if err := p.getJSON(ctx, endpoint, &response); err != nil {
		return nil, fmt.Errorf("tencent kline %s: %w", tencentCode, err)
	}
	rows := response.Data[tencentCode].QFQDay
	if len(rows) == 0 {
		rows = response.Data[tencentCode].Day
	}
	klines := make([]Kline, 0, len(rows))
	for _, row := range rows {
		if len(row) < 6 {
			continue
		}
		kline := Kline{
			Date:   row[0],
			Open:   parseFloat(row[1]),
			Close:  parseFloat(row[2]),
			High:   parseFloat(row[3]),
			Low:    parseFloat(row[4]),
			Volume: parseFloat(row[5]),
		}
		if len(row) > 6 {
			kline.Amount = parseFloat(row[6])
		}
		if kline.Close > 0 {
			klines = append(klines, kline)
		}
	}
	if len(klines) == 0 {
		return nil, fmt.Errorf("%w: tencent kline %s empty", ErrSourceInvalid, tencentCode)
	}
	return klines, nil
}

func (p *Provider) FetchIntradayTencent(ctx context.Context, code string, market string) (IntradaySnapshot, error) {
	tencentCode := tencentSymbol(code, market)
	if tencentCode == "" {
		return IntradaySnapshot{}, fmt.Errorf("%w: no tencent fallback for market %s", ErrSourceInvalid, market)
	}
	params := url.Values{}
	params.Set("code", tencentCode)
	endpoint := strings.TrimRight(p.cfg.TencentBaseURL, "/") + "/appstock/app/minute/query?" + params.Encode()

	var response tencentMinuteResponse
	if err := p.getJSON(ctx, endpoint, &response); err != nil {
		return IntradaySnapshot{}, fmt.Errorf("tencent intraday %s: %w", tencentCode, err)
	}
	payload := response.Data[tencentCode].Data
	points := make([]IntradayPoint, 0, len(payload.Data))
	var totalVolume, totalAmount float64
	for _, entry := range payload.Data {
		parts := strings.Fields(entry)
		if len(parts) < 3 {
			continue
		}
		price := parseFloat(parts[1])
		volume := parseFloat(parts[2])
		if price <= 0 {
			continue
		}
		timePart := parts[0]
		hour := timePart[:2]
		minute := timePart[2:]
		if len(hour) != 2 || len(minute) != 2 {
			continue
		}
		totalVolume += volume
		if len(parts) > 3 {
			totalAmount = parseFloat(parts[3])
		} else {
			totalAmount += price * volume
		}
		avg := 0.0
		if totalVolume > 0 {
			avg = totalAmount / totalVolume
		}
		points = append(points, IntradayPoint{
			Time:     payload.Date + " " + hour + ":" + minute,
			Price:    price,
			AvgPrice: avg,
			Volume:   volume,
			Amount:   totalAmount,
		})
	}
	if len(points) == 0 {
		return IntradaySnapshot{}, fmt.Errorf("%w: tencent intraday %s empty", ErrSourceInvalid, tencentCode)
	}
	return IntradaySnapshot{
		Date:      payload.Date,
		Points:    points,
		Latest:    points[len(points)-1],
		FetchedAt: time.Now(),
	}, nil
}

func (p *Provider) FetchQuoteTencent(ctx context.Context, code string, market string) (Quote, error) {
	tencentCode := tencentSymbol(code, market)
	if tencentCode == "" {
		return Quote{}, fmt.Errorf("%w: no tencent fallback for market %s", ErrSourceInvalid, market)
	}
	endpoint := strings.TrimRight(p.cfg.TencentQuoteBaseURL, "/") + "/q=" + tencentCode
	raw, err := p.getRaw(ctx, endpoint)
	if err != nil {
		return Quote{}, fmt.Errorf("tencent quote %s: %w", tencentCode, err)
	}
	decoded, err := simplifiedchinese.GBK.NewDecoder().Bytes(raw)
	if err != nil {
		return Quote{}, fmt.Errorf("tencent quote %s: %w", tencentCode, err)
	}
	text := string(decoded)
	start := strings.Index(text, `="`)
	if start < 0 {
		return Quote{}, fmt.Errorf("%w: tencent quote %s malformed", ErrSourceInvalid, tencentCode)
	}
	start += 2
	end := strings.Index(text[start:], `"`)
	if end < 0 {
		return Quote{}, fmt.Errorf("%w: tencent quote %s malformed", ErrSourceInvalid, tencentCode)
	}
	fields := strings.Split(text[start:start+end], "~")
	if len(fields) < 35 {
		return Quote{}, fmt.Errorf("%w: tencent quote %s too short", ErrSourceInvalid, tencentCode)
	}
	quote := Quote{
		Price:     parseFloat(fields[3]),
		PrevClose: parseFloat(fields[4]),
		Open:      parseFloat(fields[5]),
		High:      parseFloat(fields[33]),
		Low:       parseFloat(fields[34]),
		ChangePct: parseFloat(fields[32]),
		FetchedAt: time.Now(),
	}
	if quote.ChangePct == 0 && quote.PrevClose > 0 {
		quote.ChangePct = (quote.Price - quote.PrevClose) / quote.PrevClose * 100
	}
	return quote, nil
}

func (p *Provider) getRaw(ctx context.Context, endpoint string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Referer", "https://gu.qq.com/")
	request.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	response, err := p.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrSourceUnavailable, err)
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		return nil, fmt.Errorf("%w: upstream status=%d", ErrSourceUnavailable, response.StatusCode)
	}
	return io.ReadAll(response.Body)
}

func tencentSymbol(code string, market string) string {
	switch strings.ToUpper(market) {
	case "SH":
		return "sh" + code
	case "SZ":
		return "sz" + code
	case "BJ":
		return "bj" + code
	case "HK":
		return "hk" + code
	default:
		return ""
	}
}
