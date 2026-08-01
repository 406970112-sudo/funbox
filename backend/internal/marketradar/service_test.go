package marketradar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSnapshotBuildsRealBoardMetrics(t *testing.T) {
	upstream := newMarketRadarUpstream(t)
	service := NewService(testMarketRadarConfig(upstream.URL()))

	snapshot := waitForEnrichedSectors(t, service)
	if snapshot.Source != "eastmoney" || snapshot.Stale {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	if snapshot.Coverage.Requested != len(boardDefinitions) || snapshot.Coverage.Loaded != len(boardDefinitions) {
		t.Fatalf("coverage = %#v", snapshot.Coverage)
	}
	sector := snapshot.Sectors[0]
	if len(sector.Series) != trendPoints || sector.Series[0] != 100 {
		t.Fatalf("series = %#v", sector.Series)
	}
	if len(sector.Constituents) != 0 {
		t.Fatalf("constituents = %#v", sector.Constituents)
	}
	if len(snapshot.Sectors) != len(boardDefinitions) {
		t.Fatalf("sector count = %d", len(snapshot.Sectors))
	}
}

func TestSnapshotSucceedsWithoutKlineHistory(t *testing.T) {
	upstream := newMarketRadarUpstream(t)
	upstream.FailHistory()
	service := NewService(testMarketRadarConfig(upstream.URL()))

	snapshot, err := service.Snapshot(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Coverage.Loaded != len(boardDefinitions) {
		t.Fatalf("coverage = %#v", snapshot.Coverage)
	}
	for _, sector := range snapshot.Sectors {
		if len(sector.Series) != 0 {
			t.Fatalf("sector %s series = %#v", sector.ID, sector.Series)
		}
	}
}

func TestSnapshotCachesFreshDataAndServesStaleLastSuccess(t *testing.T) {
	upstream := newMarketRadarUpstream(t)
	service := NewService(testMarketRadarConfig(upstream.URL()))
	now := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }

	first, err := service.Snapshot(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	first = waitForEnrichedSectors(t, service)
	calls := upstream.Calls()
	second, err := service.Snapshot(context.Background(), false)
	if err != nil || second.Stale || upstream.Calls() != calls {
		t.Fatalf("second = %#v, err = %v, calls = %d", second, err, upstream.Calls())
	}

	now = now.Add(2 * time.Minute)
	upstream.Fail()
	stale, err := service.Snapshot(context.Background(), true)
	if err != nil || !stale.Stale || stale.FetchedAt != first.FetchedAt {
		t.Fatalf("stale = %#v, err = %v", stale, err)
	}
}

func TestSnapshotRequiresAIAndMetalsCoverage(t *testing.T) {
	upstream := newMarketRadarUpstream(t)
	upstream.InvalidateCategory("ai")
	_, err := NewService(testMarketRadarConfig(upstream.URL())).Snapshot(context.Background(), false)
	if !errors.Is(err, ErrInsufficientCoverage) {
		t.Fatalf("error = %v", err)
	}
}

func TestSnapshotIncludesIndicesAndSignals(t *testing.T) {
	upstream := newMarketRadarUpstream(t)
	service := NewService(testMarketRadarConfig(upstream.URL()))

	snapshot, err := service.Snapshot(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Indices) != len(indexDefinitions) {
		t.Fatalf("indices = %d, want %d", len(snapshot.Indices), len(indexDefinitions))
	}
	if len(snapshot.Signals) == 0 {
		t.Fatal("expected at least one market signal")
	}
}

func TestSectorDetailIncludesFullConstituentsAndRelated(t *testing.T) {
	upstream := newMarketRadarUpstream(t)
	service := NewService(testMarketRadarConfig(upstream.URL()))

	snapshot, err := service.Snapshot(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	snapshot = waitForEnrichedSectors(t, service)
	detail, err := service.SectorDetail(context.Background(), snapshot.Sectors[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Constituents) < 3 {
		t.Fatalf("full constituents = %d", len(detail.Constituents))
	}
	if len(detail.Related) != 3 {
		t.Fatalf("related sectors = %d", len(detail.Related))
	}
}

func TestSnapshotReturnsTypedErrorsWithoutCache(t *testing.T) {
	t.Run("unavailable", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "offline", http.StatusBadGateway)
		}))
		t.Cleanup(upstream.Close)
		_, err := NewService(testMarketRadarConfig(upstream.URL)).Snapshot(context.Background(), false)
		if !errors.Is(err, ErrSourceUnavailable) {
			t.Fatalf("error = %v", err)
		}
	})

	t.Run("invalid", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, `{"rc":0,"data":{"klines":["bad"],"name":"x"}}`)
		}))
		t.Cleanup(upstream.Close)
		_, err := NewService(testMarketRadarConfig(upstream.URL)).Snapshot(context.Background(), false)
		if !errors.Is(err, ErrSourceInvalid) && !errors.Is(err, ErrInsufficientCoverage) {
			t.Fatalf("error = %v", err)
		}
	})
}

