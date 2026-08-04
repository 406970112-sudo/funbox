package stockalert

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAddWatchSavesRealAnalysisAndWatchItem(t *testing.T) {
	upstream := newStockAlertUpstream(t, 90, 30)
	store := openTestStore(t)
	service := NewService(testStockAlertConfig(upstream.URL()), store)
	service.now = func() time.Time { return fixedNow }

	item, err := service.AddWatch(context.Background(), "user-1", "贵州茅台")
	if err != nil {
		t.Fatal(err)
	}
	if item.SymbolCode != "600519" || item.Name != "贵州茅台" {
		t.Fatalf("item = %#v", item)
	}
	if item.Analysis == nil {
		t.Fatal("analysis missing")
	}
	if item.Analysis.Rule.BuyTrigger <= 0 || item.Analysis.Rule.SellTrigger < item.Analysis.Rule.BuyTrigger {
		t.Fatalf("rule = %#v", item.Analysis.Rule)
	}
	if item.SignalStatus == "" || item.LatestPrice <= 0 {
		t.Fatalf("item = %#v", item)
	}
}

func TestAddWatchRejectsInsufficientKlines(t *testing.T) {
	upstream := newStockAlertUpstream(t, 20, 30)
	store := openTestStore(t)
	service := NewService(testStockAlertConfig(upstream.URL()), store)
	service.now = func() time.Time { return fixedNow }

	_, err := service.AddWatch(context.Background(), "user-1", "600519")
	if !errors.Is(err, ErrInsufficientData) {
		t.Fatalf("error = %v", err)
	}
}

func TestAddWatchFallsBackToTencentWhenEastmoneyUnavailable(t *testing.T) {
	upstream := newStockAlertUpstream(t, 90, 30)
	upstream.FailAllEastmoney()
	store := openTestStore(t)
	service := NewService(testStockAlertConfig(upstream.URL()), store)
	service.now = func() time.Time { return fixedNow }

	item, err := service.AddWatch(context.Background(), "user-1", "600519")
	if err != nil {
		t.Fatal(err)
	}
	if item.SymbolCode != "600519" || item.Analysis == nil {
		t.Fatalf("item = %#v", item)
	}
	if item.LatestPrice <= 0 {
		t.Fatalf("quote fallback missing: %#v", item)
	}
}

func TestAddWatchReturnsTypedErrorsWithoutCache(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "offline", http.StatusBadGateway)
	}))
	t.Cleanup(upstream.Close)
	store := openTestStore(t)
	service := NewService(testStockAlertConfig(upstream.URL), store)

	_, err := service.AddWatch(context.Background(), "user-1", "600519")
	if !errors.Is(err, ErrSourceUnavailable) {
		t.Fatalf("error = %v", err)
	}
}

func TestNewServiceUsesSeparateProviderAndDeepSeekTimeouts(t *testing.T) {
	cfg := testStockAlertConfig("http://example.invalid")
	cfg.RequestTimeout = 50 * time.Millisecond
	cfg.DeepSeekRequestTimeout = 3 * time.Second

	service := NewService(cfg, nil)
	if service.provider.client.Timeout != cfg.RequestTimeout {
		t.Fatalf("provider timeout = %s, want %s", service.provider.client.Timeout, cfg.RequestTimeout)
	}
	if service.deepseek.client.Timeout != cfg.DeepSeekRequestTimeout {
		t.Fatalf("deepseek timeout = %s, want %s", service.deepseek.client.Timeout, cfg.DeepSeekRequestTimeout)
	}
}

func TestSettingsEncryptAndMaskSendKey(t *testing.T) {
	store := openTestStore(t)
	service := NewService(testStockAlertConfig("http://example.invalid"), store)

	settings, err := service.SaveSettings(context.Background(), "user-1", "SCT3889SECRETKEY", true)
	if err != nil {
		t.Fatal(err)
	}
	if !settings.SendKeyBound || strings.Contains(settings.SendKeyMasked, "SECRET") {
		t.Fatalf("settings = %#v", settings)
	}
	key, err := store.SendKey(context.Background(), "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if key != "SCT3889SECRETKEY" {
		t.Fatalf("key = %q", key)
	}
}

func TestEvaluateSignalConfirmsBuyWithVolume(t *testing.T) {
	item := WatchItem{
		Analysis: &Analysis{Rule: SignalRule{
			BuyTrigger:        100,
			BuyReferenceLow:   95,
			BuyReferenceHigh:  105,
			SellTrigger:       120,
			SellReferenceLow:  120,
			SellReferenceHigh: 130,
			StopLoss:          90,
		}},
	}
	features := Features{IntradayAboveAvg: true, VolumeRatio: 1.4, Latest5mChange: 0.3}
	quote := Quote{Price: 101}
	direction, strength, triggered := evaluateSignal(item, features, quote)
	if !triggered || direction != "buy" || strength != StrengthConfirmed {
		t.Fatalf("direction=%q strength=%q triggered=%v", direction, strength, triggered)
	}
}

