package reading

import (
	"context"
	"errors"
	"time"
)

var (
	ErrContentUnavailable  = errors.New("reading content is unavailable")
	ErrLibraryDisabled     = errors.New("online reading library is disabled")
	ErrNotFound            = errors.New("reading record not found")
	ErrProviderUnavailable = errors.New("reading provider is unavailable")
	ErrRightsRequired      = errors.New("valid content rights are required")
)

type Provider interface {
	Key() string
	ListBooks(ctx context.Context, cursor string) (BookPage, error)
	GetBook(ctx context.Context, externalID string) (ProviderBook, error)
	ListChapters(ctx context.Context, externalID string, cursor string) (ChapterPage, error)
	GetChapter(ctx context.Context, externalBookID, externalChapterID, userID string) (ChapterContent, error)
	ListUpdatedBooks(ctx context.Context, from, to time.Time) ([]string, error)
	ListRemovedBooks(ctx context.Context, from, to time.Time) ([]string, error)
}

type ProviderBook struct {
	ExternalID   string
	Title        string
	Author       string
	Intro        string
	CoverURL     string
	Category     string
	Tags         []string
	SerialStatus string
	WordCount    int
}

type ProviderChapter struct {
	ExternalID string
	Title      string
	SortOrder  int
	WordCount  int
}

type BookPage struct {
	Books      []ProviderBook
	NextCursor string
}

type ChapterPage struct {
	Chapters   []ProviderChapter
	NextCursor string
}
