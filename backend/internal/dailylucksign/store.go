package dailylucksign

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

var (
	ErrInvalidInput      = errors.New("daily luck sign invalid input")
	ErrNotFound          = errors.New("daily luck sign not found")
	ErrDatabasePathEmpty = errors.New("daily luck sign database path is empty")
)

const MaxCompletions = 500

type Store struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, ErrDatabasePathEmpty
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create daily luck sign database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open daily luck sign database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
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
		`CREATE TABLE IF NOT EXISTS daily_luck_sign_completions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			date TEXT NOT NULL,
			rule_id TEXT NOT NULL,
			title TEXT NOT NULL,
			completed_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_daily_luck_sign_completions_user_date
			ON daily_luck_sign_completions(user_id, date)`,
		`CREATE TABLE IF NOT EXISTS daily_luck_sign_settings (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			settings_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS daily_luck_sign_cache (
			cache_key TEXT PRIMARY KEY,
			response_json TEXT NOT NULL,
			fetched_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate daily luck sign: %w", err)
		}
	}
	return nil
}

func (s *Store) ListCompletions(ctx context.Context, userID string) ([]Completion, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, date, rule_id, title, completed_at
		FROM daily_luck_sign_completions
		WHERE user_id = ?
		ORDER BY completed_at DESC, id DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list daily luck sign completions: %w", err)
	}
	defer rows.Close()
	items := make([]Completion, 0)
	for rows.Next() {
		var item Completion
		if err := rows.Scan(&item.ID, &item.Date, &item.RuleID, &item.Title, &item.CompletedAt); err != nil {
			return nil, fmt.Errorf("scan daily luck sign completion: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate daily luck sign completions: %w", err)
	}
	return items, nil
}

func (s *Store) AddCompletion(ctx context.Context, userID string, item Completion) (Completion, error) {
	item.ID = strings.TrimSpace(item.ID)
	item.Date = strings.TrimSpace(item.Date)
	item.RuleID = strings.TrimSpace(item.RuleID)
	item.Title = strings.TrimSpace(item.Title)
	if item.ID == "" {
		item.ID = uuid.NewString()
	}
	if item.Date == "" || item.RuleID == "" || item.Title == "" {
		return Completion{}, fmt.Errorf("%w: completion fields required", ErrInvalidInput)
	}
	if len([]rune(item.Title)) > 80 {
		return Completion{}, fmt.Errorf("%w: completion title too long", ErrInvalidInput)
	}
	if item.CompletedAt == "" {
		item.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO daily_luck_sign_completions (id, user_id, date, rule_id, title, completed_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, item.ID, userID, item.Date, item.RuleID, item.Title, item.CompletedAt); err != nil {
		return Completion{}, fmt.Errorf("add daily luck sign completion: %w", err)
	}
	_, _ = s.db.ExecContext(ctx, `
		DELETE FROM daily_luck_sign_completions
		WHERE user_id = ?
		  AND id NOT IN (
			SELECT id FROM daily_luck_sign_completions
			WHERE user_id = ?
			ORDER BY completed_at DESC, id DESC
			LIMIT ?
		  )
	`, userID, userID, MaxCompletions)
	return item, nil
}

func (s *Store) DeleteCompletion(ctx context.Context, userID, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("%w: completion id required", ErrInvalidInput)
	}
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM daily_luck_sign_completions
		WHERE id = ? AND user_id = ?
	`, id, userID)
	if err != nil {
		return fmt.Errorf("delete daily luck sign completion: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("%w: completion %s", ErrNotFound, id)
	}
	return nil
}

func (s *Store) GetSettings(ctx context.Context, userID string) (Settings, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `
		SELECT settings_json FROM daily_luck_sign_settings WHERE user_id = ?
	`, userID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return Settings{}, nil
	}
	if err != nil {
		return Settings{}, fmt.Errorf("get daily luck sign settings: %w", err)
	}
	var settings Settings
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return Settings{}, fmt.Errorf("decode daily luck sign settings: %w", err)
	}
	return settings, nil
}

func (s *Store) SaveSettings(ctx context.Context, userID string, settings Settings) (Settings, error) {
	if err := ValidateSettings(settings); err != nil {
		return Settings{}, err
	}
	settings.UpdatedAt = time.Now().UnixMilli()
	raw, err := json.Marshal(settings)
	if err != nil {
		return Settings{}, fmt.Errorf("encode daily luck sign settings: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO daily_luck_sign_settings (user_id, settings_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			settings_json = excluded.settings_json,
			updated_at = excluded.updated_at
	`, userID, string(raw), settings.UpdatedAt); err != nil {
		return Settings{}, fmt.Errorf("save daily luck sign settings: %w", err)
	}
	return settings, nil
}

func (s *Store) GetCache(ctx context.Context, key string) (Response, time.Time, error) {
	var raw string
	var fetchedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT response_json, fetched_at FROM daily_luck_sign_cache WHERE cache_key = ?
	`, key).Scan(&raw, &fetchedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Response{}, time.Time{}, nil
	}
	if err != nil {
		return Response{}, time.Time{}, fmt.Errorf("get daily luck sign cache: %w", err)
	}
	var response Response
	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		return Response{}, time.Time{}, fmt.Errorf("decode daily luck sign cache: %w", err)
	}
	return response, time.UnixMilli(fetchedAt), nil
}

func (s *Store) SaveCache(ctx context.Context, key string, response Response) error {
	raw, err := json.Marshal(response)
	if err != nil {
		return fmt.Errorf("encode daily luck sign cache: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO daily_luck_sign_cache (cache_key, response_json, fetched_at)
		VALUES (?, ?, ?)
		ON CONFLICT(cache_key) DO UPDATE SET
			response_json = excluded.response_json,
			fetched_at = excluded.fetched_at
	`, key, string(raw), time.Now().UnixMilli()); err != nil {
		return fmt.Errorf("save daily luck sign cache: %w", err)
	}
	return nil
}

func ValidateSettings(settings Settings) error {
	settings.City = strings.TrimSpace(settings.City)
	if settings.City == "" {
		return fmt.Errorf("%w: city required", ErrInvalidInput)
	}
	if settings.Lat < -90 || settings.Lat > 90 || settings.Lon < -180 || settings.Lon > 180 {
		return fmt.Errorf("%w: invalid coordinates", ErrInvalidInput)
	}
	if settings.Source != "manual" && settings.Source != "system-location" {
		settings.Source = "manual"
	}
	return nil
}
