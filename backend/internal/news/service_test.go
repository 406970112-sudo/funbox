package news

import (
	"context"
	"errors"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/config"
)

type sequentialSource struct {
	results []sourceResult
	calls   int
}

type sourceResult struct {
	articles []Article
	err      error
}

func (s *sequentialSource) Fetch(context.Context) ([]Article, error) {
	index := s.calls
	s.calls++
	if index >= len(s.results) {
		index = len(s.results) - 1
	}
	return append([]Article(nil), s.results[index].articles...), s.results[index].err
}

type countingSummarizer struct {
	calls int
}

type blockingSummarizer struct {
	started chan struct{}
	release chan struct{}
	done    chan struct{}
}

func (s *countingSummarizer) Summarize(_ context.Context, event Event) (Summary, error) {
	s.calls++
	return Summary{
		OneSentence: "AI 生成摘要：" + event.Title,
		KeyPoints:   []KeyPoint{{Text: "关键事实", SourceIDs: []string{"S1"}}},
		Status:      "generated",
		Model:       "shared-model",
	}, nil
}

func (s *blockingSummarizer) Summarize(ctx context.Context, event Event) (Summary, error) {
	close(s.started)
	select {
	case <-ctx.Done():
		close(s.done)
		return Summary{}, ctx.Err()
	case <-s.release:
		close(s.done)
		return Summary{
			OneSentence: "AI 生成摘要：" + event.Title,
			KeyPoints:   []KeyPoint{{Text: "关键事实", SourceIDs: []string{"S1"}}},
			Status:      "generated",
			Model:       "shared-model",
		}, nil
	}
}

func TestServicePublishesFallbackBeforeSlowSummary(t *testing.T) {
	now := time.Now().UTC()
	source := &sequentialSource{results: []sourceResult{{articles: []Article{{
		Source:      "测试来源",
		Title:       "先展示新闻，再生成摘要",
		Description: "首屏不能等待模型响应。",
		URL:         "https://example.com/fast-feed",
		PublishedAt: now,
	}}}}}
	summarizer := &blockingSummarizer{
		started: make(chan struct{}),
		release: make(chan struct{}),
		done:    make(chan struct{}),
	}
	service := NewService(config.NewsConfig{
		Lookback:        48 * time.Hour,
		MaxEvents:       20,
		SummaryLimit:    1,
		RefreshInterval: 15 * time.Minute,
	}, source, summarizer)

	type feedResult struct {
		snapshot FeedSnapshot
		err      error
	}
	result := make(chan feedResult, 1)
	go func() {
		snapshot, err := service.Feed(context.Background())
		result <- feedResult{snapshot: snapshot, err: err}
	}()

	select {
	case got := <-result:
		if got.err != nil {
			t.Fatalf("Feed: %v", got.err)
		}
		if len(got.snapshot.Events) != 1 || got.snapshot.Events[0].Summary.Status != "fallback" {
			t.Fatalf("initial snapshot = %#v", got.snapshot)
		}
	case <-time.After(250 * time.Millisecond):
		close(summarizer.release)
		<-result
		t.Fatal("Feed waited for the slow summarizer instead of returning the fallback snapshot")
	}

	<-summarizer.started
	close(summarizer.release)
	<-summarizer.done
}

func TestServiceCachesSummariesByContentHash(t *testing.T) {
	now := time.Now().UTC()
	articles := []Article{{
		Source:      "测试来源",
		Title:       "DeepSeek 发布新模型",
		Description: "新模型在推理和编码方面有所提升。",
		URL:         "https://example.com/deepseek",
		PublishedAt: now.Add(-time.Minute),
	}}
	source := &sequentialSource{results: []sourceResult{{articles: articles}, {articles: articles}}}
	summarizer := &countingSummarizer{}
	service := NewService(config.NewsConfig{
		Lookback:        48 * time.Hour,
		MaxEvents:       20,
		SummaryLimit:    8,
		RefreshInterval: 15 * time.Minute,
	}, source, summarizer)

	if err := service.Refresh(context.Background()); err != nil {
		t.Fatalf("first Refresh: %v", err)
	}
	if err := service.Refresh(context.Background()); err != nil {
		t.Fatalf("second Refresh: %v", err)
	}
	snapshot, err := service.Feed(context.Background())
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if summarizer.calls != 1 {
		t.Fatalf("summarizer calls = %d, want one call for unchanged content", summarizer.calls)
	}
	if len(snapshot.Events) != 1 || snapshot.Events[0].Summary.Status != "generated" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	if snapshot.DailyBrief.EventCount != 1 || len(snapshot.DailyBrief.KeyPoints) != 1 {
		t.Fatalf("daily brief = %#v", snapshot.DailyBrief)
	}
}

func TestServiceKeepsStaleSnapshotWhenRefreshFails(t *testing.T) {
	now := time.Now().UTC()
	source := &sequentialSource{results: []sourceResult{
		{articles: []Article{{
			Source:      "测试来源",
			Title:       "已缓存新闻",
			Description: "可用快照",
			URL:         "https://example.com/cached",
			PublishedAt: now,
		}}},
		{err: ErrSourcesUnavailable},
	}}
	service := NewService(config.NewsConfig{
		Lookback:        48 * time.Hour,
		MaxEvents:       20,
		SummaryLimit:    8,
		RefreshInterval: 15 * time.Minute,
	}, source, nil)

	if err := service.Refresh(context.Background()); err != nil {
		t.Fatalf("first Refresh: %v", err)
	}
	if err := service.Refresh(context.Background()); err != nil {
		t.Fatalf("Refresh with a cached snapshot should degrade gracefully: %v", err)
	}
	snapshot, err := service.Feed(context.Background())
	if err != nil {
		t.Fatalf("Feed: %v", err)
	}
	if !snapshot.Stale || len(snapshot.Events) != 1 || snapshot.Events[0].Title != "已缓存新闻" {
		t.Fatalf("stale snapshot = %#v", snapshot)
	}
}

func TestServiceReturnsSourceErrorWithoutCachedSnapshot(t *testing.T) {
	service := NewService(config.NewsConfig{
		Lookback:        48 * time.Hour,
		MaxEvents:       20,
		SummaryLimit:    8,
		RefreshInterval: 15 * time.Minute,
	}, &sequentialSource{results: []sourceResult{{err: ErrSourcesUnavailable}}}, nil)

	_, err := service.Feed(context.Background())
	if !errors.Is(err, ErrSourcesUnavailable) {
		t.Fatalf("err = %v, want ErrSourcesUnavailable", err)
	}
}

var _ Source = (*sequentialSource)(nil)
var _ Summarizer = (*countingSummarizer)(nil)
