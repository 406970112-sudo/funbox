package news

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
)

const titleSimilarityThreshold = 0.25

var asciiWordPattern = regexp.MustCompile(`[a-z0-9]+`)

func BuildEvents(articles []Article, now time.Time, maxEvents int) []Event {
	if maxEvents <= 0 || len(articles) == 0 {
		return []Event{}
	}

	unique := deduplicateArticles(articles)
	sort.SliceStable(unique, func(i, j int) bool {
		return unique[i].PublishedAt.After(unique[j].PublishedAt)
	})

	clusters := make([][]Article, 0, len(unique))
	for _, article := range unique {
		matched := -1
		for i, cluster := range clusters {
			if belongsToCluster(article, cluster) {
				matched = i
				break
			}
		}
		if matched < 0 {
			clusters = append(clusters, []Article{article})
		} else {
			clusters[matched] = append(clusters[matched], article)
		}
	}

	events := make([]Event, 0, len(clusters))
	for _, cluster := range clusters {
		events = append(events, buildEvent(cluster, now))
	}
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].HotScore == events[j].HotScore {
			return events[i].PublishedAt.After(events[j].PublishedAt)
		}
		return events[i].HotScore > events[j].HotScore
	})
	if len(events) > maxEvents {
		events = events[:maxEvents]
	}
	return events
}

func deduplicateArticles(articles []Article) []Article {
	seen := make(map[string]struct{}, len(articles))
	unique := make([]Article, 0, len(articles))
	for _, article := range articles {
		key := canonicalArticleURL(article.URL)
		if key == "" {
			key = normalizeTitle(article.Title)
		}
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, article)
	}
	return unique
}

func canonicalArticleURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" {
		return ""
	}
	parsed.Fragment = ""
	return strings.ToLower(parsed.String())
}

func belongsToCluster(article Article, cluster []Article) bool {
	for _, existing := range cluster {
		if titleSimilarity(article.Title, existing.Title) >= titleSimilarityThreshold {
			return true
		}
	}
	return false
}

func buildEvent(cluster []Article, now time.Time) Event {
	sort.SliceStable(cluster, func(i, j int) bool {
		return cluster[i].PublishedAt.After(cluster[j].PublishedAt)
	})
	representative := cluster[0]
	sources := make([]SourceReference, 0, len(cluster))
	timeline := make([]TimelineItem, 0, len(cluster))
	for i, article := range cluster {
		sourceID := fmt.Sprintf("S%d", i+1)
		sources = append(sources, SourceReference{
			ID:          sourceID,
			Name:        article.Source,
			URL:         article.URL,
			PublishedAt: article.PublishedAt,
		})
		timeline = append(timeline, TimelineItem{
			SourceID:    sourceID,
			Label:       article.Title,
			PublishedAt: article.PublishedAt,
		})
	}

	imageURL := ""
	for _, article := range cluster {
		if article.ImageURL != "" {
			imageURL = article.ImageURL
			break
		}
	}
	return Event{
		ID:          eventID(cluster),
		Category:    classifyCategory(cluster),
		Title:       representative.Title,
		ImageURL:    imageURL,
		PublishedAt: representative.PublishedAt,
		UpdatedAt:   representative.PublishedAt,
		HotScore:    calculateHotScore(cluster, now),
		SourceCount: len(cluster),
		ContentHash: contentHash(cluster),
		Sources:     sources,
		Timeline:    timeline,
		Articles:    append([]Article(nil), cluster...),
	}
}

func calculateHotScore(cluster []Article, now time.Time) int {
	newest := cluster[0].PublishedAt
	ageHours := now.Sub(newest).Hours()
	if ageHours < 0 {
		ageHours = 0
	}
	freshness := math.Max(0, 55-math.Min(ageHours, 48)*(55.0/48.0))
	sourceScore := math.Min(float64(len(cluster)-1)*18, 30)
	completeness := 0.0
	if cluster[0].Description != "" {
		completeness += 8
	}
	for _, article := range cluster {
		if article.ImageURL != "" {
			completeness += 7
			break
		}
	}
	score := int(math.Round(freshness + sourceScore + completeness))
	if score < 0 {
		return 0
	}
	if score > 100 {
		return 100
	}
	return score
}

func classifyCategory(cluster []Article) Category {
	text := strings.ToLower(cluster[0].Title + " " + cluster[0].Description)
	categories := []struct {
		category Category
		keywords []string
	}{
		{CategoryAI, []string{"ai", "人工智能", "大模型", "模型", "deepseek", "openai", "chatgpt", "机器人"}},
		{CategoryFinance, []string{"财经", "金融", "股市", "股票", "基金", "银行", "油价", "财报", "经济"}},
		{CategoryWorld, []string{"国际", "全球", "美国", "欧洲", "联合国", "战争", "外交"}},
		{CategoryTechnology, []string{"科技", "芯片", "手机", "互联网", "软件", "硬件", "数码", "开源"}},
		{CategorySociety, []string{"社会", "教育", "医疗", "文化", "体育", "生活"}},
	}
	for _, candidate := range categories {
		for _, keyword := range candidate.keywords {
			if strings.Contains(text, keyword) {
				return candidate.category
			}
		}
	}
	return CategorySociety
}

func titleSimilarity(left, right string) float64 {
	leftTokens := titleTokens(left)
	rightTokens := titleTokens(right)
	if len(leftTokens) == 0 || len(rightTokens) == 0 {
		return 0
	}
	intersection := 0
	for token := range leftTokens {
		if _, exists := rightTokens[token]; exists {
			intersection++
		}
	}
	union := len(leftTokens) + len(rightTokens) - intersection
	return float64(intersection) / float64(union)
}

func titleTokens(value string) map[string]struct{} {
	normalized := normalizeTitle(value)
	tokens := make(map[string]struct{})
	for _, token := range asciiWordPattern.FindAllString(normalized, -1) {
		tokens[token] = struct{}{}
	}
	var hanRun []rune
	flushHan := func() {
		if len(hanRun) == 1 {
			tokens[string(hanRun)] = struct{}{}
		}
		for i := 0; i+1 < len(hanRun); i++ {
			tokens[string(hanRun[i:i+2])] = struct{}{}
		}
		hanRun = hanRun[:0]
	}
	for _, character := range []rune(normalized) {
		if unicode.Is(unicode.Han, character) {
			hanRun = append(hanRun, character)
		} else if len(hanRun) > 0 {
			flushHan()
		}
	}
	flushHan()
	return tokens
}

func normalizeTitle(value string) string {
	var builder strings.Builder
	for _, character := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(character) || unicode.IsDigit(character) || unicode.IsSpace(character) {
			builder.WriteRune(character)
		}
	}
	return strings.Join(strings.Fields(builder.String()), " ")
}

func eventID(cluster []Article) string {
	urls := make([]string, 0, len(cluster))
	for _, article := range cluster {
		urls = append(urls, canonicalArticleURL(article.URL))
	}
	sort.Strings(urls)
	return "evt_" + shortHash(strings.Join(urls, "\n"))
}

func contentHash(cluster []Article) string {
	parts := make([]string, 0, len(cluster))
	for _, article := range cluster {
		parts = append(parts, strings.Join([]string{article.URL, article.Title, article.Description}, "\x00"))
	}
	sort.Strings(parts)
	return shortHash(strings.Join(parts, "\n"))
}

func shortHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:16])
}
