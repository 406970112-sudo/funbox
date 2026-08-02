package diary

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

const (
	argonMemory      = 64 * 1024
	argonIterations  = 4
	argonParallelism = 4
	argonKeyLength   = 32
)

type diarySession struct {
	NotebookID string
	UserID     string
	DataKey    []byte
	ExpiresAt  time.Time
}

type Store struct {
	db       *sql.DB
	mu       sync.Mutex
	sessions map[string]diarySession
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDBPathEmpty
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create diary database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open diary database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{
		db:       db,
		sessions: make(map[string]diarySession),
	}
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
		`CREATE TABLE IF NOT EXISTS diary_notebooks (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 90),
			cover_color TEXT NOT NULL DEFAULT '#4b6bff',
			has_password INTEGER NOT NULL DEFAULT 0,
			password_hash TEXT,
			password_version INTEGER NOT NULL DEFAULT 1,
			key_salt TEXT,
			data_key_enc TEXT,
			reminder_enabled INTEGER NOT NULL DEFAULT 0,
			reminder_time TEXT,
			status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_diary_notebooks_owner
			ON diary_notebooks(owner_id, status, updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS diary_entries (
			id TEXT PRIMARY KEY,
			notebook_id TEXT NOT NULL REFERENCES diary_notebooks(id) ON DELETE CASCADE,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			entry_date TEXT NOT NULL,
			title TEXT,
			content TEXT NOT NULL,
			content_encrypted INTEGER NOT NULL DEFAULT 0,
			mood TEXT,
			weather TEXT,
			status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deleted')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(notebook_id, entry_date)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_diary_entries_date
			ON diary_entries(notebook_id, entry_date)`,
		`CREATE INDEX IF NOT EXISTS idx_diary_entries_owner_created
			ON diary_entries(owner_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS diary_entry_media (
			id TEXT PRIMARY KEY,
			entry_id TEXT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
			stored_name TEXT NOT NULL,
			content_type TEXT NOT NULL,
			width INTEGER NOT NULL DEFAULT 0,
			height INTEGER NOT NULL DEFAULT 0,
			sort_order INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_diary_entry_media
			ON diary_entry_media(entry_id, sort_order)`,
		`CREATE TABLE IF NOT EXISTS diary_security_events (
			id TEXT PRIMARY KEY,
			notebook_id TEXT NOT NULL REFERENCES diary_notebooks(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			action TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_diary_security_events_notebook
			ON diary_security_events(notebook_id, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run diary database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) CreateNotebook(ctx context.Context, userID string, input NotebookInput) (Notebook, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || utf8.RuneCountInString(name) > MaxNotebookNameRunes {
		return Notebook{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	item := Notebook{
		ID:         uuid.NewString(),
		OwnerID:    userID,
		Name:       name,
		CoverColor: normalizeCoverColor(input.CoverColor),
		Status:     NotebookStatusActive,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Notebook{}, fmt.Errorf("begin create diary notebook: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO diary_notebooks (
			id, owner_id, name, cover_color, has_password, password_version,
			reminder_enabled, reminder_time, status, created_at, updated_at
		) VALUES (?, ?, ?, ?, 0, 1, 0, NULL, 'active', ?, ?)
	`, item.ID, userID, name, item.CoverColor, now.UnixMilli(), now.UnixMilli()); err != nil {
		return Notebook{}, fmt.Errorf("insert diary notebook: %w", err)
	}
	if input.Password != nil && strings.TrimSpace(*input.Password) != "" {
		if err := s.setPasswordInTx(ctx, tx, item.ID, userID, "set", "", *input.Password, true); err != nil {
			return Notebook{}, err
		}
	}
	if input.ReminderEnabled != nil {
		item.ReminderEnabled = *input.ReminderEnabled
	}
	if input.ReminderTime != nil {
		item.ReminderTime = normalizeReminderTime(*input.ReminderTime)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE diary_notebooks SET reminder_enabled = ?, reminder_time = ?, updated_at = ?
		WHERE id = ?
	`, boolInt(item.ReminderEnabled), nullableString(item.ReminderTime), now.UnixMilli(), item.ID); err != nil {
		return Notebook{}, fmt.Errorf("update diary notebook reminder: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Notebook{}, fmt.Errorf("commit create diary notebook: %w", err)
	}
	return s.GetNotebook(ctx, userID, item.ID)
}

func (s *Store) ListNotebooks(ctx context.Context, userID string) ([]Notebook, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, owner_id, name, cover_color, has_password, password_version,
		       password_hash, key_salt, data_key_enc,
		       reminder_enabled, reminder_time, status, created_at, updated_at
		FROM diary_notebooks
		WHERE owner_id = ? AND status = 'active'
		ORDER BY updated_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list diary notebooks: %w", err)
	}
	defer rows.Close()
	items := []Notebook{}
	for rows.Next() {
		item, err := scanNotebook(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range items {
		if err := s.enrichNotebook(ctx, &items[i]); err != nil {
			return nil, err
		}
	}
	return items, nil
}

func (s *Store) GetNotebook(ctx context.Context, userID string, notebookID string) (Notebook, error) {
	item, err := s.getNotebook(ctx, userID, notebookID)
	if err != nil {
		return Notebook{}, err
	}
	if item.Status != NotebookStatusActive {
		return Notebook{}, ErrNotFound
	}
	if err := s.enrichNotebook(ctx, &item); err != nil {
		return Notebook{}, err
	}
	return item, nil
}

func (s *Store) UpdateNotebook(ctx context.Context, userID string, notebookID string, input NotebookInput) (Notebook, error) {
	current, err := s.getNotebook(ctx, userID, notebookID)
	if err != nil {
		return Notebook{}, err
	}
	if current.Status != NotebookStatusActive {
		return Notebook{}, ErrNotFound
	}
	if strings.TrimSpace(input.Name) != "" {
		name := strings.TrimSpace(input.Name)
		if utf8.RuneCountInString(name) > MaxNotebookNameRunes {
			return Notebook{}, ErrInvalidInput
		}
		current.Name = name
	}
	if input.CoverColor != "" {
		current.CoverColor = normalizeCoverColor(input.CoverColor)
	}
	if input.ReminderEnabled != nil {
		current.ReminderEnabled = *input.ReminderEnabled
	}
	if input.ReminderTime != nil {
		current.ReminderTime = normalizeReminderTime(*input.ReminderTime)
	}
	current.UpdatedAt = time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE diary_notebooks
		SET name = ?, cover_color = ?, reminder_enabled = ?, reminder_time = ?, updated_at = ?
		WHERE id = ? AND owner_id = ? AND status = 'active'
	`, current.Name, current.CoverColor, boolInt(current.ReminderEnabled),
		nullableString(current.ReminderTime), current.UpdatedAt.UnixMilli(), notebookID, userID); err != nil {
		return Notebook{}, fmt.Errorf("update diary notebook: %w", err)
	}
	return s.GetNotebook(ctx, userID, notebookID)
}