type marketRadarUpstream struct {
	calls             atomic.Int32
	fail              atomic.Bool
	failHistory       atomic.Bool
	invalidCategories map[string]bool
	server            *httptest.Server
}

func newMarketRadarUpstream(t *testing.T) *marketRadarUpstream {
	t.Helper()
	upstream := &marketRadarUpstream{
		invalidCategories: make(map[string]bool),
	}
	upstream.server = httptest.NewServer(http.HandlerFunc(upstream.handle))
	t.Cleanup(upstream.server.Close)
	return upstream
}

func (u *marketRadarUpstream) URL() string {
	return u.server.URL
}

func (u *marketRadarUpstream) Calls() int32 {
	return u.calls.Load()
}

func (u *marketRadarUpstream) Fail() {
	u.fail.Store(true)
}

func (u *marketRadarUpstream) FailHistory() {
	u.failHistory.Store(true)
}

func (u *marketRadarUpstream) InvalidateCategory(category string) {
	u.invalidCategories[category] = true
}

func (u *marketRadarUpstream) handle(w http.ResponseWriter, r *http.Request) {
	u.calls.Add(1)
	query := r.URL.Query()
	switch r.URL.Path {
	case "/api/qt/stock/kline/get":
		boardID := strings.TrimPrefix(query.Get("secid"), "90.")
		if u.fail.Load() || u.failHistory.Load() || u.invalid(boardID) {
			_, _ = io.WriteString(w, `{"rc":1,"data":null}`)
			return
		}
		_, _ = io.WriteString(w, klineFixture(boardID))
	case "/api/qt/clist/get":
		fs := query.Get("fs")
		if strings.HasPrefix(fs, "m:90+t:2") || strings.HasPrefix(fs, "m:90+t:3") {
			if u.fail.Load() {
				_, _ = io.WriteString(w, `{"rc":1,"data":null}`)
				return
			}
			_, _ = io.WriteString(w, boardListFixture(u))
			return
		}
		boardID := boardIDFromFS(fs)
		if u.fail.Load() || u.invalid(boardID) {
			_, _ = io.WriteString(w, `{"rc":1,"data":null}`)
			return
		}
		_, _ = io.WriteString(w, quoteFixture)
	case "/api/qt/ulist.np/get":
		if u.fail.Load() {
			_, _ = io.WriteString(w, `{"rc":1,"data":null}`)
			return
		}
		_, _ = io.WriteString(w, indexFixture)
	default:
		http.NotFound(w, r)
	}
}

func (u *marketRadarUpstream) invalid(boardID string) bool {
	for _, board := range boardDefinitions {
		if board.ID == boardID && u.invalidCategories[board.Category] {
			return true
		}
	}
	return false
}

func boardIDFromFS(fs string) string {
	value := strings.TrimPrefix(fs, "b:")
	if index := strings.Index(value, "+f:"); index >= 0 {
		value = value[:index]
	}
	return value
}

type boardListFixtureRow struct {
	F2   float64 `json:"f2"`
	F3   float64 `json:"f3"`
	F6   float64 `json:"f6"`
	F8   float64 `json:"f8"`
	F10  float64 `json:"f10"`
	F12  string  `json:"f12"`
	F14  string  `json:"f14"`
	F104 int     `json:"f104"`
	F105 int     `json:"f105"`
	F109 float64 `json:"f109"`
	F110 float64 `json:"f110"`
	F134 int     `json:"f134"`
}

