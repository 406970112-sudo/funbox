package gooutchecklist

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

	_ "modernc.org/sqlite"
)

var (
	ErrInvalidInput      = errors.New("go out checklist invalid input")
	ErrNotFound          = errors.New("go out checklist not found")
	ErrDatabasePathEmpty = errors.New("go out checklist database path is empty")
)

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
			return nil, fmt.Errorf("create go out checklist database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open go out checklist database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS go_out_checklist_state (
			user_id TEXT PRIMARY KEY,
			state_json TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS go_out_weather_cache (
			cache_key TEXT PRIMARY KEY,
			weather_json TEXT NOT NULL,
			fetched_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate go out checklist: %w", err)
		}
	}
	return nil
}

func EmptyState() State {
	return State{
		SchemaVersion: 1,
		Items:         []Item{},
		Scenes:        []Scene{},
		SceneItems:    []SceneItem{},
		Schedules:     []Schedule{},
		Settings:      Settings{},
		Completions:   []Completion{},
	}
}

func (s *Store) GetState(ctx context.Context, userID string) (State, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `
		SELECT state_json FROM go_out_checklist_state WHERE user_id = ?
	`, userID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return EmptyState(), nil
	}
	if err != nil {
		return State{}, fmt.Errorf("get go out checklist state: %w", err)
	}
	var state State
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return State{}, fmt.Errorf("decode go out checklist state: %w", err)
	}
	return state, nil
}

func (s *Store) SaveState(ctx context.Context, userID string, state State) (State, error) {
	state.SchemaVersion = 1
	state.UpdatedAt = time.Now().UnixMilli()
	encoded, err := json.Marshal(state)
	if err != nil {
		return State{}, fmt.Errorf("encode go out checklist state: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO go_out_checklist_state (user_id, state_json, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			state_json = excluded.state_json,
			updated_at = excluded.updated_at
	`, userID, string(encoded), state.UpdatedAt)
	if err != nil {
		return State{}, fmt.Errorf("save go out checklist state: %w", err)
	}
	return state, nil
}

func (s *Store) ClearState(ctx context.Context, userID string) error {
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM go_out_checklist_state WHERE user_id = ?
	`, userID); err != nil {
		return fmt.Errorf("clear go out checklist state: %w", err)
	}
	return nil
}

func (s *Store) GetWeatherCache(ctx context.Context, key string) (WeatherSnapshot, time.Time, error) {
	var raw string
	var fetchedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT weather_json, fetched_at FROM go_out_weather_cache WHERE cache_key = ?
	`, key).Scan(&raw, &fetchedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return WeatherSnapshot{}, time.Time{}, nil
	}
	if err != nil {
		return WeatherSnapshot{}, time.Time{}, fmt.Errorf("get go out weather cache: %w", err)
	}
	var snapshot WeatherSnapshot
	if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
		return WeatherSnapshot{}, time.Time{}, fmt.Errorf("decode go out weather cache: %w", err)
	}
	return snapshot, time.UnixMilli(fetchedAt), nil
}

func (s *Store) SaveWeatherCache(ctx context.Context, key string, snapshot WeatherSnapshot) error {
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("encode go out weather cache: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO go_out_weather_cache (cache_key, weather_json, fetched_at)
		VALUES (?, ?, ?)
		ON CONFLICT(cache_key) DO UPDATE SET
			weather_json = excluded.weather_json,
			fetched_at = excluded.fetched_at
	`, key, string(encoded), time.Now().UnixMilli())
	if err != nil {
		return fmt.Errorf("save go out weather cache: %w", err)
	}
	return nil
}