func (s *Store) DeleteNotebook(ctx context.Context, userID string, notebookID string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE diary_notebooks SET status = 'deleted', updated_at = ?
		WHERE id = ? AND owner_id = ? AND status = 'active'
	`, time.Now().UTC().UnixMilli(), notebookID, userID)
	if err != nil {
		return fmt.Errorf("delete diary notebook: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SetPassword(ctx context.Context, userID string, notebookID string, input PasswordInput) (Notebook, error) {
	current, err := s.getNotebook(ctx, userID, notebookID)
	if err != nil {
		return Notebook{}, err
	}
	if current.Status != NotebookStatusActive {
		return Notebook{}, ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Notebook{}, fmt.Errorf("begin diary password transaction: %w", err)
	}
	defer tx.Rollback()
	action := strings.TrimSpace(input.Action)
	if action == "" {
		if current.HasPassword {
			action = "change"
		} else {
			action = "set"
		}
	}
	switch action {
	case "set":
		if current.HasPassword {
			return Notebook{}, ErrPasswordSet
		}
		if err := s.setPasswordInTx(ctx, tx, notebookID, userID, "set", "", input.New, true); err != nil {
			return Notebook{}, err
		}
	case "change":
		if !current.HasPassword {
			return Notebook{}, ErrNoPassword
		}
		if err := s.setPasswordInTx(ctx, tx, notebookID, userID, "change", input.Current, input.New, true); err != nil {
			return Notebook{}, err
		}
	case "remove":
		if !current.HasPassword {
			return Notebook{}, ErrNoPassword
		}
		if err := s.setPasswordInTx(ctx, tx, notebookID, userID, "remove", input.Current, "", true); err != nil {
			return Notebook{}, err
		}
	default:
		return Notebook{}, ErrInvalidInput
	}
	if err := tx.Commit(); err != nil {
		return Notebook{}, fmt.Errorf("commit diary password transaction: %w", err)
	}
	s.Lock(ctx, userID, notebookID, "")
	return s.GetNotebook(ctx, userID, notebookID)
}

func (s *Store) VerifyPassword(ctx context.Context, userID string, notebookID string, password string) error {
	item, err := s.getNotebook(ctx, userID, notebookID)
	if err != nil {
		return err
	}
	if !item.HasPassword || item.PasswordHash == "" {
		return ErrNoPassword
	}
	if err := bcrypt.CompareHashAndPassword([]byte(item.PasswordHash), []byte(password)); err != nil {
		return ErrPasswordMismatch
	}
	return nil
}

func (s *Store) Unlock(ctx context.Context, userID string, notebookID string, password string) (string, error) {
	item, err := s.getNotebook(ctx, userID, notebookID)
	if err != nil {
		return "", err
	}
	if !item.HasPassword {
		return "", ErrNoPassword
	}
	if err := s.VerifyPassword(ctx, userID, notebookID, password); err != nil {
		return "", err
	}
	dataKey, err := s.decryptDataKey(item, password)
	if err != nil {
		return "", err
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", fmt.Errorf("generate diary unlock token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	s.mu.Lock()
	s.sessions[token] = diarySession{
		NotebookID: notebookID,
		UserID:     userID,
		DataKey:    dataKey,
		ExpiresAt:  time.Now().Add(UnlockTTL),
	}
	s.mu.Unlock()
	if err := s.logSecurityEvent(ctx, notebookID, userID, "unlock"); err != nil {
		return "", err
	}
	return token, nil
}

func (s *Store) Lock(ctx context.Context, userID string, notebookID string, token string) error {
	s.mu.Lock()
	for existingToken, session := range s.sessions {
		if session.NotebookID == notebookID && session.UserID == userID && (token == "" || existingToken == token) {
			delete(s.sessions, existingToken)
		}
	}
	s.mu.Unlock()
	if token != "" {
		_ = s.logSecurityEvent(ctx, notebookID, userID, "lock")
	}
	return nil
}

func (s *Store) GetDataKey(ctx context.Context, userID string, notebookID string, token string) ([]byte, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrLocked
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for existingToken, session := range s.sessions {
		if session.ExpiresAt.Before(now) {
			delete(s.sessions, existingToken)
		}
	}
	session, ok := s.sessions[token]
	if !ok || session.NotebookID != notebookID || session.UserID != userID {
		return nil, ErrLocked
	}
	return session.DataKey, nil
}

func (s *Store) UpsertEntry(ctx context.Context, userID string, notebookID string, date string, input EntryInput, dataKey []byte) (Entry, error) {
	notebook, err := s.GetNotebook(ctx, userID, notebookID)
	if err != nil {
		return Entry{}, err
	}
	if notebook.HasPassword && len(dataKey) == 0 {
		return Entry{}, ErrLocked
	}
	title := strings.TrimSpace(input.Title)
	if utf8.RuneCountInString(title) > MaxEntryTitleRunes {
		return Entry{}, ErrInvalidInput
	}
	content := strings.TrimSpace(input.Content)
	if content == "" || utf8.RuneCountInString(content) > MaxEntryContentRunes {
		return Entry{}, ErrInvalidInput
	}
	if !validDate(date) {
		return Entry{}, ErrDateInvalid
	}
	if !validMood(input.Mood) {
		return Entry{}, ErrInvalidInput
	}
	if !validWeather(input.Weather) {
		return Entry{}, ErrInvalidInput
	}
	now := time.Now().UTC()
	entryID := uuid.NewString()
	encrypted := 0
	storedContent := content
	if notebook.HasPassword {
		encoded, err := encryptAESGCM(dataKey, []byte(content))
		if err != nil {
			return Entry{}, fmt.Errorf("encrypt diary entry: %w", err)
		}
		storedContent = encoded
		encrypted = 1
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO diary_entries (
			id, notebook_id, owner_id, entry_date, title, content, content_encrypted,
			mood, weather, status, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
		ON CONFLICT(notebook_id, entry_date) DO UPDATE SET
			title = excluded.title,
			content = excluded.content,
			content_encrypted = excluded.content_encrypted,
			mood = excluded.mood,
			weather = excluded.weather,
			updated_at = excluded.updated_at
	`, entryID, notebookID, userID, date, nullableString(title), storedContent, encrypted,
		nullableString(input.Mood), nullableString(input.Weather), now.UnixMilli(), now.UnixMilli()); err != nil {
		return Entry{}, fmt.Errorf("upsert diary entry: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE diary_notebooks SET updated_at = ? WHERE id = ?
	`, now.UnixMilli(), notebookID); err != nil {
		return Entry{}, fmt.Errorf("touch diary notebook: %w", err)
	}
	return s.GetEntry(ctx, userID, notebookID, date, dataKey)
}

func (s *Store) GetEntry(ctx context.Context, userID string, notebookID string, date string, dataKey []byte) (Entry, error) {
	notebook, err := s.GetNotebook(ctx, userID, notebookID)
	if err != nil {
		return Entry{}, err
	}
	if notebook.HasPassword && len(dataKey) == 0 {
		return Entry{}, ErrLocked
	}
	return s.getEntry(ctx, userID, notebookID, date, notebook.HasPassword, dataKey)
}

func (s *Store) DeleteEntry(ctx context.Context, userID string, notebookID string, date string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE diary_entries SET status = 'deleted', updated_at = ?
		WHERE notebook_id = ? AND owner_id = ? AND entry_date = ? AND status = 'active'
	`, time.Now().UTC().UnixMilli(), notebookID, userID, date)
	if err != nil {
		return fmt.Errorf("delete diary entry: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) Calendar(ctx context.Context, userID string, notebookID string, month string) (CalendarSnapshot, error) {
	if _, err := s.GetNotebook(ctx, userID, notebookID); err != nil {
		return CalendarSnapshot{}, err
	}
	if !validMonth(month) {
		return CalendarSnapshot{}, ErrInvalidInput
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT entry_date, mood, COUNT(*)
		FROM diary_entries
		WHERE notebook_id = ? AND owner_id = ? AND status = 'active'
		  AND substr(entry_date, 1, 7) = ?
		GROUP BY entry_date, mood
		ORDER BY entry_date ASC
	`, notebookID, userID, month)
	if err != nil {
		return CalendarSnapshot{}, fmt.Errorf("list diary calendar: %w", err)
	}
	defer rows.Close()
	snapshot := CalendarSnapshot{Month: month, Days: []DaySummary{}}
	for rows.Next() {
		var day DaySummary
		var mood sql.NullString
		if err := rows.Scan(&day.Date, &mood, &day.Count); err != nil {
			return CalendarSnapshot{}, fmt.Errorf("scan diary calendar: %w", err)
		}
		day.Mood = mood.String
		snapshot.Days = append(snapshot.Days, day)
	}
	return snapshot, rows.Err()
}

func (s *Store) Search(ctx context.Context, userID string, notebookID string, query string, dataKey []byte, limit int) ([]Entry, error) {
	notebook, err := s.GetNotebook(ctx, userID, notebookID)
	if err != nil {
		return nil, err
	}
	if notebook.HasPassword && len(dataKey) == 0 {
		return nil, ErrLocked
	}
	query = strings.TrimSpace(query)
	if query == "" {
		return []Entry{}, nil
	}
	if limit <= 0 || limit > MaxPageSize {
		limit = DefaultPageSize
	}
	entries, err := s.loadAllEntries(ctx, userID, notebookID, notebook.HasPassword, dataKey)
	if err != nil {
		return nil, err
	}
	needle := strings.ToLower(query)
	matched := []Entry{}
	for _, entry := range entries {
		if strings.Contains(strings.ToLower(entry.Title), needle) ||
			strings.Contains(strings.ToLower(entry.Content), needle) {
			matched = append(matched, entry)
			if len(matched) >= limit {
				break
			}
		}
	}
	return matched, nil
}

func (s *Store) Stats(ctx context.Context, userID string, notebookID string) (Stats, error) {
	stats := Stats{
		NotebookID: notebookID,
		Moods:      []MoodCount{},
	}
	var count, monthCount int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(CASE WHEN substr(entry_date, 1, 7) = ? THEN 1 ELSE 0 END), 0)
		FROM diary_entries
		WHERE notebook_id = ? AND owner_id = ? AND status = 'active'
	`, time.Now().UTC().Format("2006-01"), notebookID, userID).Scan(&count, &monthCount); err != nil {
		return Stats{}, fmt.Errorf("count diary stats: %w", err)
	}
	stats.EntryCount = count
	stats.MonthCount = monthCount
	dates, err := s.entryDates(ctx, notebookID)
	if err != nil {
		return Stats{}, err
	}
	stats.CurrentStreak = streak(dates)

	start := time.Now().UTC().AddDate(0, 0, -6).Format("2006-01-02")
	rows, err := s.db.QueryContext(ctx, `
		SELECT entry_date, COUNT(*) FROM diary_entries
		WHERE notebook_id = ? AND owner_id = ? AND status = 'active'
		  AND entry_date >= ?
		GROUP BY entry_date
	`, notebookID, userID, start)
	if err != nil {
		return Stats{}, fmt.Errorf("list diary last7 stats: %w", err)
	}
	defer rows.Close()
	last7 := map[string]int{}
	for rows.Next() {
		var date string
		var dayCount int
		if err := rows.Scan(&date, &dayCount); err != nil {
			return Stats{}, fmt.Errorf("scan diary last7 stats: %w", err)
		}
		last7[date] = dayCount
	}
	if err := rows.Err(); err != nil {
		return Stats{}, err
	}
	for i := 6; i >= 0; i-- {
		date := time.Now().UTC().AddDate(0, 0, -i).Format("2006-01-02")
		stats.Last7Days = append(stats.Last7Days, DayCount{Date: date, Count: last7[date]})
	}

	moodRows, err := s.db.QueryContext(ctx, `
		SELECT COALESCE(mood, ''), COUNT(*) FROM diary_entries
		WHERE notebook_id = ? AND owner_id = ? AND status = 'active'
		GROUP BY COALESCE(mood, '')
	`, notebookID, userID)
	if err != nil {
		return Stats{}, fmt.Errorf("list diary mood stats: %w", err)
	}
	defer moodRows.Close()
	moodCounts := map[string]int{}
	for moodRows.Next() {
		var mood string
		var moodCount int
		if err := moodRows.Scan(&mood, &moodCount); err != nil {
			return Stats{}, fmt.Errorf("scan diary mood stats: %w", err)
		}
		moodCounts[mood] = moodCount
	}
	if err := moodRows.Err(); err != nil {
		return Stats{}, err
	}
	for _, mood := range []string{"happy", "calm", "tired", "sad", "angry"} {
		if moodCounts[mood] > 0 {
			stats.Moods = append(stats.Moods, MoodCount{Mood: mood, Count: moodCounts[mood]})
		}
	}
	return stats, nil
}

func (s *Store) ExportEntries(ctx context.Context, userID string, notebookID string, dataKey []byte) ([]Entry, error) {
	notebook, err := s.GetNotebook(ctx, userID, notebookID)
	if err != nil {
		return nil, err
	}
	if notebook.HasPassword && len(dataKey) == 0 {
		return nil, ErrLocked
	}
	return s.loadAllEntries(ctx, userID, notebookID, notebook.HasPassword, dataKey)
}

func (s *Store) AddMedia(ctx context.Context, entryID string, media Media) error {
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO diary_entry_media (
			id, entry_id, stored_name, content_type, width, height, sort_order
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`, media.ID, entryID, media.StoredName, media.ContentType, media.Width, media.Height, media.SortOrder); err != nil {
		return fmt.Errorf("insert diary media: %w", err)
	}
	return nil
}

func (s *Store) GetEntryID(ctx context.Context, notebookID string, date string) (string, error) {
	var entryID string
	if err := s.db.QueryRowContext(ctx, `
		SELECT id FROM diary_entries
		WHERE notebook_id = ? AND entry_date = ? AND status = 'active'
	`, notebookID, date).Scan(&entryID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("get diary entry id: %w", err)
	}
	return entryID, nil
}

func (s *Store) DeleteMedia(ctx context.Context, userID string, notebookID string, mediaID string) (Media, error) {
	media, err := s.getMedia(ctx, userID, notebookID, mediaID)
	if err != nil {
		return Media{}, err
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM diary_entry_media WHERE id = ?`, mediaID); err != nil {
		return Media{}, fmt.Errorf("delete diary media: %w", err)
	}
	return media, nil
}

func (s *Store) GetMedia(ctx context.Context, userID string, notebookID string, mediaID string) (Media, error) {
	return s.getMedia(ctx, userID, notebookID, mediaID)
}

func (s *Store) getMedia(ctx context.Context, userID string, notebookID string, mediaID string) (Media, error) {
	var media Media
	var entryID string
	if err := s.db.QueryRowContext(ctx, `
		SELECT m.id, m.entry_id, m.stored_name, m.content_type, m.width, m.height, m.sort_order
		FROM diary_entry_media m
		JOIN diary_entries e ON e.id = m.entry_id
		JOIN diary_notebooks n ON n.id = e.notebook_id
		WHERE m.id = ? AND n.id = ? AND n.owner_id = ? AND e.status = 'active'
	`, mediaID, notebookID, userID).Scan(
		&media.ID, &entryID, &media.StoredName, &media.ContentType,
		&media.Width, &media.Height, &media.SortOrder,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Media{}, ErrNotFound
		}
		return Media{}, fmt.Errorf("get diary media: %w", err)
	}
	return media, nil
}

func (s *Store) mediaForEntry(ctx context.Context, entryID string) ([]Media, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, stored_name, content_type, width, height, sort_order
		FROM diary_entry_media
		WHERE entry_id = ?
		ORDER BY sort_order, id
	`, entryID)
	if err != nil {
		return nil, fmt.Errorf("list diary media: %w", err)
	}
	defer rows.Close()
	items := []Media{}
	for rows.Next() {
		var item Media
		if err := rows.Scan(
			&item.ID, &item.StoredName, &item.ContentType,
			&item.Width, &item.Height, &item.SortOrder,
		); err != nil {
			return nil, fmt.Errorf("scan diary media: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) getNotebook(ctx context.Context, userID string, notebookID string) (Notebook, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, owner_id, name, cover_color, has_password, password_version,
		       password_hash, key_salt, data_key_enc,
		       reminder_enabled, reminder_time, status, created_at, updated_at
		FROM diary_notebooks
		WHERE id = ? AND owner_id = ?
	`, notebookID, userID)
	item, err := scanNotebook(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Notebook{}, ErrNotFound
		}
		return Notebook{}, err
	}
	return item, nil
}