func boardListFixture(upstream *marketRadarUpstream) string {
	rows := make([]boardListFixtureRow, 0, len(boardDefinitions))
	for index, board := range boardDefinitions {
		if upstream.invalidCategories[board.Category] {
			continue
		}
		rows = append(rows, boardListFixtureRow{
			F2:   1000 + float64(index),
			F3:   float64(1 + index%6),
			F6:   100_000_000 + float64(index)*1_000_000,
			F8:   1.0 + float64(index%4),
			F10:  1.0 + float64(index%3)*0.5,
			F12:  board.ID,
			F14:  board.Name,
			F104: 12 + index%5,
			F105: 2 + index%3,
			F109: float64(3 + index%4),
			F110: float64(2 + index%3),
			F134: 16 + index%4,
		})
	}
	payload, _ := json.Marshal(map[string]any{
		"rc": 0,
		"data": map[string]any{
			"total": len(rows),
			"diff":  rows,
		},
	})
	return string(payload)
}

func klineFixture(boardID string) string {
	name := boardDefinitions[0].Name
	for _, board := range boardDefinitions {
		if board.ID == boardID {
			name = board.Name
			break
		}
	}
	lines := make([]string, 0, 22)
	for index := 0; index < 22; index++ {
		closePrice := 100 + index
		line := fmt.Sprintf(
			"2026-07-%02d,99,%.2f,%.2f,98,1000,123456789.00,1.50,1.00,1.00,2.00",
			index+1,
			float64(closePrice),
			float64(closePrice),
		)
		lines = append(lines, line)
	}
	return fmt.Sprintf(`{"rc":0,"data":{"code":"%s","market":90,"name":"%s","klines":[%s]}}`, boardID, name, `"`+strings.Join(lines, `","`)+`"`)
}

const quoteFixture = `{"rc":0,"data":{"total":3,"diff":[
	{"f3":2.0,"f12":"600001","f14":"样例甲","f21":1000},
	{"f3":-1.0,"f12":"600002","f14":"样例乙","f21":600},
	{"f3":0.5,"f12":"600003","f14":"样例丙","f21":400}
]}}`

const indexFixture = `{"rc":0,"data":{"diff":[
	{"f2":3832.26,"f3":0.72,"f12":"000001","f14":"上证指数"},
	{"f2":13578.93,"f3":2.21,"f12":"399001","f14":"深证成指"},
	{"f2":3343.96,"f3":3.06,"f12":"399006","f14":"创业板指"},
	{"f2":1635.96,"f3":2.99,"f12":"000688","f14":"科创50"},
	{"f2":4588.2,"f3":0.85,"f12":"000300","f14":"沪深300"},
	{"f2":7493.99,"f3":2.52,"f12":"000905","f14":"中证500"},
	{"f2":25884.43,"f3":0.1,"f12":"HSI","f14":"恒生指数"},
	{"f2":4829.22,"f3":0.53,"f12":"HSTECH","f14":"恒生科技"},
	{"f2":25373.85,"f3":1.0,"f12":"NDX","f14":"纳斯达克"},
	{"f2":7489.72,"f3":0.7,"f12":"SPX","f14":"标普500"},
	{"f2":52485.03,"f3":0.53,"f12":"DJIA","f14":"道琼斯"},
	{"f2":64362.02,"f3":4.03,"f12":"N225","f14":"日经225"}
]}}`

func testMarketRadarConfig(baseURL string) Config {
	return Config{
		CacheTTL:       time.Minute,
		HistoryBaseURL: baseURL,
		QuoteBaseURL:   baseURL,
		RequestTimeout: time.Second,
	}
}

func waitForEnrichedSectors(t *testing.T, service *Service) Snapshot {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for {
		snapshot, err := service.Snapshot(context.Background(), false)
		if err != nil {
			t.Fatal(err)
		}
		if len(snapshot.Sectors) > 0 && len(snapshot.Sectors[0].Series) == trendPoints {
			return snapshot
		}
		if time.Now().After(deadline) {
			t.Fatalf("history enrichment did not finish: series=%d", len(snapshot.Sectors[0].Series))
		}
		time.Sleep(10 * time.Millisecond)
	}
}
