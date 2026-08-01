package marketradar

import (
	"context"
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

	snapshot, err := service.Snapshot(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
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
	if totalWeight(sector.Constituents) != 100 {
		t.Fatalf("constituents = %#v", sector.Constituents)
	}
	if len(snapshot.Sectors) != len(boardDefinitions) {
		t.Fatalf("sector count = %d", len(snapshot.Sectors))
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

func (u *marketRadarUpstream) InvalidateCategory(category string) {
	u.invalidCategories[category] = true
}

func (u *marketRadarUpstream) handle(w http.ResponseWriter, r *http.Request) {
	u.calls.Add(1)
	query := r.URL.Query()
	switch r.URL.Path {
	case "/api/qt/stock/kline/get":
		boardID := strings.TrimPrefix(query.Get("secid"), "90.")
		if u.fail.Load() || u.invalid(boardID) {
			_, _ = io.WriteString(w, `{"rc":1,"data":null}`)
			return
		}
		_, _ = io.WriteString(w, klineFixture(boardID))
	case "/api/qt/clist/get":
		boardID := boardIDFromFS(query.Get("fs"))
		if u.fail.Load() || u.invalid(boardID) {
			_, _ = io.WriteString(w, `{"rc":1,"data":null}`)
			return
		}
		_, _ = io.WriteString(w, quoteFixture)
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

func testMarketRadarConfig(baseURL string) Config {
	return Config{
		CacheTTL:       time.Minute,
		HistoryBaseURL: baseURL,
		QuoteBaseURL:   baseURL,
		RequestTimeout: time.Second,
	}
}

func totalWeight(constituents []Constituent) float64 {
	total := 0.0
	for _, constituent := range constituents {
		total += constituent.Weight
	}
	return total
}
