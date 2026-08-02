package plantid

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

var ErrDatabasePathEmpty = errors.New("plant id database path is empty")
var ErrHistoryNotFound = errors.New("plant id history not found")

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
			return nil, fmt.Errorf("create plant id database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open plant id database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS plant_id_species_cache (
			gbif_key INTEGER PRIMARY KEY,
			payload_json TEXT NOT NULL,
			fetched_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS plant_id_history (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			gbif_key INTEGER NOT NULL,
			scientific_name TEXT NOT NULL,
			common_name_zh TEXT NOT NULL DEFAULT '',
			family_zh TEXT NOT NULL DEFAULT '',
			score REAL NOT NULL,
			image_url TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_plant_id_history_user
			ON plant_id_history(user_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS plant_id_feedback (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT '',
			identification_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_plant_id_feedback_created
			ON plant_id_feedback(created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run plant id database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) GetSpeciesCache(ctx context.Context, gbifKey int64, maxAge time.Duration) (SpeciesDetail, bool, error) {
	if s == nil || s.db == nil {
		return SpeciesDetail{}, false, nil
	}
	var payload string
	var fetchedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT payload_json, fetched_at FROM plant_id_species_cache WHERE gbif_key = ?
	`, gbifKey).Scan(&payload, &fetchedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return SpeciesDetail{}, false, nil
	}
	if err != nil {
		return SpeciesDetail{}, false, fmt.Errorf("get plant id species cache: %w", err)
	}
	if time.Since(time.Unix(fetchedAt, 0)) > maxAge {
		return SpeciesDetail{}, false, nil
	}
	var detail SpeciesDetail
	if err := json.Unmarshal([]byte(payload), &detail); err != nil {
		return SpeciesDetail{}, false, fmt.Errorf("decode plant id species cache: %w", err)
	}
	return detail, true, nil
}

func (s *Store) PutSpeciesCache(ctx context.Context, detail SpeciesDetail) error {
	if s == nil || s.db == nil {
		return nil
	}
	payload, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("encode plant id species cache: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO plant_id_species_cache (gbif_key, payload_json, fetched_at)
		VALUES (?, ?, ?)
		ON CONFLICT(gbif_key) DO UPDATE SET
			payload_json = excluded.payload_json,
			fetched_at = excluded.fetched_at
	`, detail.GBIFKey, string(payload), time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("save plant id species cache: %w", err)
	}
	return nil
}

func (s *Store) SaveHistory(ctx context.Context, userID string, item HistoryItem) error {
	if s == nil || s.db == nil {
		return nil
	}
	if item.ID == "" {
		item.ID = uuid.NewString()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO plant_id_history
			(id, user_id, gbif_key, scientific_name, common_name_zh, family_zh, score, image_url, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, item.ID, userID, item.GBIFKey, item.ScientificName, item.CommonNameZh, item.FamilyZh,
		item.Score, item.ImageURL, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("save plant id history: %w", err)
	}
	return nil
}

func (s *Store) ListHistory(ctx context.Context, userID string, limit int) ([]HistoryItem, error) {
	if s == nil || s.db == nil {
		return []HistoryItem{}, nil
	}
	if limit <= 0 || limit > 50 {
		limit = 30
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, gbif_key, scientific_name, common_name_zh, family_zh, score, image_url, created_at
		FROM plant_id_history
		WHERE user_id = ?
		ORDER BY created_at DESC
		LIMIT ?
	`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list plant id history: %w", err)
	}
	defer rows.Close()

	items := []HistoryItem{}
	for rows.Next() {
		var item HistoryItem
		var createdAt int64
		if err := rows.Scan(
			&item.ID, &item.GBIFKey, &item.ScientificName, &item.CommonNameZh,
			&item.FamilyZh, &item.Score, &item.ImageURL, &createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan plant id history: %w", err)
		}
		item.CreatedAt = time.Unix(createdAt, 0).UTC().Format(time.RFC3339)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) DeleteHistory(ctx context.Context, userID, id string) error {
	if s == nil || s.db == nil {
		return ErrHistoryNotFound
	}
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM plant_id_history WHERE id = ? AND user_id = ?
	`, id, userID)
	if err != nil {
		return fmt.Errorf("delete plant id history: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete plant id history rows: %w", err)
	}
	if affected == 0 {
		return ErrHistoryNotFound
	}
	return nil
}

func (s *Store) ClearHistory(ctx context.Context, userID string) error {
	if s == nil || s.db == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM plant_id_history WHERE user_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("clear plant id history: %w", err)
	}
	return nil
}

func (s *Store) SaveFeedback(ctx context.Context, userID string, input FeedbackInput) error {
	if s == nil || s.db == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO plant_id_feedback (id, user_id, identification_id, kind, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, uuid.NewString(), userID, input.IdentificationID, input.Kind, input.Note, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("save plant id feedback: %w", err)
	}
	return nil
}
