package news

import (
	"context"
	"errors"
	"time"
)

var ErrSourcesUnavailable = errors.New("news sources unavailable")

type Category string

const (
	CategoryAI         Category = "ai"
	CategoryTechnology Category = "technology"
	CategoryFinance    Category = "finance"
	CategorySociety    Category = "society"
	CategoryWorld      Category = "world"
)

type Article struct {
	ID          string    `json:"id"`
	Source      string    `json:"source"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	URL         string    `json:"url"`
	ImageURL    string    `json:"imageUrl,omitempty"`
	PublishedAt time.Time `json:"publishedAt"`
}

type SourceReference struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	URL         string    `json:"url"`
	PublishedAt time.Time `json:"publishedAt"`
}

type KeyPoint struct {
	Text      string   `json:"text"`
	SourceIDs []string `json:"sourceIds"`
}

type Summary struct {
	OneSentence string     `json:"oneSentence"`
	KeyPoints   []KeyPoint `json:"keyPoints"`
	Uncertainty string     `json:"uncertainty,omitempty"`
	Status      string     `json:"status"`
	Model       string     `json:"model,omitempty"`
}

type TimelineItem struct {
	SourceID    string    `json:"sourceId"`
	Label       string    `json:"label"`
	PublishedAt time.Time `json:"publishedAt"`
}

type Event struct {
	ID          string            `json:"id"`
	Category    Category          `json:"category"`
	Title       string            `json:"title"`
	ImageURL    string            `json:"imageUrl,omitempty"`
	PublishedAt time.Time         `json:"publishedAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
	HotScore    int               `json:"hotScore"`
	SourceCount int               `json:"sourceCount"`
	ContentHash string            `json:"-"`
	Summary     Summary           `json:"summary"`
	Sources     []SourceReference `json:"sources"`
	Timeline    []TimelineItem    `json:"timeline"`
	Articles    []Article         `json:"-"`
}

type DailyBrief struct {
	Title      string   `json:"title"`
	KeyPoints  []string `json:"keyPoints"`
	EventCount int      `json:"eventCount"`
}

type FeedSnapshot struct {
	GeneratedAt time.Time  `json:"generatedAt"`
	Stale       bool       `json:"stale"`
	DailyBrief  DailyBrief `json:"dailyBrief"`
	Events      []Event    `json:"events"`
}

type Source interface {
	Fetch(context.Context) ([]Article, error)
}

type Summarizer interface {
	Summarize(context.Context, Event) (Summary, error)
}