func TestMonitorTickCreatesOneConfirmedEventPerDay(t *testing.T) {
	upstream := newStockAlertUpstream(t, 90, 30)
	store := openTestStore(t)
	service := NewService(testStockAlertConfig(upstream.URL()), store)
	service.now = func() time.Time { return fixedNow }

	item, err := service.AddWatch(context.Background(), "user-1", "贵州茅台")
	if err != nil {
		t.Fatal(err)
	}
	service.tick(context.Background())
	events, unread, err := service.Events(context.Background(), "user-1", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) == 0 || unread != len(events) {
		t.Fatalf("events = %#v unread = %d", events, unread)
	}
	if events[0].Direction != "buy" || events[0].SignalStrength != StrengthConfirmed {
		t.Fatalf("event = %#v", events[0])
	}
	if !strings.Contains(events[0].PushedMessage, "sendkey") {
		t.Fatalf("push message = %q", events[0].PushedMessage)
	}
	service.tick(context.Background())
	eventsAgain, _, err := service.Events(context.Background(), "user-1", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(eventsAgain) != 1 {
		t.Fatalf("duplicate events = %d", len(eventsAgain))
	}
	_ = item
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := OpenStore(":memory:", "test-secret")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func testStockAlertConfig(upstreamURL string) Config {
	return Config{
		MonitorInterval:        time.Minute,
		QuoteBaseURL:           upstreamURL,
		DelayedQuoteBaseURL:    upstreamURL,
		HistoryBaseURL:         upstreamURL,
		SearchBaseURL:          upstreamURL,
		TencentBaseURL:         upstreamURL,
		TencentQuoteBaseURL:    upstreamURL,
		RequestTimeout:         5 * time.Second,
		DeepSeekRequestTimeout: 5 * time.Second,
		MaxWatchPerUser:        10,
		AnalysisDailyLimit:     10,
		MinKlines:              60,
		QuoteMaxAge:            15 * time.Second,
		Enabled:                true,
		DeepSeekBaseURL:        upstreamURL,
		DeepSeekAPIKey:         "test-key",
		DeepSeekModel:          "deepseek-v4-flash",
	}
}

var fixedNow = time.Date(2026, 8, 5, 10, 0, 0, 0, time.FixedZone("CST", 8*3600))

type stockAlertUpstream struct {
	server                *httptest.Server
	klineCount            int
	intradayCount         int
	calls                 int
	mu                    sync.Mutex
	failEastmoneyKline    bool
	failEastmoneyIntraday bool
	failEastmoneyQuote    bool
}

func newStockAlertUpstream(t *testing.T, klineCount int, intradayCount int) *stockAlertUpstream {
	t.Helper()
	upstream := &stockAlertUpstream{klineCount: klineCount, intradayCount: intradayCount}
	upstream.server = httptest.NewServer(http.HandlerFunc(upstream.handle))
	t.Cleanup(upstream.server.Close)
	return upstream
}

func (u *stockAlertUpstream) URL() string {
	return u.server.URL
}

func (u *stockAlertUpstream) Calls() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.calls
}

func (u *stockAlertUpstream) FailAllEastmoney() {
	u.failEastmoneyKline = true
	u.failEastmoneyIntraday = true
	u.failEastmoneyQuote = true
}

func (u *stockAlertUpstream) handle(w http.ResponseWriter, r *http.Request) {
	u.mu.Lock()
	u.calls++
	u.mu.Unlock()
	switch {
	case strings.Contains(r.URL.Path, "/api/suggest/get"):
		writeUpstreamJSON(w, map[string]any{
			"QuotationCodeTable": map[string]any{
				"Data": []map[string]any{{
					"Code":    "600519",
					"Name":    "贵州茅台",
					"MktNum":  "1",
					"QuoteID": "1.600519",
				}},
			},
		})
	case strings.Contains(r.URL.Path, "/api/qt/stock/get"):
		if u.failEastmoneyQuote {
			http.Error(w, "offline", http.StatusBadGateway)
			return
		}
		writeUpstreamJSON(w, map[string]any{
			"rc": 0,
			"data": map[string]any{
				"f43":  101.0,
				"f44":  103.0,
				"f45":  98.0,
				"f46":  99.0,
				"f60":  100.0,
				"f170": 1.0,
			},
		})
	case strings.Contains(r.URL.Path, "/api/qt/stock/kline/get"):
		if u.failEastmoneyKline {
			http.Error(w, "offline", http.StatusBadGateway)
			return
		}
		klines := make([]string, 0, u.klineCount)
		for i := 0; i < u.klineCount; i++ {
			date := fmt.Sprintf("2026-%02d-%02d", (i/28)+4, (i%28)+1)
			closePrice := 95.0 + float64(i)*0.1
			volume := 1000
			if i == u.klineCount-1 {
				volume = 2000
			}
			klines = append(klines, fmt.Sprintf(
				"%s,%d,%.2f,%.2f,%.2f,%d,100000,0,0,0,0",
				date, i+1, closePrice, closePrice+1, closePrice-1, volume,
			))
		}
		writeUpstreamJSON(w, map[string]any{"rc": 0, "data": map[string]any{"klines": klines, "name": "贵州茅台"}})
	case strings.Contains(r.URL.Path, "/api/qt/stock/trends2/get"):
		if u.failEastmoneyIntraday {
			http.Error(w, "offline", http.StatusBadGateway)
			return
		}
		trends := make([]string, 0, u.intradayCount)
		for i := 0; i < u.intradayCount; i++ {
			minute := fmt.Sprintf("%02d:%02d", 9+(i/60), 30+(i%60))
			open := 100.0 + float64(i)*0.04
			price := 100.0 + float64(i)*0.05
			high := price + 0.05
			low := price - 0.05
			volume := float64(100 + i)
			amount := volume * price * 100
			avg := price - 0.2
			trends = append(trends, fmt.Sprintf(
				"2026-08-05 %s,%.2f,%.2f,%.2f,%.2f,%.0f,%.0f,%.2f",
				minute, open, price, high, low, volume, amount, avg,
			))
		}
		writeUpstreamJSON(w, map[string]any{"rc": 0, "data": map[string]any{"trends": trends, "prePrice": "100.00"}})
	case strings.Contains(r.URL.Path, "/appstock/app/fqkline/get"):
		rows := make([][]string, 0, u.klineCount)
		for i := 0; i < u.klineCount; i++ {
			closePrice := fmt.Sprintf("%.2f", 95.0+float64(i)*0.1)
			rows = append(rows, []string{
				fmt.Sprintf("2026-%02d-%02d", (i/28)+4, (i%28)+1),
				closePrice,
				closePrice,
				fmt.Sprintf("%.2f", 96.0+float64(i)*0.1),
				fmt.Sprintf("%.2f", 94.0+float64(i)*0.1),
				"1000",
			})
		}
		writeUpstreamJSON(w, map[string]any{
			"code": 0,
			"data": map[string]any{
				"sh600519": map[string]any{"qfqday": rows},
			},
		})
	case strings.Contains(r.URL.Path, "/appstock/app/minute/query"):
		entries := []string{"0930 100.00 100 10000", "0931 100.05 200 20000", "0932 100.10 300 30000"}
		writeUpstreamJSON(w, map[string]any{
			"code": 0,
			"data": map[string]any{
				"sh600519": map[string]any{
					"data": map[string]any{"date": "20260805", "data": entries},
				},
			},
		})
	case strings.HasPrefix(r.URL.Path, "/q="):
		fields := make([]string, 40)
		fields[0] = "1"
		fields[1] = "璐靛窞鑼呭彴"
		fields[2] = "600519"
		fields[3] = "100.00"
		fields[4] = "99.00"
		fields[5] = "99.50"
		fields[31] = "1.00"
		fields[32] = "1.01"
		fields[33] = "100.50"
		fields[34] = "99.00"
		w.Header().Set("Content-Type", "text/plain; charset=GBK")
		_, _ = fmt.Fprintf(w, "v_sh600519=\"%s\";", strings.Join(fields, "~"))
	case strings.Contains(r.URL.Path, "/chat/completions"):
		rule := map[string]any{
			"buySignal": map[string]any{
				"triggerPrice":  100.5,
				"conditions":    []string{"分时价站稳 100.50 上方", "分时价位于分时均价上方", "量比 >= 1.1"},
				"referenceZone": map[string]any{"low": 99.0, "high": 100.5},
			},
			"sellSignal": map[string]any{
				"triggerPrice":  108.0,
				"conditions":    []string{"分时价放量突破 108.00", "5 分钟涨速 >= 0.2%"},
				"referenceZone": map[string]any{"low": 108.0, "high": 112.0},
			},
			"stopLoss":         map[string]any{"triggerPrice": 94.0, "condition": "分时价跌破 94.00"},
			"validTradingDays": 5,
			"reasons":          []string{"现价贴近 MA20", "RSI14 处于中性区间"},
			"summary":          "今日等待站稳 100.50 后观察放量确认",
		}
		raw, _ := json.Marshal(rule)
		writeUpstreamJSON(w, map[string]any{
			"choices": []map[string]any{{
				"message": map[string]any{"content": string(raw)},
			}},
		})
	default:
		http.NotFound(w, r)
	}
}

func writeUpstreamJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}
