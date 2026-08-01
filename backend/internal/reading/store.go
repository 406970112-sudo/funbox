package reading

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*Store, error) {
	if strings.TrimSpace(databasePath) == "" {
		return nil, errors.New("database path is required")
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create reading database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open reading database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS reading_books (
			id TEXT PRIMARY KEY,
			source_type TEXT NOT NULL CHECK(source_type IN ('provider','admin')),
			provider_key TEXT NOT NULL DEFAULT '',
			external_id TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL,
			author TEXT NOT NULL,
			intro TEXT NOT NULL DEFAULT '',
			cover_url TEXT NOT NULL DEFAULT '',
			category TEXT NOT NULL DEFAULT '',
			tags_json TEXT NOT NULL DEFAULT '[]',
			serial_status TEXT NOT NULL DEFAULT 'serializing',
			publish_status TEXT NOT NULL CHECK(publish_status IN ('draft','published','hidden','removed')),
			allow_offline INTEGER NOT NULL DEFAULT 0,
			word_count INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(provider_key, external_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_reading_books_public ON reading_books(publish_status, updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS reading_chapters (
			id TEXT PRIMARY KEY,
			book_id TEXT NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
			external_id TEXT NOT NULL DEFAULT '',
			title TEXT NOT NULL,
			sort_order INTEGER NOT NULL,
			word_count INTEGER NOT NULL DEFAULT 0,
			content_path TEXT NOT NULL DEFAULT '',
			content_hash TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'ready',
			UNIQUE(book_id, sort_order)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_reading_chapters_book_order ON reading_chapters(book_id, sort_order)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_chapters_external
			ON reading_chapters(book_id, external_id) WHERE external_id <> ''`,
		`CREATE TABLE IF NOT EXISTS reading_bookshelves (
			user_id TEXT NOT NULL,
			book_id TEXT NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
			added_at INTEGER NOT NULL,
			PRIMARY KEY(user_id, book_id)
		)`,
		`CREATE TABLE IF NOT EXISTS reading_progress (
			user_id TEXT NOT NULL,
			book_id TEXT NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
			chapter_id TEXT NOT NULL REFERENCES reading_chapters(id) ON DELETE CASCADE,
			chapter_progress REAL NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY(user_id, book_id)
		)`,
		`CREATE TABLE IF NOT EXISTS reading_bookmarks (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			book_id TEXT NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
			chapter_id TEXT NOT NULL REFERENCES reading_chapters(id) ON DELETE CASCADE,
			position REAL NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_reading_bookmarks_user_book ON reading_bookmarks(user_id, book_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS reading_content_rights (
			book_id TEXT PRIMARY KEY REFERENCES reading_books(id) ON DELETE CASCADE,
			licensor TEXT NOT NULL,
			scope TEXT NOT NULL,
			proof_note TEXT NOT NULL,
			valid_from INTEGER NOT NULL,
			valid_until INTEGER NOT NULL,
			reviewed_by TEXT NOT NULL DEFAULT '',
			reviewed_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS reading_provider_sync_runs (
			id TEXT PRIMARY KEY,
			provider_key TEXT NOT NULL,
			sync_type TEXT NOT NULL,
			started_at INTEGER NOT NULL,
			finished_at INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL,
			cursor TEXT NOT NULL DEFAULT '',
			error_summary TEXT NOT NULL DEFAULT '',
			book_count INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_reading_sync_runs_provider ON reading_provider_sync_runs(provider_key, started_at DESC)`,
		`CREATE TABLE IF NOT EXISTS reading_imports (
			id TEXT PRIMARY KEY,
			book_id TEXT NOT NULL DEFAULT '',
			file_name TEXT NOT NULL,
			file_path TEXT NOT NULL,
			format TEXT NOT NULL,
			status TEXT NOT NULL,
			warnings_json TEXT NOT NULL DEFAULT '[]',
			error_summary TEXT NOT NULL DEFAULT '',
			created_by TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS reading_audit_logs (
			id TEXT PRIMARY KEY,
			book_id TEXT NOT NULL,
			actor_id TEXT NOT NULL,
			action TEXT NOT NULL,
			detail TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run reading migration: %w", err)
		}
	}
	return nil
}

func (s *Store) UpsertBook(ctx context.Context, book Book, chapters []Chapter, rights *ContentRights) error {
	book.ID = strings.TrimSpace(book.ID)
	if book.ID == "" {
		book.ID = uuid.NewString()
	}
	if strings.TrimSpace(book.Title) == "" || strings.TrimSpace(book.Author) == "" {
		return errors.New("book title and author are required")
	}
	if book.SourceType != SourceProvider && book.SourceType != SourceAdmin {
		return errors.New("invalid book source type")
	}
	if book.PublishStatus == "" {
		book.PublishStatus = StatusDraft
	}
	now := time.Now().UTC()
	if book.CreatedAt.IsZero() {
		book.CreatedAt = now
	}
	if book.UpdatedAt.IsZero() {
		book.UpdatedAt = now
	}
	tags, err := json.Marshal(book.Tags)
	if err != nil {
		return fmt.Errorf("encode book tags: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin book upsert: %w", err)
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO reading_books (
		id, source_type, provider_key, external_id, title, author, intro, cover_url,
		category, tags_json, serial_status, publish_status, allow_offline, word_count,
		created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		source_type=excluded.source_type, provider_key=excluded.provider_key,
		external_id=excluded.external_id, title=excluded.title, author=excluded.author,
		intro=excluded.intro, cover_url=excluded.cover_url, category=excluded.category,
		tags_json=excluded.tags_json, serial_status=excluded.serial_status,
		publish_status=excluded.publish_status, allow_offline=excluded.allow_offline,
		word_count=excluded.word_count, updated_at=excluded.updated_at`,
		book.ID, book.SourceType, book.ProviderKey, book.ExternalID, strings.TrimSpace(book.Title),
		strings.TrimSpace(book.Author), strings.TrimSpace(book.Intro), strings.TrimSpace(book.CoverURL),
		strings.TrimSpace(book.Category), string(tags), strings.TrimSpace(book.SerialStatus),
		book.PublishStatus, boolInt(book.AllowOffline), book.WordCount, book.CreatedAt.Unix(), book.UpdatedAt.Unix())
	if err != nil {
		return fmt.Errorf("upsert reading book: %w", err)
	}
	// Move existing sort positions out of the way so reorders can be applied
	// without violating the per-book sort-order constraint mid-transaction.
	if _, err := tx.ExecContext(ctx, `UPDATE reading_chapters SET sort_order = sort_order + 1000000000 WHERE book_id = ?`, book.ID); err != nil {
		return fmt.Errorf("prepare reading chapter upsert: %w", err)
	}
	incomingIDs := make([]string, 0, len(chapters))
	for index := range chapters {
		chapter := chapters[index]
		if chapter.ID == "" {
			chapter.ID = uuid.NewString()
		}
		if chapter.BookID == "" {
			chapter.BookID = book.ID
		}
		if chapter.Status == "" {
			chapter.Status = "ready"
		}
		incomingIDs = append(incomingIDs, chapter.ID)
		if _, err := tx.ExecContext(ctx, `INSERT INTO reading_chapters (
			id, book_id, external_id, title, sort_order, word_count, content_path, content_hash, status
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET book_id=excluded.book_id, external_id=excluded.external_id,
			title=excluded.title, sort_order=excluded.sort_order, word_count=excluded.word_count,
			content_path=excluded.content_path, content_hash=excluded.content_hash, status=excluded.status`, chapter.ID, book.ID, chapter.ExternalID,
			strings.TrimSpace(chapter.Title), chapter.SortOrder, chapter.WordCount, chapter.ContentPath,
			chapter.ContentHash, chapter.Status); err != nil {
			return fmt.Errorf("upsert reading chapter: %w", err)
		}
	}
	deleteQuery := `DELETE FROM reading_chapters WHERE book_id = ?`
	deleteArgs := []any{book.ID}
	if len(incomingIDs) > 0 {
		deleteQuery += ` AND id NOT IN (` + strings.TrimRight(strings.Repeat("?,", len(incomingIDs)), ",") + `)`
		for _, chapterID := range incomingIDs {
			deleteArgs = append(deleteArgs, chapterID)
		}
	}
	if _, err := tx.ExecContext(ctx, deleteQuery, deleteArgs...); err != nil {
		return fmt.Errorf("remove stale reading chapters: %w", err)
	}
	if rights != nil {
		if err := upsertRights(ctx, tx, book.ID, *rights); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit book upsert: %w", err)
	}
	return nil
}

func upsertRights(ctx context.Context, tx *sql.Tx, bookID string, rights ContentRights) error {
	if strings.TrimSpace(rights.Licensor) == "" || strings.TrimSpace(rights.Scope) == "" || strings.TrimSpace(rights.ProofNote) == "" || rights.ValidFrom.IsZero() || rights.ValidUntil.IsZero() || !rights.ValidUntil.After(rights.ValidFrom) {
		return ErrRightsRequired
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO reading_content_rights (
		book_id, licensor, scope, proof_note, valid_from, valid_until, reviewed_by, reviewed_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(book_id) DO UPDATE SET licensor=excluded.licensor, scope=excluded.scope,
		proof_note=excluded.proof_note, valid_from=excluded.valid_from, valid_until=excluded.valid_until,
		reviewed_by=excluded.reviewed_by, reviewed_at=excluded.reviewed_at`,
		bookID, strings.TrimSpace(rights.Licensor), strings.TrimSpace(rights.Scope), strings.TrimSpace(rights.ProofNote),
		rights.ValidFrom.Unix(), rights.ValidUntil.Unix(), rights.ReviewedBy, unixOrZero(rights.ReviewedAt))
	if err != nil {
		return fmt.Errorf("upsert content rights: %w", err)
	}
	return nil
}

func (s *Store) SetRights(ctx context.Context, bookID string, rights ContentRights) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := upsertRights(ctx, tx, bookID, rights); err != nil {
		return err
	}
	return tx.Commit()
}

const bookSelect = `SELECT b.id, b.source_type, b.provider_key, b.external_id, b.title, b.author,
	b.intro, b.cover_url, b.category, b.tags_json, b.serial_status, b.publish_status,
	b.allow_offline, b.word_count, b.created_at, b.updated_at,
	(SELECT COUNT(*) FROM reading_chapters c WHERE c.book_id = b.id),
	r.licensor, r.scope, r.proof_note, r.valid_from, r.valid_until, r.reviewed_by, r.reviewed_at
	FROM reading_books b LEFT JOIN reading_content_rights r ON r.book_id = b.id`

func (s *Store) ListBooks(ctx context.Context, filter BookFilter, now time.Time) ([]Book, error) {
	query := bookSelect + ` WHERE 1=1`
	args := make([]any, 0, 6)
	if filter.PublicOnly {
		query += ` AND b.publish_status = ? AND r.valid_from <= ? AND r.valid_until >= ?`
		args = append(args, StatusPublished, now.Unix(), now.Unix())
	} else if filter.Status != "" {
		query += ` AND b.publish_status = ?`
		args = append(args, filter.Status)
	}
	if value := strings.TrimSpace(filter.Query); value != "" {
		query += ` AND (b.title LIKE ? OR b.author LIKE ? OR b.intro LIKE ?)`
		pattern := "%" + value + "%"
		args = append(args, pattern, pattern, pattern)
	}
	if category := strings.TrimSpace(filter.Category); category != "" && category != "全部" {
		query += ` AND b.category = ?`
		args = append(args, category)
	}
	query += ` ORDER BY b.updated_at DESC, b.title`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list reading books: %w", err)
	}
	defer rows.Close()
	books := make([]Book, 0)
	for rows.Next() {
		book, err := scanBook(rows)
		if err != nil {
			return nil, err
		}
		books = append(books, book)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate reading books: %w", err)
	}
	return books, nil
}

type rowScanner interface{ Scan(...any) error }

func scanBook(row rowScanner) (Book, error) {
	var book Book
	var tags string
	var allowOffline int
	var createdAt, updatedAt int64
	var licensor, scope, proof, reviewedBy sql.NullString
	var validFrom, validUntil, reviewedAt sql.NullInt64
	if err := row.Scan(&book.ID, &book.SourceType, &book.ProviderKey, &book.ExternalID, &book.Title,
		&book.Author, &book.Intro, &book.CoverURL, &book.Category, &tags, &book.SerialStatus,
		&book.PublishStatus, &allowOffline, &book.WordCount, &createdAt, &updatedAt,
		&book.ChapterCount, &licensor, &scope, &proof, &validFrom, &validUntil, &reviewedBy, &reviewedAt); err != nil {
		return Book{}, fmt.Errorf("scan reading book: %w", err)
	}
	_ = json.Unmarshal([]byte(tags), &book.Tags)
	if book.Tags == nil {
		book.Tags = []string{}
	}
	book.AllowOffline = allowOffline == 1
	book.CreatedAt = time.Unix(createdAt, 0).UTC()
	book.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	if licensor.Valid {
		book.Rights = &ContentRights{BookID: book.ID, Licensor: licensor.String, Scope: scope.String,
			ProofNote: proof.String, ValidFrom: time.Unix(validFrom.Int64, 0).UTC(), ValidUntil: time.Unix(validUntil.Int64, 0).UTC(),
			ReviewedBy: reviewedBy.String, ReviewedAt: timeFromUnix(reviewedAt.Int64)}
	}
	return book, nil
}

func (s *Store) GetBook(ctx context.Context, bookID string) (Book, error) {
	book, err := scanBook(s.db.QueryRowContext(ctx, bookSelect+` WHERE b.id = ?`, bookID))
	if errors.Is(err, sql.ErrNoRows) || (err != nil && strings.Contains(err.Error(), "no rows")) {
		return Book{}, ErrNotFound
	}
	return book, err
}

func (s *Store) ListChapters(ctx context.Context, bookID string) ([]Chapter, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, book_id, external_id, title, sort_order,
		word_count, content_path, content_hash, status FROM reading_chapters WHERE book_id = ? ORDER BY sort_order`, bookID)
	if err != nil {
		return nil, fmt.Errorf("list reading chapters: %w", err)
	}
	defer rows.Close()
	chapters := make([]Chapter, 0)
	for rows.Next() {
		var chapter Chapter
		if err := rows.Scan(&chapter.ID, &chapter.BookID, &chapter.ExternalID, &chapter.Title,
			&chapter.SortOrder, &chapter.WordCount, &chapter.ContentPath, &chapter.ContentHash, &chapter.Status); err != nil {
			return nil, fmt.Errorf("scan reading chapter: %w", err)
		}
		chapters = append(chapters, chapter)
	}
	return chapters, rows.Err()
}

func (s *Store) GetChapter(ctx context.Context, bookID, chapterID string) (Chapter, error) {
	var chapter Chapter
	err := s.db.QueryRowContext(ctx, `SELECT id, book_id, external_id, title, sort_order,
		word_count, content_path, content_hash, status FROM reading_chapters WHERE book_id = ? AND id = ?`, bookID, chapterID).Scan(
		&chapter.ID, &chapter.BookID, &chapter.ExternalID, &chapter.Title, &chapter.SortOrder,
		&chapter.WordCount, &chapter.ContentPath, &chapter.ContentHash, &chapter.Status)
	if errors.Is(err, sql.ErrNoRows) {
		return Chapter{}, ErrNotFound
	}
	if err != nil {
		return Chapter{}, fmt.Errorf("get reading chapter: %w", err)
	}
	return chapter, nil
}

func (s *Store) SetBookshelf(ctx context.Context, userID, bookID string, added bool, now time.Time) error {
	if added {
		_, err := s.db.ExecContext(ctx, `INSERT INTO reading_bookshelves(user_id, book_id, added_at)
			VALUES (?, ?, ?) ON CONFLICT(user_id, book_id) DO UPDATE SET added_at=excluded.added_at`, userID, bookID, now.Unix())
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM reading_bookshelves WHERE user_id = ? AND book_id = ?`, userID, bookID)
	return err
}

func (s *Store) IsInBookshelf(ctx context.Context, userID, bookID string) (bool, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM reading_bookshelves WHERE user_id = ? AND book_id = ?`, userID, bookID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Store) ListBookshelf(ctx context.Context, userID string, now time.Time) ([]Book, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT book_id FROM reading_bookshelves WHERE user_id = ? ORDER BY added_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list bookshelf ids: %w", err)
	}
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	books := make([]Book, 0, len(ids))
	for _, id := range ids {
		book, err := s.GetBook(ctx, id)
		if err != nil {
			return nil, err
		}
		book.InBookshelf = true
		if progress, err := s.GetProgress(ctx, userID, id); err == nil {
			book.Progress = &progress
		}
		books = append(books, book)
	}
	return books, nil
}

func (s *Store) SaveProgress(ctx context.Context, progress ReadingProgress) error {
	if progress.ChapterProgress < 0 {
		progress.ChapterProgress = 0
	}
	if progress.ChapterProgress > 1 {
		progress.ChapterProgress = 1
	}
	if progress.UpdatedAt.IsZero() {
		progress.UpdatedAt = time.Now().UTC()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO reading_progress(user_id, book_id, chapter_id, chapter_progress, updated_at)
		VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, book_id) DO UPDATE SET
		chapter_id=excluded.chapter_id, chapter_progress=excluded.chapter_progress, updated_at=excluded.updated_at
		WHERE excluded.updated_at >= reading_progress.updated_at`, progress.UserID, progress.BookID,
		progress.ChapterID, progress.ChapterProgress, progress.UpdatedAt.Unix())
	if err != nil {
		return fmt.Errorf("save reading progress: %w", err)
	}
	return nil
}

func (s *Store) GetProgress(ctx context.Context, userID, bookID string) (ReadingProgress, error) {
	var progress ReadingProgress
	var updatedAt int64
	err := s.db.QueryRowContext(ctx, `SELECT user_id, book_id, chapter_id, chapter_progress, updated_at
		FROM reading_progress WHERE user_id = ? AND book_id = ?`, userID, bookID).Scan(
		&progress.UserID, &progress.BookID, &progress.ChapterID, &progress.ChapterProgress, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ReadingProgress{}, ErrNotFound
	}
	if err != nil {
		return ReadingProgress{}, fmt.Errorf("get reading progress: %w", err)
	}
	progress.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return progress, nil
}

func (s *Store) CreateBookmark(ctx context.Context, bookmark Bookmark) (Bookmark, error) {
	if bookmark.ID == "" {
		bookmark.ID = uuid.NewString()
	}
	if bookmark.CreatedAt.IsZero() {
		bookmark.CreatedAt = time.Now().UTC()
	}
	if bookmark.Position < 0 || bookmark.Position > 1 {
		return Bookmark{}, errors.New("bookmark position must be between zero and one")
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO reading_bookmarks(id, user_id, book_id, chapter_id, position, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, bookmark.ID, bookmark.UserID, bookmark.BookID, bookmark.ChapterID,
		bookmark.Position, strings.TrimSpace(bookmark.Note), bookmark.CreatedAt.Unix())
	if err != nil {
		return Bookmark{}, fmt.Errorf("create reading bookmark: %w", err)
	}
	return bookmark, nil
}

func (s *Store) ListBookmarks(ctx context.Context, userID, bookID string) ([]Bookmark, error) {
	query := `SELECT id, user_id, book_id, chapter_id, position, note, created_at FROM reading_bookmarks WHERE user_id = ?`
	args := []any{userID}
	if bookID != "" {
		query += ` AND book_id = ?`
		args = append(args, bookID)
	}
	query += ` ORDER BY created_at DESC`
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bookmarks := make([]Bookmark, 0)
	for rows.Next() {
		var bookmark Bookmark
		var createdAt int64
		if err := rows.Scan(&bookmark.ID, &bookmark.UserID, &bookmark.BookID, &bookmark.ChapterID,
			&bookmark.Position, &bookmark.Note, &createdAt); err != nil {
			return nil, err
		}
		bookmark.CreatedAt = time.Unix(createdAt, 0).UTC()
		bookmarks = append(bookmarks, bookmark)
	}
	return bookmarks, rows.Err()
}

func (s *Store) DeleteBookmark(ctx context.Context, userID, bookmarkID string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM reading_bookmarks WHERE id = ? AND user_id = ?`, bookmarkID, userID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) UpdatePublishStatus(ctx context.Context, bookID string, status PublishStatus, actorID string, now time.Time) error {
	if status != StatusDraft && status != StatusPublished && status != StatusHidden && status != StatusRemoved {
		return errors.New("invalid publish status")
	}
	if status == StatusPublished {
		book, err := s.GetBook(ctx, bookID)
		if err != nil {
			return err
		}
		if book.Rights == nil || !rightsValid(*book.Rights, now) {
			return ErrRightsRequired
		}
	}
	result, err := s.db.ExecContext(ctx, `UPDATE reading_books SET publish_status = ?, updated_at = ? WHERE id = ?`, status, now.Unix(), bookID)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return ErrNotFound
	}
	return s.AddAudit(ctx, bookID, actorID, string(status), "", now)
}

func (s *Store) UpdateBook(ctx context.Context, bookID string, patch BookPatch, actorID string, now time.Time) (Book, error) {
	book, err := s.GetBook(ctx, bookID)
	if err != nil {
		return Book{}, err
	}
	if patch.Title != nil {
		book.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.Author != nil {
		book.Author = strings.TrimSpace(*patch.Author)
	}
	if patch.Intro != nil {
		book.Intro = strings.TrimSpace(*patch.Intro)
	}
	if patch.CoverURL != nil {
		book.CoverURL = strings.TrimSpace(*patch.CoverURL)
	}
	if patch.Category != nil {
		book.Category = strings.TrimSpace(*patch.Category)
	}
	if patch.SerialStatus != nil {
		book.SerialStatus = strings.TrimSpace(*patch.SerialStatus)
	}
	if patch.AllowOffline != nil {
		book.AllowOffline = *patch.AllowOffline
	}
	book.UpdatedAt = now
	chapters, err := s.ListChapters(ctx, bookID)
	if err != nil {
		return Book{}, err
	}
	rights := book.Rights
	if patch.Rights != nil {
		rights = patch.Rights
	}
	if err := s.UpsertBook(ctx, book, chapters, rights); err != nil {
		return Book{}, err
	}
	_ = s.AddAudit(ctx, bookID, actorID, "update", "metadata", now)
	return s.GetBook(ctx, bookID)
}

func (s *Store) UpdateChapter(ctx context.Context, bookID, chapterID, title string, sortOrder int) (Chapter, error) {
	result, err := s.db.ExecContext(ctx, `UPDATE reading_chapters SET title = ?, sort_order = ? WHERE book_id = ? AND id = ?`, strings.TrimSpace(title), sortOrder, bookID, chapterID)
	if err != nil {
		return Chapter{}, err
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		return Chapter{}, ErrNotFound
	}
	return s.GetChapter(ctx, bookID, chapterID)
}

func (s *Store) AddAudit(ctx context.Context, bookID, actorID, action, detail string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO reading_audit_logs(id, book_id, actor_id, action, detail, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`, uuid.NewString(), bookID, actorID, action, detail, now.Unix())
	return err
}

func (s *Store) StartSyncRun(ctx context.Context, providerKey, syncType string, now time.Time) (ProviderSyncRun, error) {
	run := ProviderSyncRun{ID: uuid.NewString(), ProviderKey: providerKey, SyncType: syncType, StartedAt: now, Status: "running"}
	_, err := s.db.ExecContext(ctx, `INSERT INTO reading_provider_sync_runs(id, provider_key, sync_type, started_at, status)
		VALUES (?, ?, ?, ?, ?)`, run.ID, run.ProviderKey, run.SyncType, now.Unix(), run.Status)
	return run, err
}

func (s *Store) FinishSyncRun(ctx context.Context, run ProviderSyncRun) error {
	_, err := s.db.ExecContext(ctx, `UPDATE reading_provider_sync_runs SET finished_at = ?, status = ?, cursor = ?, error_summary = ?, book_count = ? WHERE id = ?`,
		run.FinishedAt.Unix(), run.Status, run.Cursor, run.ErrorSummary, run.BookCount, run.ID)
	return err
}

func (s *Store) ListSyncRuns(ctx context.Context, limit int) ([]ProviderSyncRun, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, provider_key, sync_type, started_at, finished_at, status, cursor, error_summary, book_count
		FROM reading_provider_sync_runs ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runs := make([]ProviderSyncRun, 0)
	for rows.Next() {
		var run ProviderSyncRun
		var startedAt, finishedAt int64
		if err := rows.Scan(&run.ID, &run.ProviderKey, &run.SyncType, &startedAt, &finishedAt, &run.Status, &run.Cursor, &run.ErrorSummary, &run.BookCount); err != nil {
			return nil, err
		}
		run.StartedAt = time.Unix(startedAt, 0).UTC()
		run.FinishedAt = timeFromUnix(finishedAt)
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Store) SaveImportJob(ctx context.Context, job ImportJob) error {
	warnings, err := json.Marshal(job.Warnings)
	if err != nil {
		return fmt.Errorf("encode import warnings: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO reading_imports(
		id, book_id, file_name, file_path, format, status, warnings_json, error_summary,
		created_by, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET book_id=excluded.book_id, status=excluded.status,
		warnings_json=excluded.warnings_json, error_summary=excluded.error_summary, updated_at=excluded.updated_at`,
		job.ID, job.BookID, job.FileName, job.FilePath, job.Format, job.Status, string(warnings),
		job.ErrorSummary, job.CreatedBy, job.CreatedAt.Unix(), job.UpdatedAt.Unix())
	if err != nil {
		return fmt.Errorf("save reading import: %w", err)
	}
	return nil
}

func (s *Store) GetImportJob(ctx context.Context, importID string) (ImportJob, error) {
	var job ImportJob
	var warnings string
	var createdAt, updatedAt int64
	err := s.db.QueryRowContext(ctx, `SELECT id, book_id, file_name, file_path, format, status,
		warnings_json, error_summary, created_by, created_at, updated_at FROM reading_imports WHERE id = ?`, importID).Scan(
		&job.ID, &job.BookID, &job.FileName, &job.FilePath, &job.Format, &job.Status, &warnings,
		&job.ErrorSummary, &job.CreatedBy, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ImportJob{}, ErrNotFound
	}
	if err != nil {
		return ImportJob{}, fmt.Errorf("get reading import: %w", err)
	}
	_ = json.Unmarshal([]byte(warnings), &job.Warnings)
	if job.Warnings == nil {
		job.Warnings = []string{}
	}
	job.CreatedAt = time.Unix(createdAt, 0).UTC()
	job.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return job, nil
}

func rightsValid(rights ContentRights, now time.Time) bool {
	return !rights.ValidFrom.After(now) && !rights.ValidUntil.Before(now) && strings.TrimSpace(rights.Licensor) != "" && strings.TrimSpace(rights.Scope) != "" && strings.TrimSpace(rights.ProofNote) != ""
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func unixOrZero(value time.Time) int64 {
	if value.IsZero() {
		return 0
	}
	return value.Unix()
}

func timeFromUnix(value int64) time.Time {
	if value == 0 {
		return time.Time{}
	}
	return time.Unix(value, 0).UTC()
}
