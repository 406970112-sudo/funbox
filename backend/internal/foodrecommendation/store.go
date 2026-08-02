package foodrecommendation

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

var ErrDatabasePathEmpty = errors.New("food recommendation database path is empty")
var ErrQueryNotFound = errors.New("food recommendation query not found")

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
			return nil, fmt.Errorf("create food recommendation database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open food recommendation database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS food_recommendation_queries (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT '',
			query_text TEXT NOT NULL DEFAULT '',
			city TEXT NOT NULL DEFAULT '',
			district TEXT NOT NULL DEFAULT '',
			response_json TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_food_recommendation_queries_user
			ON food_recommendation_queries(user_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS food_recommendation_feedback (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT '',
			query_id TEXT NOT NULL,
			dish_id TEXT NOT NULL,
			helpful INTEGER NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_food_recommendation_feedback_query
			ON food_recommendation_feedback(query_id, dish_id)`,
		`CREATE TABLE IF NOT EXISTS food_recommendation_favorites (
			user_id TEXT NOT NULL,
			dish_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, dish_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_food_recommendation_favorites_user
			ON food_recommendation_favorites(user_id, created_at DESC)`,
	}

	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run food recommendation database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) SaveQuery(
	ctx context.Context,
	userID string,
	queryID string,
	queryText string,
	city string,
	district string,
	responseJSON string,
) error {
	if queryID == "" {
		return fmt.Errorf("query id is required")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO food_recommendation_queries
			(id, user_id, query_text, city, district, response_json, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, queryID, userID, queryText, city, district, responseJSON, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("save food recommendation query: %w", err)
	}
	return nil
}

func (s *Store) ListQueries(ctx context.Context, userID string, limit int) ([]HistoryItem, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, query_text, city, district, response_json, created_at
		FROM food_recommendation_queries
		WHERE user_id = ?
		ORDER BY created_at DESC, id DESC
		LIMIT ?
	`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list food recommendation queries: %w", err)
	}
	defer rows.Close()

	items := []HistoryItem{}
	for rows.Next() {
		var item HistoryItem
		var responseJSON string
		var createdAt int64
		if err := rows.Scan(&item.QueryID, &item.Query, &item.City, &item.District, &responseJSON, &createdAt); err != nil {
			return nil, fmt.Errorf("scan food recommendation query: %w", err)
		}
		item.CreatedAt = time.Unix(createdAt, 0).UTC().Format(time.RFC3339)
		var response Response
		if err := json.Unmarshal([]byte(responseJSON), &response); err == nil {
			item.Summary = response.Summary
			item.DishCount = len(response.Items)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetQuery(ctx context.Context, userID, queryID string) (Response, error) {
	var responseJSON string
	err := s.db.QueryRowContext(ctx, `
		SELECT response_json
		FROM food_recommendation_queries
		WHERE id = ? AND user_id = ?
	`, queryID, userID).Scan(&responseJSON)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Response{}, ErrQueryNotFound
		}
		return Response{}, fmt.Errorf("load food recommendation query: %w", err)
	}
	var response Response
	if err := json.Unmarshal([]byte(responseJSON), &response); err != nil {
		return Response{}, fmt.Errorf("decode food recommendation query: %w", err)
	}
	return response, nil
}

func (s *Store) SaveFeedback(ctx context.Context, userID string, input FeedbackInput) error {
	if input.QueryID == "" || input.DishID == "" {
		return fmt.Errorf("queryId and dishId are required")
	}
	helpful := 0
	if input.Helpful {
		helpful = 1
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO food_recommendation_feedback
			(id, user_id, query_id, dish_id, helpful, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, uuid.NewString(), userID, input.QueryID, input.DishID, helpful, input.Note, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("save food recommendation feedback: %w", err)
	}
	return nil
}

func (s *Store) ListFavorites(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT dish_id
		FROM food_recommendation_favorites
		WHERE user_id = ?
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list food favorites: %w", err)
	}
	defer rows.Close()

	items := []string{}
	for rows.Next() {
		var dishID string
		if err := rows.Scan(&dishID); err != nil {
			return nil, fmt.Errorf("scan food favorite: %w", err)
		}
		items = append(items, dishID)
	}
	return items, rows.Err()
}

func (s *Store) AddFavorite(ctx context.Context, userID, dishID string) error {
	if dishID == "" {
		return fmt.Errorf("dishId is required")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO food_recommendation_favorites (user_id, dish_id, created_at)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id, dish_id) DO NOTHING
	`, userID, dishID, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("save food favorite: %w", err)
	}
	return nil
}

func (s *Store) RemoveFavorite(ctx context.Context, userID, dishID string) error {
	if dishID == "" {
		return fmt.Errorf("dishId is required")
	}
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM food_recommendation_favorites
		WHERE user_id = ? AND dish_id = ?
	`, userID, dishID); err != nil {
		return fmt.Errorf("remove food favorite: %w", err)
	}
	return nil
}
