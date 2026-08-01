package reading

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ServiceOptions struct {
	LibraryEnabled bool
	StorageDir     string
	Now            func() time.Time
}

type Service struct {
	libraryEnabled bool
	now            func() time.Time
	provider       Provider
	storageDir     string
	store          *Store
}

func NewService(store *Store, provider Provider, options ServiceOptions) *Service {
	now := options.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{store: store, provider: provider, libraryEnabled: options.LibraryEnabled, storageDir: options.StorageDir, now: now}
}

func (s *Service) Store() *Store { return s.store }

func (s *Service) ProviderKey() string {
	if s.provider == nil {
		return ""
	}
	return s.provider.Key()
}

func (s *Service) ListBooks(ctx context.Context, filter BookFilter) ([]Book, error) {
	if !s.libraryEnabled {
		return nil, ErrLibraryDisabled
	}
	filter.PublicOnly = true
	return s.store.ListBooks(ctx, filter, s.now())
}

func (s *Service) GetBook(ctx context.Context, bookID string) (Book, error) {
	if !s.libraryEnabled {
		return Book{}, ErrLibraryDisabled
	}
	book, err := s.store.GetBook(ctx, bookID)
	if err != nil {
		return Book{}, err
	}
	if err := ensureReadable(book, s.now()); err != nil {
		return Book{}, err
	}
	return book, nil
}

func (s *Service) ListChapters(ctx context.Context, bookID string) ([]Chapter, error) {
	if _, err := s.GetBook(ctx, bookID); err != nil {
		return nil, err
	}
	return s.store.ListChapters(ctx, bookID)
}

func (s *Service) GetChapterContent(ctx context.Context, bookID, chapterID, userID string) (ChapterContent, error) {
	book, err := s.GetBook(ctx, bookID)
	if err != nil {
		return ChapterContent{}, err
	}
	return s.getChapterContent(ctx, book, chapterID, userID)
}

func (s *Service) GetAdminChapterContent(ctx context.Context, bookID, chapterID, userID string) (ChapterContent, error) {
	book, err := s.store.GetBook(ctx, bookID)
	if err != nil {
		return ChapterContent{}, err
	}
	return s.getChapterContent(ctx, book, chapterID, userID)
}

func (s *Service) getChapterContent(ctx context.Context, book Book, chapterID, userID string) (ChapterContent, error) {
	chapter, err := s.store.GetChapter(ctx, book.ID, chapterID)
	if err != nil {
		return ChapterContent{}, err
	}
	chapters, err := s.store.ListChapters(ctx, book.ID)
	if err != nil {
		return ChapterContent{}, err
	}
	previousID, nextID := neighborIDs(chapters, chapter.ID)
	if book.SourceType == SourceProvider {
		if s.provider == nil || s.provider.Key() != book.ProviderKey {
			return ChapterContent{}, ErrProviderUnavailable
		}
		content, err := s.provider.GetChapter(ctx, book.ExternalID, chapter.ExternalID, userID)
		if err != nil {
			return ChapterContent{}, fmt.Errorf("%w: %v", ErrProviderUnavailable, err)
		}
		content.BookID = book.ID
		content.ChapterID = chapter.ID
		content.Title = chapter.Title
		content.SortOrder = chapter.SortOrder
		content.WordCount = chapter.WordCount
		content.PreviousID = previousID
		content.NextID = nextID
		content.SourceType = SourceProvider
		return content, nil
	}
	content, err := s.readAdminChapter(chapter.ContentPath)
	if err != nil {
		return ChapterContent{}, err
	}
	return ChapterContent{BookID: book.ID, ChapterID: chapter.ID, Title: chapter.Title, Content: content,
		SortOrder: chapter.SortOrder, WordCount: chapter.WordCount, PreviousID: previousID, NextID: nextID, SourceType: SourceAdmin}, nil
}

func (s *Service) readAdminChapter(contentPath string) (string, error) {
	if strings.TrimSpace(contentPath) == "" || strings.TrimSpace(s.storageDir) == "" {
		return "", ErrContentUnavailable
	}
	root, err := filepath.Abs(s.storageDir)
	if err != nil {
		return "", ErrContentUnavailable
	}
	target, err := filepath.Abs(contentPath)
	if err != nil {
		return "", ErrContentUnavailable
	}
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return "", ErrContentUnavailable
	}
	content, err := os.ReadFile(target)
	if err != nil {
		return "", fmt.Errorf("read chapter content: %w", err)
	}
	return string(content), nil
}