func (s *Store) enrichNotebook(ctx context.Context, item *Notebook) error {
	var count int
	var lastDate sql.NullString
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*), MAX(entry_date) FROM diary_entries
		WHERE notebook_id = ? AND status = 'active'
	`, item.ID).Scan(&count, &lastDate); err != nil {
		return fmt.Errorf("count diary entries: %w", err)
	}
	item.EntryCount = count
	item.LastEntryDate = lastDate.String
	dates, err := s.entryDates(ctx, item.ID)
	if err != nil {
		return err
	}
	item.CurrentStreak = streak(dates)
	return nil
}

func (s *Store) entryDates(ctx context.Context, notebookID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT entry_date FROM diary_entries
		WHERE notebook_id = ? AND status = 'active'
	`, notebookID)
	if err != nil {
		return nil, fmt.Errorf("list diary entry dates: %w", err)
	}
	defer rows.Close()
	dates := []string{}
	for rows.Next() {
		var date string
		if err := rows.Scan(&date); err != nil {
			return nil, fmt.Errorf("scan diary entry date: %w", err)
		}
		dates = append(dates, date)
	}
	return dates, rows.Err()
}

func (s *Store) getEntry(ctx context.Context, userID string, notebookID string, date string, encrypted bool, dataKey []byte) (Entry, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, notebook_id, owner_id, entry_date, title, content, content_encrypted,
		       mood, weather, status, created_at, updated_at
		FROM diary_entries
		WHERE notebook_id = ? AND owner_id = ? AND entry_date = ? AND status = 'active'
	`, notebookID, userID, date)
	entry, err := scanEntry(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Entry{}, ErrNotFound
		}
		return Entry{}, err
	}
	if entry.ContentEncrypted {
		plain, err := decryptAESGCM(dataKey, entry.Content)
		if err != nil {
			return Entry{}, fmt.Errorf("decrypt diary entry: %w", err)
		}
		entry.Content = string(plain)
	}
	entry.ContentEncrypted = false
	entry.Media, err = s.mediaForEntry(ctx, entry.ID)
	if err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (s *Store) loadAllEntries(ctx context.Context, userID string, notebookID string, encrypted bool, dataKey []byte) ([]Entry, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, notebook_id, owner_id, entry_date, title, content, content_encrypted,
		       mood, weather, status, created_at, updated_at
		FROM diary_entries
		WHERE notebook_id = ? AND owner_id = ? AND status = 'active'
		ORDER BY entry_date ASC
	`, notebookID, userID)
	if err != nil {
		return nil, fmt.Errorf("list diary entries: %w", err)
	}
	defer rows.Close()
	entries := []Entry{}
	entryIDs := []string{}
	for rows.Next() {
		entry, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
		entryIDs = append(entryIDs, entry.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range entries {
		if entries[i].ContentEncrypted {
			plain, err := decryptAESGCM(dataKey, entries[i].Content)
			if err != nil {
				return nil, fmt.Errorf("decrypt diary entry: %w", err)
			}
			entries[i].Content = string(plain)
		}
		entries[i].ContentEncrypted = false
		entries[i].Media, err = s.mediaForEntry(ctx, entries[i].ID)
		if err != nil {
			return nil, err
		}
	}
	_ = entryIDs
	return entries, nil
}

func (s *Store) setPasswordInTx(
	ctx context.Context,
	tx *sql.Tx,
	notebookID string,
	userID string,
	action string,
	current string,
	next string,
	encryptEntries bool,
) error {
	switch action {
	case "set", "change":
		if !validPassword(next) {
			return ErrPasswordInvalid
		}
	case "remove":
	default:
		return ErrInvalidInput
	}
	var hasPassword int
	var passwordHash, keySalt, dataKeyEnc sql.NullString
	if err := tx.QueryRowContext(ctx, `
		SELECT has_password, password_hash, key_salt, data_key_enc
		FROM diary_notebooks WHERE id = ?
	`, notebookID).Scan(&hasPassword, &passwordHash, &keySalt, &dataKeyEnc); err != nil {
		return fmt.Errorf("read diary password state: %w", err)
	}
	var dataKey []byte
	var err error
	if hasPassword == 1 {
		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(current)); err != nil {
			return ErrPasswordMismatch
		}
		salt, decodeErr := base64.RawStdEncoding.DecodeString(keySalt.String)
		if decodeErr != nil {
			return fmt.Errorf("decode diary key salt: %w", decodeErr)
		}
		dataKey, err = decryptAESGCM(deriveKey(current, salt), dataKeyEnc.String)
		if err != nil {
			return fmt.Errorf("decrypt diary data key: %w", err)
		}
	} else {
		dataKey = make([]byte, 32)
		if _, err := rand.Read(dataKey); err != nil {
			return fmt.Errorf("generate diary data key: %w", err)
		}
	}

	if action == "remove" {
		if encryptEntries {
			if err := s.decryptAllEntries(ctx, tx, notebookID, dataKey); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE diary_notebooks
			SET has_password = 0, password_hash = NULL, key_salt = NULL, data_key_enc = NULL,
			    password_version = 1, updated_at = ?
			WHERE id = ?
		`, time.Now().UTC().UnixMilli(), notebookID); err != nil {
			return fmt.Errorf("clear diary password: %w", err)
		}
		return s.logSecurityEventInTx(ctx, tx, notebookID, userID, "password_removed")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(next), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash diary password: %w", err)
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return fmt.Errorf("generate diary key salt: %w", err)
	}
	key := deriveKey(next, salt)
	encodedDataKey, err := encryptAESGCM(key, dataKey)
	if err != nil {
		return fmt.Errorf("encrypt diary data key: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE diary_notebooks
		SET has_password = 1, password_hash = ?, key_salt = ?, data_key_enc = ?,
		    password_version = 1, updated_at = ?
		WHERE id = ?
	`, string(hash), base64.RawStdEncoding.EncodeToString(salt), encodedDataKey,
		time.Now().UTC().UnixMilli(), notebookID); err != nil {
		return fmt.Errorf("update diary password: %w", err)
	}
	if encryptEntries {
		if err := s.encryptAllEntries(ctx, tx, notebookID, dataKey); err != nil {
			return err
		}
	}
	eventAction := "password_set"
	if action == "change" {
		eventAction = "password_changed"
	}
	return s.logSecurityEventInTx(ctx, tx, notebookID, userID, eventAction)
}

func (s *Store) encryptAllEntries(ctx context.Context, tx *sql.Tx, notebookID string, dataKey []byte) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, content FROM diary_entries
		WHERE notebook_id = ? AND status = 'active' AND content_encrypted = 0
	`, notebookID)
	if err != nil {
		return fmt.Errorf("list diary entries for encryption: %w", err)
	}
	type entryRow struct {
		id      string
		content string
	}
	items := []entryRow{}
	for rows.Next() {
		var item entryRow
		if err := rows.Scan(&item.id, &item.content); err != nil {
			rows.Close()
			return fmt.Errorf("scan diary entry for encryption: %w", err)
		}
		items = append(items, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range items {
		encoded, err := encryptAESGCM(dataKey, []byte(item.content))
		if err != nil {
			return fmt.Errorf("encrypt diary entry: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE diary_entries SET content = ?, content_encrypted = 1
			WHERE id = ?
		`, encoded, item.id); err != nil {
			return fmt.Errorf("update encrypted diary entry: %w", err)
		}
	}
	return nil
}

