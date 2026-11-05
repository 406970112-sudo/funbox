package notebook

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type Store struct {
	db       *sql.DB
	mu       sync.Mutex
	sessions map[string]notebookSession
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDatabasePathEmpty
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create notebook database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open notebook database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db, sessions: make(map[string]notebookSession)}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate() error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS notebook_books (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			color TEXT NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_notebook_books_owner
			ON notebook_books(owner_id, sort_order, created_at)`,
		`CREATE TABLE IF NOT EXISTS notebook_notes (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			book_id TEXT NOT NULL REFERENCES notebook_books(id) ON DELETE CASCADE,
			title TEXT NOT NULL DEFAULT '',
			body TEXT NOT NULL DEFAULT '',
			checklist_json TEXT NOT NULL DEFAULT '[]',
			tags_json TEXT NOT NULL DEFAULT '[]',
			pinned INTEGER NOT NULL DEFAULT 0,
			favorite INTEGER NOT NULL DEFAULT 0,
			encrypted INTEGER NOT NULL DEFAULT 0,
			encrypted_payload TEXT NOT NULL DEFAULT '',
			note_key_enc TEXT NOT NULL DEFAULT '',
			encryption_version INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_notebook_notes_owner_updated
			ON notebook_notes(owner_id, status, pinned DESC, updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_notebook_notes_book_updated
			ON notebook_notes(book_id, status, updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS notebook_media (
			id TEXT PRIMARY KEY,
			note_id TEXT NOT NULL REFERENCES notebook_notes(id) ON DELETE CASCADE,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			kind TEXT NOT NULL CHECK(kind IN ('image', 'audio')),
			stored_name TEXT NOT NULL,
			content_type TEXT NOT NULL,
			byte_size INTEGER NOT NULL,
			encrypted INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_notebook_media_note
			ON notebook_media(note_id, kind, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_notebook_media_owner
			ON notebook_media(owner_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS notebook_security (
			owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			password_hash TEXT NOT NULL,
			key_salt TEXT NOT NULL,
			data_key_enc TEXT NOT NULL,
			password_version INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run notebook database migration: %w", err)
		}
	}
	columns := []struct {
		table      string
		column     string
		definition string
	}{
		{"notebook_notes", "encrypted", "INTEGER NOT NULL DEFAULT 0"},
		{"notebook_notes", "encrypted_payload", "TEXT NOT NULL DEFAULT ''"},
		{"notebook_notes", "note_key_enc", "TEXT NOT NULL DEFAULT ''"},
		{"notebook_notes", "encryption_version", "INTEGER NOT NULL DEFAULT 0"},
		{"notebook_media", "encrypted", "INTEGER NOT NULL DEFAULT 0"},
	}
	for _, column := range columns {
		if err := s.ensureColumn(column.table, column.column, column.definition); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ensureColumn(table, column, definition string) error {
	rows, err := s.db.Query(`PRAGMA table_info(` + table + `)`)
	if err != nil {
		return fmt.Errorf("inspect notebook schema: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, dataType string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return fmt.Errorf("scan notebook schema: %w", err)
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read notebook schema: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close notebook schema inspection: %w", err)
	}
	if _, err := s.db.Exec(`ALTER TABLE ` + table + ` ADD COLUMN ` + column + ` ` + definition); err != nil {
		return fmt.Errorf("add notebook column %s.%s: %w", table, column, err)
	}
	return nil
}

func (s *Store) EnsureDefaultBooks(ctx context.Context, userID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin default notebook books: %w", err)
	}
	defer tx.Rollback()
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM notebook_books WHERE owner_id = ?`, userID).Scan(&count); err != nil {
		return fmt.Errorf("count notebook books: %w", err)
	}
	if count > 0 {
		return tx.Commit()
	}
	now := time.Now().UTC()
	definitions := []struct {
		name  string
		color string
		order int
	}{
		{DefaultBookWork, DefaultBookColorWork, 10},
		{DefaultBookLife, DefaultBookColorLife, 20},
		{DefaultBookIdeas, DefaultBookColorIdea, 30},
	}
	for _, definition := range definitions {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO notebook_books (id, owner_id, name, color, sort_order, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`, uuid.NewString(), userID, definition.name, definition.color, definition.order, now.UnixMilli(), now.UnixMilli()); err != nil {
			return fmt.Errorf("create default notebook book: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit default notebook books: %w", err)
	}
	return nil
}

func (s *Store) ListBooks(ctx context.Context, userID string) ([]Book, error) {
	if err := s.EnsureDefaultBooks(ctx, userID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT b.id, b.owner_id, b.name, b.color, b.sort_order, b.created_at, b.updated_at,
		       COUNT(n.id)
		FROM notebook_books b
		LEFT JOIN notebook_notes n
		  ON n.book_id = b.id AND n.owner_id = b.owner_id AND n.status = 'active'
		WHERE b.owner_id = ?
		GROUP BY b.id, b.owner_id, b.name, b.color, b.sort_order, b.created_at, b.updated_at
		ORDER BY b.sort_order ASC, b.created_at ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list notebook books: %w", err)
	}
	defer rows.Close()
	books := []Book{}
	for rows.Next() {
		item, err := scanBook(rows)
		if err != nil {
			return nil, err
		}
		books = append(books, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return books, nil
}

func (s *Store) GetBook(ctx context.Context, userID string, bookID string) (Book, error) {
	item, err := scanBook(s.db.QueryRowContext(ctx, `
		SELECT b.id, b.owner_id, b.name, b.color, b.sort_order, b.created_at, b.updated_at,
		       (SELECT COUNT(*) FROM notebook_notes n
		        WHERE n.book_id = b.id AND n.owner_id = b.owner_id AND n.status = 'active')
		FROM notebook_books b
		WHERE b.id = ? AND b.owner_id = ?
	`, bookID, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return Book{}, ErrBookNotFound
	}
	if err != nil {
		return Book{}, fmt.Errorf("get notebook book: %w", err)
	}
	return item, nil
}

func (s *Store) CreateBook(ctx context.Context, userID string, input BookInput) (Book, error) {
	if err := s.EnsureDefaultBooks(ctx, userID); err != nil {
		return Book{}, err
	}
	name := strings.TrimSpace(input.Name)
	if !validBookName(name) {
		return Book{}, ErrInvalidInput
	}
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notebook_books WHERE owner_id = ?`, userID).Scan(&count); err != nil {
		return Book{}, fmt.Errorf("count notebook books: %w", err)
	}
	if count >= MaxBooks {
		return Book{}, ErrBookLimitReached
	}
	exists, err := s.bookNameExists(ctx, userID, name, "")
	if err != nil {
		return Book{}, err
	}
	if exists {
		return Book{}, ErrBookNameExists
	}
	now := time.Now().UTC()
	item := Book{
		ID:        uuid.NewString(),
		UserID:    userID,
		Name:      name,
		Color:     normalizeColor(input.Color),
		SortOrder: 10,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(sort_order), 0) + 10 FROM notebook_books WHERE owner_id = ?
	`, userID).Scan(&item.SortOrder); err != nil {
		return Book{}, fmt.Errorf("choose notebook sort order: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO notebook_books (id, owner_id, name, color, sort_order, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, item.ID, userID, item.Name, item.Color, item.SortOrder, now.UnixMilli(), now.UnixMilli()); err != nil {
		return Book{}, fmt.Errorf("create notebook book: %w", err)
	}
	return s.GetBook(ctx, userID, item.ID)
}

func (s *Store) UpdateBook(ctx context.Context, userID string, bookID string, input BookInput) (Book, error) {
	current, err := s.GetBook(ctx, userID, bookID)
	if err != nil {
		return Book{}, err
	}
	if name := strings.TrimSpace(input.Name); name != "" {
		if !validBookName(name) {
			return Book{}, ErrInvalidInput
		}
		exists, err := s.bookNameExists(ctx, userID, name, bookID)
		if err != nil {
			return Book{}, err
		}
		if exists {
			return Book{}, ErrBookNameExists
		}
		current.Name = name
	}
	if strings.TrimSpace(input.Color) != "" {
		current.Color = normalizeColor(input.Color)
	}
	current.UpdatedAt = time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE notebook_books SET name = ?, color = ?, updated_at = ?
		WHERE id = ? AND owner_id = ?
	`, current.Name, current.Color, current.UpdatedAt.UnixMilli(), bookID, userID); err != nil {
		return Book{}, fmt.Errorf("update notebook book: %w", err)
	}
	return s.GetBook(ctx, userID, bookID)
}

func (s *Store) DeleteBook(ctx context.Context, userID string, bookID string) error {
	book, err := s.GetBook(ctx, userID, bookID)
	if err != nil {
		return err
	}
	if book.NoteCount > 0 {
		return ErrBookNotEmpty
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM notebook_books WHERE id = ? AND owner_id = ?`, bookID, userID)
	if err != nil {
		return fmt.Errorf("delete notebook book: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrBookNotFound
	}
	return nil
}

type noteWriteState struct {
	BookID    string
	Title     string
	Body      string
	Checklist []ChecklistItem
	Tags      []string
	Pinned    bool
	Favorite  bool
}

func (s *Store) CreateNote(ctx context.Context, userID string, input NoteInput) (Note, error) {
	return s.createNote(ctx, userID, input, nil)
}

func (s *Store) CreateNoteWithDataKey(ctx context.Context, userID string, input NoteInput, dataKey []byte) (Note, error) {
	return s.createNote(ctx, userID, input, dataKey)
}

func (s *Store) createNote(ctx context.Context, userID string, input NoteInput, dataKey []byte) (Note, error) {
	bookID := strings.TrimSpace(input.BookID)
	if bookID == "" {
		books, err := s.ListBooks(ctx, userID)
		if err != nil {
			return Note{}, err
		}
		if len(books) == 0 {
			return Note{}, ErrBookNotFound
		}
		bookID = books[0].ID
	}
	if _, err := s.GetBook(ctx, userID, bookID); err != nil {
		return Note{}, err
	}
	title, body, checklist, tags, err := normalizeNoteContent(input.Title, input.Body, input.Checklist, input.Tags)
	if err != nil {
		return Note{}, err
	}
	if !hasNoteContent(title, body, checklist) {
		return Note{}, ErrInvalidInput
	}
	checklistJSON, err := json.Marshal(checklist)
	if err != nil {
		return Note{}, ErrInvalidInput
	}
	tagsJSON, err := json.Marshal(tags)
	if err != nil {
		return Note{}, ErrInvalidInput
	}
	if input.Encrypted {
		if len(dataKey) == 0 {
			return Note{}, ErrLocked
		}
		if _, err := s.loadSecurityRecord(ctx, userID); err != nil {
			return Note{}, err
		}
	}
	now := time.Now().UTC()
	noteID := uuid.NewString()
	encryptedPayload := ""
	noteKeyEnc := ""
	encryptionVersion := 0
	storedTitle, storedBody, storedChecklistJSON, storedTagsJSON := title, body, string(checklistJSON), string(tagsJSON)
	if input.Encrypted {
		encryptedPayload, noteKeyEnc, err = newNoteEncryption(dataKey, title, body, checklist, tags)
		if err != nil {
			return Note{}, fmt.Errorf("encrypt notebook note: %w", err)
		}
		storedTitle = ""
		storedBody = ""
		storedChecklistJSON = "[]"
		storedTagsJSON = "[]"
		encryptionVersion = NoteEncryptionVersion
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Note{}, fmt.Errorf("begin notebook note: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO notebook_notes (
			id, owner_id, book_id, title, body, checklist_json, tags_json,
			pinned, favorite, encrypted, encrypted_payload, note_key_enc, encryption_version,
			status, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
	`, noteID, userID, bookID, storedTitle, storedBody, storedChecklistJSON, storedTagsJSON,
		boolInt(input.Pinned), boolInt(input.Favorite), boolInt(input.Encrypted), encryptedPayload,
		noteKeyEnc, encryptionVersion, now.UnixMilli(), now.UnixMilli()); err != nil {
		return Note{}, fmt.Errorf("create notebook note: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE notebook_books SET updated_at = ? WHERE id = ? AND owner_id = ?`,
		now.UnixMilli(), bookID, userID); err != nil {
		return Note{}, fmt.Errorf("touch notebook book: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Note{}, fmt.Errorf("commit notebook note: %w", err)
	}
	if input.Encrypted {
		return s.GetNoteWithDataKey(ctx, userID, noteID, dataKey)
	}
	return s.GetNote(ctx, userID, noteID)
}

func (s *Store) UpdateNote(ctx context.Context, userID string, noteID string, patch NotePatch) (Note, error) {
	current, err := s.getNoteRecord(ctx, userID, noteID)
	if err != nil {
		return Note{}, err
	}
	if current.Encrypted || (patch.Encrypted != nil && *patch.Encrypted) {
		return Note{}, ErrLocked
	}
	state, err := s.mergeNotePatch(ctx, userID, current, patch)
	if err != nil {
		return Note{}, err
	}
	if err := s.saveNoteState(ctx, userID, current, state, false, "", "", 0); err != nil {
		return Note{}, err
	}
	return s.GetNote(ctx, userID, noteID)
}

func (s *Store) mergeNotePatch(ctx context.Context, userID string, current Note, patch NotePatch) (noteWriteState, error) {
	state := noteWriteState{
		BookID:    current.BookID,
		Title:     current.Title,
		Body:      current.Body,
		Checklist: current.Checklist,
		Tags:      current.Tags,
		Pinned:    current.Pinned,
		Favorite:  current.Favorite,
	}
	if patch.BookID != nil {
		state.BookID = strings.TrimSpace(*patch.BookID)
		if state.BookID == "" {
			return noteWriteState{}, ErrInvalidInput
		}
		if _, err := s.GetBook(ctx, userID, state.BookID); err != nil {
			return noteWriteState{}, err
		}
	}
	if patch.Title != nil {
		state.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.Body != nil {
		state.Body = strings.TrimSpace(*patch.Body)
	}
	if patch.Checklist != nil {
		state.Checklist = *patch.Checklist
	}
	if patch.Tags != nil {
		state.Tags = *patch.Tags
	}
	if patch.Pinned != nil {
		state.Pinned = *patch.Pinned
	}
	if patch.Favorite != nil {
		state.Favorite = *patch.Favorite
	}
	title, body, checklist, tags, err := normalizeNoteContent(state.Title, state.Body, state.Checklist, state.Tags)
	if err != nil {
		return noteWriteState{}, err
	}
	if !hasNoteContent(title, body, checklist) {
		return noteWriteState{}, ErrInvalidInput
	}
	state.Title = title
	state.Body = body
	state.Checklist = checklist
	state.Tags = tags
	return state, nil
}

func (s *Store) saveNoteState(ctx context.Context, userID string, current Note, state noteWriteState, encrypted bool, encryptedPayload, noteKeyEnc string, encryptionVersion int) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin update notebook note: %w", err)
	}
	defer tx.Rollback()
	if err := s.saveNoteStateTx(ctx, tx, userID, current, state, encrypted, encryptedPayload, noteKeyEnc, encryptionVersion); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit notebook note update: %w", err)
	}
	return nil
}

func (s *Store) saveNoteStateTx(ctx context.Context, tx *sql.Tx, userID string, current Note, state noteWriteState, encrypted bool, encryptedPayload, noteKeyEnc string, encryptionVersion int) error {
	checklistJSON, err := json.Marshal(state.Checklist)
	if err != nil {
		return ErrInvalidInput
	}
	tagsJSON, err := json.Marshal(state.Tags)
	if err != nil {
		return ErrInvalidInput
	}
	title, body := state.Title, state.Body
	storedChecklistJSON, storedTagsJSON := string(checklistJSON), string(tagsJSON)
	if encrypted {
		title = ""
		body = ""
		storedChecklistJSON = "[]"
		storedTagsJSON = "[]"
	}
	now := time.Now().UTC()
	result, err := tx.ExecContext(ctx, `
		UPDATE notebook_notes
		SET book_id = ?, title = ?, body = ?, checklist_json = ?, tags_json = ?,
		    pinned = ?, favorite = ?, encrypted = ?, encrypted_payload = ?, note_key_enc = ?,
		    encryption_version = ?, updated_at = ?
		WHERE id = ? AND owner_id = ? AND status = 'active'
	`, state.BookID, title, body, storedChecklistJSON, storedTagsJSON,
		boolInt(state.Pinned), boolInt(state.Favorite), boolInt(encrypted), encryptedPayload,
		noteKeyEnc, encryptionVersion, now.UnixMilli(), current.ID, userID)
	if err != nil {
		return fmt.Errorf("update notebook note: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNoteNotFound
	}
	if _, err := tx.ExecContext(ctx, `UPDATE notebook_books SET updated_at = ? WHERE id = ? AND owner_id = ?`,
		now.UnixMilli(), state.BookID, userID); err != nil {
		return fmt.Errorf("touch notebook book: %w", err)
	}
	if current.BookID != state.BookID {
		if _, err := tx.ExecContext(ctx, `UPDATE notebook_books SET updated_at = ? WHERE id = ? AND owner_id = ?`,
			now.UnixMilli(), current.BookID, userID); err != nil {
			return fmt.Errorf("touch previous notebook book: %w", err)
		}
	}
	return nil
}

func (s *Store) DeleteNote(ctx context.Context, userID string, noteID string) error {
	note, err := s.GetNote(ctx, userID, noteID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `
		UPDATE notebook_notes SET status = 'deleted', updated_at = ?
		WHERE id = ? AND owner_id = ? AND status = 'active'
	`, now.UnixMilli(), noteID, userID)
	if err != nil {
		return fmt.Errorf("delete notebook note: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNoteNotFound
	}
	_, _ = s.db.ExecContext(ctx, `UPDATE notebook_books SET updated_at = ? WHERE id = ? AND owner_id = ?`,
		now.UnixMilli(), note.BookID, userID)
	return nil
}

func (s *Store) GetNote(ctx context.Context, userID string, noteID string) (Note, error) {
	item, err := s.getNoteRecord(ctx, userID, noteID)
	if err != nil {
		return Note{}, err
	}
	if item.Encrypted {
		return item, nil
	}
	media, err := s.ListMedia(ctx, userID, noteID)
	if err != nil {
		return Note{}, err
	}
	item.Media = media
	return item, nil
}

func (s *Store) GetNoteWithDataKey(ctx context.Context, userID string, noteID string, dataKey []byte) (Note, error) {
	item, err := s.getNoteRecord(ctx, userID, noteID)
	if err != nil {
		return Note{}, err
	}
	if item.Encrypted {
		if len(dataKey) == 0 {
			return Note{}, ErrLocked
		}
		if err := decryptNoteContent(&item, dataKey); err != nil {
			return Note{}, err
		}
	}
	media, err := s.ListMedia(ctx, userID, noteID)
	if err != nil {
		return Note{}, err
	}
	item.Media = media
	return item, nil
}

func (s *Store) getNoteRecord(ctx context.Context, userID string, noteID string) (Note, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT n.id, n.book_id, b.name, b.color, n.title, n.body, n.checklist_json,
		       n.tags_json, n.pinned, n.favorite, n.encrypted, n.encrypted_payload,
		       n.note_key_enc, n.encryption_version, n.created_at, n.updated_at
		FROM notebook_notes n
		JOIN notebook_books b ON b.id = n.book_id AND b.owner_id = n.owner_id
		WHERE n.id = ? AND n.owner_id = ? AND n.status = 'active'
	`, noteID, userID)
	item, err := scanNote(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Note{}, ErrNoteNotFound
	}
	if err != nil {
		return Note{}, err
	}
	return item, nil
}

func (s *Store) ListNotes(ctx context.Context, userID string, filter NoteFilter) (NoteList, error) {
	if err := s.EnsureDefaultBooks(ctx, userID); err != nil {
		return NoteList{}, err
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = DefaultPageSize
	}
	if limit > MaxPageSize {
		limit = MaxPageSize
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	query := `
		SELECT n.id, n.book_id, b.name, b.color, n.title, n.body, n.checklist_json,
		       n.tags_json, n.pinned, n.favorite, n.encrypted, n.encrypted_payload,
		       n.note_key_enc, n.encryption_version, n.created_at, n.updated_at
		FROM notebook_notes n
		JOIN notebook_books b ON b.id = n.book_id AND b.owner_id = n.owner_id
		WHERE n.owner_id = ? AND n.status = 'active'`
	args := []any{userID}
	if bookID := strings.TrimSpace(filter.BookID); bookID != "" {
		query += ` AND n.book_id = ?`
		args = append(args, bookID)
	}
	if filter.Favorite {
		query += ` AND n.favorite = 1`
	}
	if q := strings.TrimSpace(filter.Query); q != "" {
		like := "%" + escapeLike(q) + "%"
		query += ` AND n.encrypted = 0 AND (n.title LIKE ? ESCAPE '\' OR n.body LIKE ? ESCAPE '\' OR n.checklist_json LIKE ? ESCAPE '\' OR n.tags_json LIKE ? ESCAPE '\')`
		args = append(args, like, like, like, like)
	}
	if tag := normalizeTag(filter.Tag); tag != "" {
		like := "%\"" + escapeLike(tag) + "\"%"
		query += ` AND n.encrypted = 0 AND n.tags_json LIKE ? ESCAPE '\'`
		args = append(args, like)
	}
	query += ` ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC LIMIT ? OFFSET ?`
	args = append(args, limit+1, offset)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return NoteList{}, fmt.Errorf("list notebook notes: %w", err)
	}
	defer rows.Close()
	notes := []Note{}
	for rows.Next() {
		item, err := scanNote(rows)
		if err != nil {
			return NoteList{}, err
		}
		item.Media = []Media{}
		notes = append(notes, item)
	}
	if err := rows.Err(); err != nil {
		return NoteList{}, err
	}
	hasMore := len(notes) > limit
	if hasMore {
		notes = notes[:limit]
	}
	return NoteList{Notes: notes, HasMore: hasMore}, nil
}

func (s *Store) ListMedia(ctx context.Context, userID string, noteID string) ([]Media, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id, m.note_id, m.owner_id, m.kind, m.content_type, m.byte_size, m.encrypted, m.stored_name, m.created_at
		FROM notebook_media m
		JOIN notebook_notes n ON n.id = m.note_id AND n.owner_id = m.owner_id
		WHERE m.owner_id = ? AND m.note_id = ? AND n.status = 'active'
		ORDER BY m.created_at ASC, m.id ASC
	`, userID, noteID)
	if err != nil {
		return nil, fmt.Errorf("list notebook media: %w", err)
	}
	defer rows.Close()
	items := []Media{}
	for rows.Next() {
		item, err := scanMedia(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) CountMedia(ctx context.Context, userID string, noteID string, kind string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM notebook_media WHERE owner_id = ? AND note_id = ? AND kind = ?
	`, userID, noteID, kind).Scan(&count); err != nil {
		return 0, fmt.Errorf("count notebook media: %w", err)
	}
	return count, nil
}

func (s *Store) CreateMedia(ctx context.Context, media Media, storedName string) (Media, error) {
	now := time.Now().UTC()
	media.CreatedAt = now
	media.URL = ""
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO notebook_media (id, note_id, owner_id, kind, stored_name, content_type, byte_size, encrypted, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, media.ID, media.NoteID, media.OwnerID, media.Kind, storedName, media.ContentType, media.ByteSize, boolInt(media.Encrypted), now.UnixMilli()); err != nil {
		return Media{}, fmt.Errorf("create notebook media: %w", err)
	}
	return media, nil
}

func (s *Store) GetMedia(ctx context.Context, userID string, mediaID string) (Media, string, error) {
	var item Media
	var storedName string
	var createdAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT m.id, m.note_id, m.owner_id, m.kind, m.content_type, m.byte_size, m.encrypted, m.stored_name, m.created_at
		FROM notebook_media m
		JOIN notebook_notes n ON n.id = m.note_id AND n.owner_id = m.owner_id
		WHERE m.id = ? AND m.owner_id = ? AND n.status = 'active'
	`, mediaID, userID).Scan(&item.ID, &item.NoteID, &item.OwnerID, &item.Kind,
		&item.ContentType, &item.ByteSize, &item.Encrypted, &storedName, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Media{}, "", ErrNotFound
	}
	if err != nil {
		return Media{}, "", fmt.Errorf("get notebook media: %w", err)
	}
	item.CreatedAt = time.UnixMilli(createdAt).UTC()
	return item, storedName, nil
}

func (s *Store) DeleteMedia(ctx context.Context, userID string, mediaID string) (string, error) {
	var storedName string
	err := s.db.QueryRowContext(ctx, `
		SELECT stored_name FROM notebook_media WHERE id = ? AND owner_id = ?
	`, mediaID, userID).Scan(&storedName)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("find notebook media: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM notebook_media WHERE id = ? AND owner_id = ?`, mediaID, userID); err != nil {
		return "", fmt.Errorf("delete notebook media: %w", err)
	}
	return storedName, nil
}

func scanBook(scanner interface{ Scan(...any) error }) (Book, error) {
	var item Book
	var createdAt, updatedAt int64
	if err := scanner.Scan(&item.ID, &item.UserID, &item.Name, &item.Color, &item.SortOrder,
		&createdAt, &updatedAt, &item.NoteCount); err != nil {
		return Book{}, err
	}
	item.CreatedAt = time.UnixMilli(createdAt).UTC()
	item.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	return item, nil
}

type noteScanner interface {
	Scan(...any) error
}

func scanNote(scanner noteScanner) (Note, error) {
	var item Note
	var checklistJSON, tagsJSON string
	var pinned, favorite, encrypted int
	var createdAt, updatedAt int64
	if err := scanner.Scan(&item.ID, &item.BookID, &item.BookName, &item.BookColor,
		&item.Title, &item.Body, &checklistJSON, &tagsJSON, &pinned, &favorite,
		&encrypted, &item.encryptedPayload, &item.noteKeyEnc, &item.encryptionVersion,
		&createdAt, &updatedAt); err != nil {
		return Note{}, err
	}
	if err := json.Unmarshal([]byte(checklistJSON), &item.Checklist); err != nil {
		return Note{}, fmt.Errorf("decode notebook checklist: %w", err)
	}
	if err := json.Unmarshal([]byte(tagsJSON), &item.Tags); err != nil {
		return Note{}, fmt.Errorf("decode notebook tags: %w", err)
	}
	if item.Checklist == nil {
		item.Checklist = []ChecklistItem{}
	}
	if item.Tags == nil {
		item.Tags = []string{}
	}
	item.Pinned = pinned != 0
	item.Favorite = favorite != 0
	item.Encrypted = encrypted != 0
	item.CreatedAt = time.UnixMilli(createdAt).UTC()
	item.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	redactEncryptedNote(&item)
	return item, nil
}

func scanMedia(scanner interface{ Scan(...any) error }) (Media, error) {
	var item Media
	var encrypted int
	var createdAt int64
	if err := scanner.Scan(&item.ID, &item.NoteID, &item.OwnerID, &item.Kind,
		&item.ContentType, &item.ByteSize, &encrypted, &item.StoredName, &createdAt); err != nil {
		return Media{}, err
	}
	item.Encrypted = encrypted != 0
	item.CreatedAt = time.UnixMilli(createdAt).UTC()
	return item, nil
}

func normalizeNoteContent(title, body string, checklist []ChecklistItem, tags []string) (string, string, []ChecklistItem, []string, error) {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(body)
	if utf8.RuneCountInString(title) > MaxNoteTitleRunes || utf8.RuneCountInString(body) > MaxNoteBodyRunes {
		return "", "", nil, nil, ErrInvalidInput
	}
	if len(checklist) > MaxChecklistItems {
		return "", "", nil, nil, ErrInvalidInput
	}
	normalizedChecklist := make([]ChecklistItem, 0, len(checklist))
	ids := map[string]struct{}{}
	for _, item := range checklist {
		text := strings.TrimSpace(item.Text)
		if text == "" {
			continue
		}
		if utf8.RuneCountInString(text) > MaxChecklistRunes {
			return "", "", nil, nil, ErrInvalidInput
		}
		id := strings.TrimSpace(item.ID)
		if id == "" || len(id) > 80 {
			id = uuid.NewString()
		}
		if _, exists := ids[id]; exists {
			id = uuid.NewString()
		}
		ids[id] = struct{}{}
		normalizedChecklist = append(normalizedChecklist, ChecklistItem{ID: id, Text: text, Done: item.Done})
	}
	normalizedTags, err := normalizeTags(tags)
	if err != nil {
		return "", "", nil, nil, err
	}
	return title, body, normalizedChecklist, normalizedTags, nil
}

func normalizeTags(tags []string) ([]string, error) {
	if len(tags) > MaxTags {
		return nil, ErrInvalidInput
	}
	result := make([]string, 0, len(tags))
	seen := map[string]struct{}{}
	for _, raw := range tags {
		tag := normalizeTag(raw)
		if tag == "" {
			continue
		}
		if utf8.RuneCountInString(tag) > MaxTagRunes {
			return nil, ErrInvalidInput
		}
		key := strings.ToLower(tag)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, tag)
	}
	return result, nil
}

func normalizeTag(raw string) string {
	tag := strings.TrimSpace(raw)
	tag = strings.TrimLeft(tag, "#")
	return strings.TrimSpace(tag)
}

func hasNoteContent(title, body string, checklist []ChecklistItem) bool {
	if strings.TrimSpace(title) != "" || strings.TrimSpace(body) != "" {
		return true
	}
	for _, item := range checklist {
		if strings.TrimSpace(item.Text) != "" {
			return true
		}
	}
	return false
}

func validBookName(name string) bool {
	count := utf8.RuneCountInString(name)
	return count >= 1 && count <= MaxBookNameRunes
}

func normalizeColor(color string) string {
	color = strings.TrimSpace(color)
	if colorPattern.MatchString(color) {
		return color
	}
	return DefaultBookColorWork
}

func (s *Store) bookNameExists(ctx context.Context, userID, name, excludeID string) (bool, error) {
	query := `SELECT COUNT(*) FROM notebook_books WHERE owner_id = ? AND name = ?`
	args := []any{userID, name}
	if excludeID != "" {
		query += ` AND id <> ?`
		args = append(args, excludeID)
	}
	var count int
	if err := s.db.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return false, fmt.Errorf("check notebook book name: %w", err)
	}
	return count > 0, nil
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `%`, `\%`)
	value = strings.ReplaceAll(value, `_`, `\_`)
	return value
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
