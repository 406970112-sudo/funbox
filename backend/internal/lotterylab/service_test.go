package lotterylab

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

func TestServiceHistoryParsesDrawsAndFloatingPrizes(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("issueCount"); got != "100" {
			t.Fatalf("issueCount = %q", got)
		}
		_, _ = io.WriteString(w, historyJSON(100))
	}))
	t.Cleanup(upstream.Close)

	service := NewService(testConfig(upstream.URL))
	snapshot, err := service.History(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Draws) != 100 {
		t.Fatalf("draw count = %d", len(snapshot.Draws))
	}
	if snapshot.Count != 100 || snapshot.Source != "cwl" || snapshot.Stale {
		t.Fatalf("unexpected snapshot metadata: %#v", snapshot)
	}
	latest := snapshot.Draws[0]
	if latest.Issue != "2026099" {
		t.Fatalf("latest issue = %s", latest.Issue)
	}
	if latest.FirstPrize <= 0 || latest.SecondPrize <= 0 {
		t.Fatalf("missing floating prizes: %#v", latest)
	}
}

func TestServiceHistoryUsesCacheAndReturnsStaleSnapshot(t *testing.T) {
	var calls atomic.Int32
	var fail atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		if fail.Load() {
			http.Error(w, "offline", http.StatusBadGateway)
			return
		}
		_, _ = io.WriteString(w, historyJSON(100))
	}))
	t.Cleanup(upstream.Close)

	now := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
	service := NewService(testConfig(upstream.URL))
	service.now = func() time.Time { return now }

	first, err := service.History(context.Background(), 100)
	if err != nil || first.Stale {
		t.Fatalf("first = %#v, %v", first, err)
	}
	second, err := service.History(context.Background(), 100)
	if err != nil || second.Stale || calls.Load() != 1 {
		t.Fatalf("second = %#v, calls = %d, err = %v", second, calls.Load(), err)
	}

	now = now.Add(2 * time.Minute)
	fail.Store(true)
	stale, err := service.History(context.Background(), 100)
	if err != nil || !stale.Stale || calls.Load() != 2 {
		t.Fatalf("stale = %#v, calls = %d, err = %v", stale, calls.Load(), err)
	}
}

func TestServiceHistoryReturnsTypedErrors(t *testing.T) {
	t.Run("unavailable", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "offline", http.StatusBadGateway)
		}))
		t.Cleanup(upstream.Close)
		_, err := NewService(testConfig(upstream.URL)).History(context.Background(), 100)
		if !errors.Is(err, ErrSourceUnavailable) {
			t.Fatalf("error = %v", err)
		}
	})

	t.Run("invalid", func(t *testing.T) {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = io.WriteString(w, historyJSON(99))
		}))
		t.Cleanup(upstream.Close)
		_, err := NewService(testConfig(upstream.URL)).History(context.Background(), 100)
		if !errors.Is(err, ErrSourceInvalid) {
			t.Fatalf("error = %v", err)
		}
	})
}

func testConfig(sourceURL string) Config {
	return Config{
		CacheTTL:          time.Minute,
		DefaultFetchCount: 100,
		MaxFetchCount:     1000,
		Referer:           "https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/",
		RequestTimeout:    time.Second,
		SourceURL:         sourceURL,
	}
}

func historyJSON(count int) string {
	var builder strings.Builder
	builder.WriteString(`{"state":0,"result":[`)
	for index := 0; index < count; index++ {
		if index > 0 {
			builder.WriteString(",")
		}
		start := 1 + (index*7)%28
		red := fmt.Sprintf("%02d,%02d,%02d,%02d,%02d,%02d", start, start+1, start+2, start+3, start+4, start+5)
		issue := 2026000 + index
		day := (index % 28) + 1
		blue := (index % 16) + 1
		fmt.Fprintf(
			&builder,
			`{"code":"%d","date":"2026-01-%02d(周)","red":"%s","blue":"%02d","prizegrades":[{"type":1,"typemoney":"%d"},{"type":2,"typemoney":"%d"}]}`,
			issue,
			day,
			red,
			blue,
			7000000+index*1000,
			200000+index*100,
		)
	}
	builder.WriteString(`]}`)
	return builder.String()
}