func (s *Service) SyncProvider(ctx context.Context, syncType string) (run ProviderSyncRun, returnedErr error) {
	if s.provider == nil {
		return ProviderSyncRun{}, ErrProviderUnavailable
	}
	now := s.now()
	run, err := s.store.StartSyncRun(ctx, s.provider.Key(), syncType, now)
	if err != nil {
		return ProviderSyncRun{}, err
	}
	defer func() {
		run.FinishedAt = s.now()
		if returnedErr != nil {
			run.Status = "failed"
			run.ErrorSummary = returnedErr.Error()
		} else {
			run.Status = "completed"
		}
		if finishErr := s.store.FinishSyncRun(context.Background(), run); returnedErr == nil && finishErr != nil {
			returnedErr = finishErr
		}
	}()

	cursor := ""
	for pageCount := 0; pageCount < 1000; pageCount++ {
		page, err := s.provider.ListBooks(ctx, cursor)
		if err != nil {
			return run, fmt.Errorf("list provider books: %w", err)
		}
		for _, partial := range page.Books {
			providerBook := partial
			if strings.TrimSpace(providerBook.Title) == "" {
				providerBook, err = s.provider.GetBook(ctx, partial.ExternalID)
				if err != nil {
					return run, fmt.Errorf("get provider book %s: %w", partial.ExternalID, err)
				}
			}
			chapterPage, err := s.provider.ListChapters(ctx, providerBook.ExternalID, "")
			if err != nil {
				return run, fmt.Errorf("list provider chapters %s: %w", providerBook.ExternalID, err)
			}
			bookID := providerRecordID(s.provider.Key(), providerBook.ExternalID)
			chapters := make([]Chapter, 0, len(chapterPage.Chapters))
			for _, providerChapter := range chapterPage.Chapters {
				chapters = append(chapters, Chapter{ID: providerRecordID(bookID, providerChapter.ExternalID), BookID: bookID,
					ExternalID: providerChapter.ExternalID, Title: providerChapter.Title, SortOrder: providerChapter.SortOrder,
					WordCount: providerChapter.WordCount, Status: "ready"})
			}
			book := Book{ID: bookID, SourceType: SourceProvider, ProviderKey: s.provider.Key(), ExternalID: providerBook.ExternalID,
				Title: providerBook.Title, Author: providerBook.Author, Intro: providerBook.Intro, CoverURL: providerBook.CoverURL,
				Category: providerBook.Category, Tags: providerBook.Tags, SerialStatus: providerBook.SerialStatus,
				PublishStatus: StatusPublished, AllowOffline: false, WordCount: providerBook.WordCount, UpdatedAt: now}
			rights := &ContentRights{BookID: bookID, Licensor: "阅文开放平台", Scope: "合同约定的免费在线阅读",
				ProofNote: "供应商 API 授权范围，以正式合同和后台产品配置为准", ValidFrom: now.Add(-24 * time.Hour),
				ValidUntil: now.AddDate(10, 0, 0), ReviewedBy: "provider-sync", ReviewedAt: now}
			if err := s.store.UpsertBook(ctx, book, chapters, rights); err != nil {
				return run, err
			}
			run.BookCount++
		}
		cursor = page.NextCursor
		run.Cursor = cursor
		if cursor == "" {
			break
		}
	}
	return run, nil
}

func ensureReadable(book Book, now time.Time) error {
	if book.PublishStatus != StatusPublished || book.Rights == nil || !rightsValid(*book.Rights, now) {
		return ErrContentUnavailable
	}
	return nil
}

func providerRecordID(prefix, externalID string) string {
	clean := strings.ToLower(strings.TrimSpace(externalID))
	clean = strings.NewReplacer("/", "-", "\\", "-", " ", "-").Replace(clean)
	return strings.Trim(strings.ToLower(prefix)+"-"+clean, "-")
}

func neighborIDs(chapters []Chapter, chapterID string) (string, string) {
	for index := range chapters {
		if chapters[index].ID != chapterID {
			continue
		}
		previousID, nextID := "", ""
		if index > 0 {
			previousID = chapters[index-1].ID
		}
		if index+1 < len(chapters) {
			nextID = chapters[index+1].ID
		}
		return previousID, nextID
	}
	return "", ""
}

func IsContentUnavailable(err error) bool {
	return errors.Is(err, ErrContentUnavailable) || errors.Is(err, ErrRightsRequired)
}
