package lottery

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/config"
)

func TestServiceHistoryParsesValidDrawsNewestFirst(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Referer"); got != "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/" {
			t.Fatalf("Referer = %q", got)
		}
		if got := r.Header.Get("User-Agent"); got != "FunBox/1.0" {
			t.Fatalf("User-Agent = %q", got)
		}
		_, _ = io.WriteString(w, `{"state":0,"message":"查询成功","result":[
			{"code":"2026001","date":"2026-01-02(四)","red":"01,02,03,04,05,06","blue":"07"},
			{"code":"2026002","date":"2026-01-04(日)","red":"02,03,04,05,06,07","blue":"08"},
			{"code":"2026002","date":"2026-01-04(日)","red":"02,03,04,05,06,07","blue":"08"}
		]}`)
	}))
	t.Cleanup(upstream.Close)

	service := NewService(testConfig(upstream.URL, 2))
	snapshot, err := service.History(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Draws) != 2 {
		t.Fatalf("draw count = %d", len(snapshot.Draws))
	}
	if got := snapshot.Draws[0].Issue; got != "2026002" {
		t.Fatalf("issue = %s", got)
	}
	if got := snapshot.Draws[0].Date; got != "2026-01-04" {
		t.Fatalf("date = %s", got)
	}
	if snapshot.AnalysisWindowMax != 300 || snapshot.Source != "cwl" || snapshot.Stale {
		t.Fatalf("unexpected snapshot metadata: %#v", snapshot)
	}
}

func TestValidateDrawRejectsDuplicateAndOutOfRangeBalls(t *testing.T) {
	tests := []Draw{
		{Issue: "2026001", Date: "2026-01-02", Red: []int{1, 2, 3, 4, 5, 5}, Blue: 7},
		{Issue: "2026001", Date: "2026-01-02", Red: []int{1, 2, 3, 4, 5, 34}, Blue: 7},
		{Issue: "2026001", Date: "2026-01-02", Red: []int{1, 2, 3, 4, 5, 6}, Blue: 17},
	}
	for _, draw := range tests {
		if err := ValidateDraw(draw); !errors.Is(err, ErrSourceInvalid) {
			t.Fatalf("ValidateDraw(%#v) = %v", draw, err)
		}
	}
}

func TestServiceHistoryUsesFreshCacheAndFallsBackToStaleCache(t *testing.T) {
	var calls atomic.Int32
	var fail atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		if fail.Load() {
			http.Error(w, "offline", http.StatusBadGateway)
			return
		}
		_, _ = io.WriteString(w, validHistoryJSON)
	}))
	t.Cleanup(upstream.Close)

	now := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
	service := NewService(testConfig(upstream.URL, 2))
	service.now = func() time.Time { return now }

	first, err := service.History(context.Background())
	if err != nil || first.Stale {
		t.Fatalf("first = %#v, %v", first, err)
	}
	second, err := service.History(context.Background())
	if err != nil || second.Stale || calls.Load() != 1 {
		t.Fatalf("second = %#v, calls = %d, err = %v", second, calls.Load(), err)
	}

	now = now.Add(2 * time.Minute)
	fail.Store(true)
	stale, err := service.History(context.Background())
	if err != nil || !stale.Stale || calls.Load() != 2 {
		t.Fatalf("stale = %#v, calls = %d, err = %v", stale, calls.Load(), err)
	}
}

func TestServiceHistoryReturnsTypedErrorsWithoutCache(t *testing.T) {
	t.Run("unavailable", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "offline", http.StatusBadGateway)
		}))
		t.Cleanup(upstream.Close)
		_, err := NewService(testConfig(upstream.URL, 2)).History(context.Background())
		if !errors.Is(err, ErrSourceUnavailable) {
			t.Fatalf("error = %v", err)
		}
	})

	t.Run("invalid", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, `{"state":0,"result":[{"code":"2026001","date":"2026-01-02(四)","red":"01,02,03,04,05,05","blue":"07"}]}`)
		}))
		t.Cleanup(upstream.Close)
		_, err := NewService(testConfig(upstream.URL, 1)).History(context.Background())
		if !errors.Is(err, ErrSourceInvalid) {
			t.Fatalf("error = %v", err)
		}
	})
}

func testConfig(sourceURL string, minimumDraws int) config.LotteryConfig {
	return config.LotteryConfig{
		CacheTTL:       time.Minute,
		FetchCount:     2,
		MinimumDraws:   minimumDraws,
		Referer:        "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/",
		RequestTimeout: time.Second,
		SourceURL:      sourceURL,
	}
}

const validHistoryJSON = `{"state":0,"message":"查询成功","result":[
	{"code":"2026001","date":"2026-01-02(四)","red":"01,02,03,04,05,06","blue":"07"},
	{"code":"2026002","date":"2026-01-04(日)","red":"02,03,04,05,06,07","blue":"08"}
]}`