func (s *Store) decryptAllEntries(ctx context.Context, tx *sql.Tx, notebookID string, dataKey []byte) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, content FROM diary_entries
		WHERE notebook_id = ? AND status = 'active' AND content_encrypted = 1
	`, notebookID)
	if err != nil {
		return fmt.Errorf("list diary entries for decryption: %w", err)
	}
	type entryRow struct {
		id      string
		content string
	}
	items := []entryRow{}
	for rows.Next() {
		var item entryRow
		if err := rows.Scan(&item.id, &item.content); err != nil {
			rows.Close()
			return fmt.Errorf("scan diary entry for decryption: %w", err)
		}
		items = append(items, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range items {
		plain, err := decryptAESGCM(dataKey, item.content)
		if err != nil {
			return fmt.Errorf("decrypt diary entry: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE diary_entries SET content = ?, content_encrypted = 0
			WHERE id = ?
		`, string(plain), item.id); err != nil {
			return fmt.Errorf("update plain diary entry: %w", err)
		}
	}
	return nil
}

func (s *Store) decryptDataKey(item Notebook, password string) ([]byte, error) {
	if item.KeySalt == "" || item.DataKeyEnc == "" {
		return nil, ErrInvalidInput
	}
	salt, err := base64.RawStdEncoding.DecodeString(item.KeySalt)
	if err != nil {
		return nil, fmt.Errorf("decode diary key salt: %w", err)
	}
	return decryptAESGCM(deriveKey(password, salt), item.DataKeyEnc)
}

