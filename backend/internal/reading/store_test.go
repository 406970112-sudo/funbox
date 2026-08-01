package reading

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestStorePersistsCatalogShelfProgressAndBookmarks(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "reading.db"))
	if err != nil {
		t.Fatalf("open reading store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	book := Book{
		ID:            "book-demo",
		SourceType:    SourceAdmin,
		Title:         "雾港来信",
		Author:        "林深",
		Intro:         "一封跨越二十年的来信。",
		Category:      "悬疑",
		SerialStatus:  "completed",
		PublishStatus: StatusPublished,
		AllowOffline:  true,
	}
	chapters := []Chapter{
		{ID: "chapter-1", BookID: book.ID, Title: "第一章 雾中的灯", SortOrder: 1, WordCount: 1200},
		{ID: "chapter-2", BookID: book.ID, Title: "第二章 旧邮局", SortOrder: 2, WordCount: 1400},
	}
	rights := ContentRights{
		BookID:     book.ID,
		Licensor:   "星河版权中心",
		Scope:      "中国大陆地区免费在线阅读",
		ProofNote:  "合同 YW-2026-001",
		ValidFrom:  now.Add(-time.Hour),
		ValidUntil: now.Add(365 * 24 * time.Hour),
		ReviewedBy: "admin-user",
		ReviewedAt: now,
	}
	if err := store.UpsertBook(context.Background(), book, chapters, &rights); err != nil {
		t.Fatalf("upsert book: %v", err)
	}

	listed, err := store.ListBooks(context.Background(), BookFilter{Query: "雾港", PublicOnly: true}, now)
	if err != nil {
		t.Fatalf("list books: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != book.ID {
		t.Fatalf("listed books = %+v", listed)
	}

	if err := store.SetBookshelf(context.Background(), "user-1", book.ID, true, now); err != nil {
		t.Fatalf("add bookshelf: %v", err)
	}
	if err := store.SaveProgress(context.Background(), ReadingProgress{
		UserID:          "user-1",
		BookID:          book.ID,
		ChapterID:       "chapter-2",
		ChapterProgress: 0.42,
		UpdatedAt:       now,
	}); err != nil {
		t.Fatalf("save progress: %v", err)
	}

	bookmark, err := store.CreateBookmark(context.Background(), Bookmark{
		UserID:    "user-1",
		BookID:    book.ID,
		ChapterID: "chapter-2",
		Position:  0.42,
		Note:      "关键线索",
		CreatedAt: now,
	})
	if err != nil {
		t.Fatalf("create bookmark: %v", err)
	}
	if bookmark.ID == "" {
		t.Fatal("bookmark id is empty")
	}

	shelf, err := store.ListBookshelf(context.Background(), "user-1", now)
	if err != nil {
		t.Fatalf("list bookshelf: %v", err)
	}
	if len(shelf) != 1 || shelf[0].Progress == nil || shelf[0].Progress.ChapterID != "chapter-2" {
		t.Fatalf("bookshelf = %+v", shelf)
	}

	bookmarks, err := store.ListBookmarks(context.Background(), "user-1", book.ID)
	if err != nil {
		t.Fatalf("list bookmarks: %v", err)
	}
	if len(bookmarks) != 1 || bookmarks[0].Note != "关键线索" {
		t.Fatalf("bookmarks = %+v", bookmarks)
	}
}

func TestProgressNeverMovesBackwardFromAnOlderClientWrite(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "reading.db"))
	if err != nil {
		t.Fatalf("open reading store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	now := time.Now().UTC().Truncate(time.Second)
	if err := store.UpsertBook(context.Background(), Book{ID: "book", SourceType: SourceProvider, ProviderKey: "mock", ExternalID: "book", Title: "测试", Author: "作者", PublishStatus: StatusPublished}, []Chapter{{ID: "c1", BookID: "book", ExternalID: "c1", Title: "第一章", SortOrder: 1}}, &ContentRights{BookID: "book", Licensor: "mock", Scope: "online", ProofNote: "test", ValidFrom: now.Add(-time.Hour), ValidUntil: now.Add(time.Hour)}); err != nil {
		t.Fatalf("seed book: %v", err)
	}

	latest := ReadingProgress{UserID: "user", BookID: "book", ChapterID: "c1", ChapterProgress: 0.8, UpdatedAt: now}
	older := ReadingProgress{UserID: "user", BookID: "book", ChapterID: "c1", ChapterProgress: 0.2, UpdatedAt: now.Add(-time.Minute)}
	if err := store.SaveProgress(context.Background(), latest); err != nil {
		t.Fatalf("save latest progress: %v", err)
	}
	if err := store.SaveProgress(context.Background(), older); err != nil {
		t.Fatalf("save older progress: %v", err)
	}
	got, err := store.GetProgress(context.Background(), "user", "book")
	if err != nil {
		t.Fatalf("get progress: %v", err)
	}
	if got.ChapterProgress != 0.8 {
		t.Fatalf("progress = %v, want 0.8", got.ChapterProgress)
	}
}

func TestUpsertBookPreservesProgressAndBookmarksForUnchangedChapters(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "reading.db"))
	if err != nil {
		t.Fatalf("open reading store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	now := time.Now().UTC().Truncate(time.Second)
	book := Book{ID: "book", SourceType: SourceProvider, ProviderKey: "mock", ExternalID: "book", Title: "Book", Author: "Author", PublishStatus: StatusPublished}
	chapters := []Chapter{{ID: "chapter-1", BookID: "book", ExternalID: "chapter-1", Title: "Chapter 1", SortOrder: 1}}
	rights := ContentRights{BookID: "book", Licensor: "mock", Scope: "online", ProofNote: "test", ValidFrom: now.Add(-time.Hour), ValidUntil: now.Add(time.Hour)}
	if err := store.UpsertBook(context.Background(), book, chapters, &rights); err != nil {
		t.Fatalf("seed book: %v", err)
	}
	if err := store.SaveProgress(context.Background(), ReadingProgress{UserID: "user", BookID: "book", ChapterID: "chapter-1", ChapterProgress: 0.6, UpdatedAt: now}); err != nil {
		t.Fatalf("save progress: %v", err)
	}
	if _, err := store.CreateBookmark(context.Background(), Bookmark{UserID: "user", BookID: "book", ChapterID: "chapter-1", Position: 0.6, Note: "keep", CreatedAt: now}); err != nil {
		t.Fatalf("create bookmark: %v", err)
	}

	book.Intro = "Updated metadata"
	book.UpdatedAt = now.Add(time.Minute)
	if err := store.UpsertBook(context.Background(), book, chapters, &rights); err != nil {
		t.Fatalf("sync existing book: %v", err)
	}
	progress, err := store.GetProgress(context.Background(), "user", "book")
	if err != nil || progress.ChapterProgress != 0.6 {
		t.Fatalf("progress after sync = %+v, err = %v", progress, err)
	}
	bookmarks, err := store.ListBookmarks(context.Background(), "user", "book")
	if err != nil || len(bookmarks) != 1 || bookmarks[0].Note != "keep" {
		t.Fatalf("bookmarks after sync = %+v, err = %v", bookmarks, err)
	}
}

func TestServiceSyncsMockProviderAndEnforcesPublicationAndRights(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "reading.db"))
	if err != nil {
		t.Fatalf("open reading store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	service := NewService(store, NewMockProvider(), ServiceOptions{
		LibraryEnabled: true,
		Now:            func() time.Time { return now },
	})
	if _, err := service.SyncProvider(context.Background(), "full"); err != nil {
		t.Fatalf("sync mock provider: %v", err)
	}

	books, err := service.ListBooks(context.Background(), BookFilter{})
	if err != nil {
		t.Fatalf("list synced books: %v", err)
	}
	if len(books) < 3 {
		t.Fatalf("synced book count = %d, want at least 3", len(books))
	}
	chapters, err := service.ListChapters(context.Background(), books[0].ID)
	if err != nil || len(chapters) < 3 {
		t.Fatalf("chapters = %+v, err = %v", chapters, err)
	}
	content, err := service.GetChapterContent(context.Background(), books[0].ID, chapters[0].ID, "user-1")
	if err != nil {
		t.Fatalf("read mock chapter: %v", err)
	}
	if content.Content == "" || content.Title == "" {
		t.Fatalf("chapter content = %+v", content)
	}

	if err := store.UpdatePublishStatus(context.Background(), books[0].ID, StatusHidden, "admin", now); err != nil {
		t.Fatalf("hide book: %v", err)
	}
	_, err = service.GetChapterContent(context.Background(), books[0].ID, chapters[0].ID, "user-1")
	if !errors.Is(err, ErrContentUnavailable) {
		t.Fatalf("hidden chapter error = %v, want ErrContentUnavailable", err)
	}
}

func TestServiceCanDisableOnlineLibrary(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "reading.db"))
	if err != nil {
		t.Fatalf("open reading store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	service := NewService(store, NewMockProvider(), ServiceOptions{LibraryEnabled: false})
	if _, err := service.ListBooks(context.Background(), BookFilter{}); !errors.Is(err, ErrLibraryDisabled) {
		t.Fatalf("list books error = %v, want ErrLibraryDisabled", err)
	}
}
