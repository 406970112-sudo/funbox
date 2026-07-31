package news

import (
	"testing"
	"time"
)

func TestBuildEventsDeduplicatesURLsAndClustersSimilarTitles(t *testing.T) {
	now := time.Date(2026, time.July, 31, 10, 0, 0, 0, time.UTC)
	articles := []Article{
		{
			Source:      "36氪",
			Title:       "DeepSeek 发布新一代模型 性能大幅提升",
			Description: "DeepSeek 今日发布新一代模型，推理和编码性能均有提升。",
			URL:         "https://36kr.com/p/1",
			ImageURL:    "https://36kr.com/cover.jpg",
			PublishedAt: now.Add(-10 * time.Minute),
		},
		{
			Source:      "重复抓取",
			Title:       "重复文章不应增加来源数",
			Description: "相同 URL 的重复数据。",
			URL:         "https://36kr.com/p/1",
			PublishedAt: now.Add(-5 * time.Minute),
		},
		{
			Source:      "爱范儿",
			Title:       "DeepSeek 发布新模型，性能显著提升",
			Description: "新模型在多个公开评测中取得更高分数。",
			URL:         "https://www.ifanr.com/2",
			PublishedAt: now.Add(-20 * time.Minute),
		},
		{
			Source:      "BBC 中文",
			Title:       "国际油价本周小幅回落",
			Description: "市场关注主要产油国的最新政策。",
			URL:         "https://www.bbc.com/zhongwen/3",
			PublishedAt: now.Add(-30 * time.Minute),
		},
	}

	events := BuildEvents(articles, now, 20)
	if len(events) != 2 {
		t.Fatalf("got %d events, want 2: %#v", len(events), events)
	}
	if events[0].SourceCount != 2 {
		t.Fatalf("first SourceCount = %d, want 2", events[0].SourceCount)
	}
	if events[0].Category != CategoryAI {
		t.Fatalf("first Category = %q, want %q", events[0].Category, CategoryAI)
	}
	if events[0].HotScore <= events[1].HotScore {
		t.Fatalf("multi-source HotScore = %d, want greater than %d", events[0].HotScore, events[1].HotScore)
	}
	for _, event := range events {
		if event.HotScore < 0 || event.HotScore > 100 {
			t.Fatalf("HotScore = %d, want 0..100", event.HotScore)
		}
		if event.ID == "" || event.ContentHash == "" {
			t.Fatalf("event identifiers must be stable: %#v", event)
		}
	}
	if got := []string{events[0].Sources[0].ID, events[0].Sources[1].ID}; got[0] != "S1" || got[1] != "S2" {
		t.Fatalf("source ids = %#v, want [S1 S2]", got)
	}
}

func TestBuildEventsHonorsMaximumEventCount(t *testing.T) {
	now := time.Date(2026, time.July, 31, 10, 0, 0, 0, time.UTC)
	articles := []Article{
		{Source: "A", Title: "科技公司发布季度财报", URL: "https://example.com/a", PublishedAt: now},
		{Source: "B", Title: "国际赛事公布完整赛程", URL: "https://example.com/b", PublishedAt: now.Add(-time.Minute)},
	}

	events := BuildEvents(articles, now, 1)
	if len(events) != 1 {
		t.Fatalf("got %d events, want maximum 1", len(events))
	}
}