func (s *Store) logSecurityEvent(ctx context.Context, notebookID string, userID string, action string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO diary_security_events (id, notebook_id, user_id, action, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, uuid.NewString(), notebookID, userID, action, time.Now().UTC().UnixMilli())
	return err
}

func (s *Store) logSecurityEventInTx(ctx context.Context, tx *sql.Tx, notebookID string, userID string, action string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO diary_security_events (id, notebook_id, user_id, action, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, uuid.NewString(), notebookID, userID, action, time.Now().UTC().UnixMilli())
	return err
}

func scanNotebook(row interface{ Scan(...any) error }) (Notebook, error) {
	var item Notebook
	var hasPassword, reminderEnabled int
	var passwordHash, keySalt, dataKeyEnc sql.NullString
	var reminderTime sql.NullString
	var createdAt, updatedAt int64
	if err := row.Scan(
		&item.ID, &item.OwnerID, &item.Name, &item.CoverColor, &hasPassword,
		&item.PasswordVersion, &passwordHash, &keySalt, &dataKeyEnc,
		&reminderEnabled, &reminderTime, &item.Status, &createdAt, &updatedAt,
	); err != nil {
		return Notebook{}, err
	}
	item.PasswordHash = passwordHash.String
	item.KeySalt = keySalt.String
	item.DataKeyEnc = dataKeyEnc.String
	item.HasPassword = hasPassword == 1
	item.ReminderEnabled = reminderEnabled == 1
	item.ReminderTime = reminderTime.String
	item.CreatedAt = time.UnixMilli(createdAt).UTC()
	item.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	return item, nil
}

