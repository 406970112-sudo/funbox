package news

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRSSSourceFetchesPartialFeedsAndNormalizesArticles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>测试来源</title>
    <item>
      <title>  DeepSeek 发布新模型  </title>
      <link>https://example.com/deepseek-model</link>
      <description><![CDATA[<p>第一段 <strong>详情</strong></p>]]></description>
      <pubDate>Thu, 31 Jul 2026 09:00:00 +0800</pubDate>
      <media:content url="https://example.com/cover.jpg" medium="image" />
    </item>
  </channel>
</rss>`))
		case "/fail":
			http.Error(w, "temporary failure", http.StatusBadGateway)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	source := NewRSSSource(server.Client(), []string{server.URL + "/ok", server.URL + "/fail"}, 20)
	articles, err := source.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch returned an error despite one healthy feed: %v", err)
	}
	if len(articles) != 1 {
		t.Fatalf("got %d articles, want 1: %#v", len(articles), articles)
	}

	article := articles[0]
	if article.Source != "测试来源" {
		t.Fatalf("Source = %q, want 测试来源", article.Source)
	}
	if article.Title != "DeepSeek 发布新模型" {
		t.Fatalf("Title = %q, want normalized title", article.Title)
	}
	if article.Description != "第一段 详情" {
		t.Fatalf("Description = %q, want HTML-free text", article.Description)
	}
	if article.ImageURL != "https://example.com/cover.jpg" {
		t.Fatalf("ImageURL = %q, want media image", article.ImageURL)
	}
	wantPublished := time.Date(2026, time.July, 31, 1, 0, 0, 0, time.UTC)
	if !article.PublishedAt.Equal(wantPublished) {
		t.Fatalf("PublishedAt = %s, want %s", article.PublishedAt, wantPublished)
	}
}

func TestRSSSourceReturnsUnavailableWhenEveryFeedFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	source := NewRSSSource(server.Client(), []string{server.URL + "/one", server.URL + "/two"}, 20)
	articles, err := source.Fetch(context.Background())
	if err != ErrSourcesUnavailable {
		t.Fatalf("err = %v, want ErrSourcesUnavailable", err)
	}
	if len(articles) != 0 {
		t.Fatalf("articles = %#v, want none", articles)
	}
}
