package news

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxRSSBodyBytes = 4 << 20

var (
	htmlTagPattern  = regexp.MustCompile(`(?s)<[^>]*>`)
	imageSrcPattern = regexp.MustCompile(`(?i)<img[^>]+src=["']([^"']+)["']`)
)

type RSSSource struct {
	client     *http.Client
	feedURLs   []string
	maxPerFeed int
}

type rssDocument struct {
	Channel rssChannel `xml:"channel"`
}

type rssChannel struct {
	Title string    `xml:"title"`
	Items []rssItem `xml:"item"`
}

type rssItem struct {
	Title          string       `xml:"title"`
	Link           string       `xml:"link"`
	Description    string       `xml:"description"`
	ContentEncoded string       `xml:"http://purl.org/rss/1.0/modules/content/ encoded"`
	Published      string       `xml:"pubDate"`
	Date           string       `xml:"http://purl.org/dc/elements/1.1/ date"`
	Media          rssMedia     `xml:"http://search.yahoo.com/mrss/ content"`
	Enclosure      rssEnclosure `xml:"enclosure"`
}

type rssMedia struct {
	URL string `xml:"url,attr"`
}

type rssEnclosure struct {
	URL  string `xml:"url,attr"`
	Type string `xml:"type,attr"`
}

type feedResult struct {
	articles []Article
	err      error
}

func NewRSSSource(client *http.Client, feedURLs []string, maxPerFeed int) *RSSSource {
	if client == nil {
		client = &http.Client{Timeout: 12 * time.Second}
	}
	if maxPerFeed <= 0 {
		maxPerFeed = 20
	}
	return &RSSSource{
		client:     client,
		feedURLs:   append([]string(nil), feedURLs...),
		maxPerFeed: maxPerFeed,
	}
}

func (s *RSSSource) Fetch(ctx context.Context) ([]Article, error) {
	if len(s.feedURLs) == 0 {
		return nil, ErrSourcesUnavailable
	}

	results := make(chan feedResult, len(s.feedURLs))
	var wg sync.WaitGroup
	for _, feedURL := range s.feedURLs {
		feedURL := strings.TrimSpace(feedURL)
		if feedURL == "" {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			articles, err := s.fetchFeed(ctx, feedURL)
			results <- feedResult{articles: articles, err: err}
		}()
	}
	go func() {
		wg.Wait()
		close(results)
	}()

	var articles []Article
	successfulFeeds := 0
	for result := range results {
		if result.err != nil {
			continue
		}
		successfulFeeds++
		articles = append(articles, result.articles...)
	}
	if successfulFeeds == 0 {
		return nil, ErrSourcesUnavailable
	}
	sort.SliceStable(articles, func(i, j int) bool {
		return articles[i].PublishedAt.After(articles[j].PublishedAt)
	})
	return articles, nil
}

func (s *RSSSource) fetchFeed(ctx context.Context, feedURL string) ([]Article, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1")
	req.Header.Set("User-Agent", "FunBox-HotNews/1.0")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("rss source returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxRSSBodyBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxRSSBodyBytes {
		return nil, fmt.Errorf("rss body exceeds %d bytes", maxRSSBodyBytes)
	}

	var document rssDocument
	if err := xml.Unmarshal(body, &document); err != nil {
		return nil, err
	}
	sourceName := normalizeText(document.Channel.Title)
	if sourceName == "" {
		sourceName = sourceNameFromURL(feedURL)
	}

	limit := len(document.Channel.Items)
	if limit > s.maxPerFeed {
		limit = s.maxPerFeed
	}
	articles := make([]Article, 0, limit)
	for _, item := range document.Channel.Items[:limit] {
		articleURL := strings.TrimSpace(item.Link)
		title := normalizeText(item.Title)
		if title == "" || !isHTTPURL(articleURL) {
			continue
		}
		descriptionHTML := item.Description
		if strings.TrimSpace(item.ContentEncoded) != "" {
			descriptionHTML = item.ContentEncoded
		}
		imageURL := strings.TrimSpace(item.Media.URL)
		if imageURL == "" && strings.HasPrefix(strings.ToLower(item.Enclosure.Type), "image/") {
			imageURL = strings.TrimSpace(item.Enclosure.URL)
		}
		if imageURL == "" {
			imageURL = firstImageURL(descriptionHTML)
		}
		publishedAt := parseRSSDate(item.Published)
		if publishedAt.IsZero() {
			publishedAt = parseRSSDate(item.Date)
		}
		articles = append(articles, Article{
			ID:          stableHash(articleURL),
			Source:      sourceName,
			Title:       title,
			Description: normalizeText(descriptionHTML),
			URL:         articleURL,
			ImageURL:    imageURL,
			PublishedAt: publishedAt,
		})
	}
	return articles, nil
}

func normalizeText(value string) string {
	withoutTags := htmlTagPattern.ReplaceAllString(value, " ")
	return strings.Join(strings.Fields(html.UnescapeString(withoutTags)), " ")
}

func firstImageURL(value string) string {
	match := imageSrcPattern.FindStringSubmatch(value)
	if len(match) != 2 || !isHTTPURL(match[1]) {
		return ""
	}
	return html.UnescapeString(match[1])
}

func parseRSSDate(value string) time.Time {
	value = strings.TrimSpace(value)
	for _, layout := range []string{
		time.RFC1123Z,
		time.RFC1123,
		time.RFC822Z,
		time.RFC822,
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
	} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}

func sourceNameFromURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Hostname() == "" {
		return "未知来源"
	}
	return parsed.Hostname()
}

func isHTTPURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

func stableHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:12])
}