func scanEntry(row interface{ Scan(...any) error }) (Entry, error) {
	var item Entry
	var title, mood, weather sql.NullString
	var contentEncrypted int
	var createdAt, updatedAt int64
	if err := row.Scan(
		&item.ID, &item.NotebookID, &item.OwnerID, &item.EntryDate, &title,
		&item.Content, &contentEncrypted, &mood, &weather, &item.Status,
		&createdAt, &updatedAt,
	); err != nil {
		return Entry{}, err
	}
	item.Title = title.String
	item.Mood = mood.String
	item.Weather = weather.String
	item.ContentEncrypted = contentEncrypted == 1
	item.CreatedAt = time.UnixMilli(createdAt).UTC()
	item.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	return item, nil
}

func deriveKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)
}

func encryptAESGCM(key []byte, plaintext []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func decryptAESGCM(key []byte, encoded string) ([]byte, error) {
	sealed, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonceSize := gcm.NonceSize()
	if len(sealed) < nonceSize {
		return nil, errors.New("invalid diary ciphertext")
	}
	return gcm.Open(nil, sealed[:nonceSize], sealed[nonceSize:], nil)
}

func normalizeCoverColor(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "#4b6bff"
	}
	return value
}

func normalizeReminderTime(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return value
}

func validPassword(value string) bool {
	length := utf8.RuneCountInString(value)
	return length >= MinPasswordRunes && length <= MaxPasswordRunes
}

func validDate(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}

func validMonth(value string) bool {
	_, err := time.Parse("2006-01", value)
	return err == nil
}

func validMood(value string) bool {
	if value == "" {
		return true
	}
	switch value {
	case "happy", "calm", "tired", "sad", "angry":
		return true
	default:
		return false
	}
}

func validWeather(value string) bool {
	if value == "" {
		return true
	}
	switch value {
	case "sunny", "cloudy", "rainy", "windy":
		return true
	default:
		return false
	}
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}

func streak(dates []string) int {
	if len(dates) == 0 {
		return 0
	}
	set := make(map[string]bool, len(dates))
	for _, date := range dates {
		set[date] = true
	}
	cursor := time.Now().UTC()
	if !set[cursor.Format("2006-01-02")] {
		cursor = cursor.AddDate(0, 0, -1)
		if !set[cursor.Format("2006-01-02")] {
			return 0
		}
	}
	count := 0
	for set[cursor.Format("2006-01-02")] {
		count++
		cursor = cursor.AddDate(0, 0, -1)
	}
	return count
}

func entryDates(entries []Entry) []string {
	dates := make([]string, 0, len(entries))
	for _, entry := range entries {
		dates = append(dates, entry.EntryDate)
	}
	return dates
}

func sortedDates(dates []string) []string {
	result := append([]string{}, dates...)
	sort.Strings(result)
	return result
}
