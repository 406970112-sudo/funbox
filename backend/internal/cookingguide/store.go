package cookingguide

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

var ErrDatabasePathEmpty = errors.New("cooking guide database path is empty")
var ErrContributionNotFound = errors.New("cooking guide contribution not found")

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
			return nil, fmt.Errorf("create cooking guide database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open cooking guide database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS cooking_guide_sessions (
			user_id TEXT NOT NULL,
			dish_id TEXT NOT NULL,
			step_index INTEGER NOT NULL DEFAULT 0,
			total_steps INTEGER NOT NULL DEFAULT 0,
			completed INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, dish_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_cooking_guide_sessions_user
			ON cooking_guide_sessions(user_id, updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS cooking_guide_views (
			user_id TEXT NOT NULL,
			dish_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, dish_id)
		)`,
		`CREATE TABLE IF NOT EXISTS cooking_guide_favorites (
			user_id TEXT NOT NULL,
			dish_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (user_id, dish_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_cooking_guide_favorites_user
			ON cooking_guide_favorites(user_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS cooking_guide_feedback (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL DEFAULT '',
			dish_id TEXT NOT NULL,
			helpful INTEGER NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_cooking_guide_feedback_dish
			ON cooking_guide_feedback(dish_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS cooking_guide_contributions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			payload_json TEXT NOT NULL,
			review_note TEXT NOT NULL DEFAULT '',
			reviewed_by TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			reviewed_at INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_cooking_guide_contributions_status
			ON cooking_guide_contributions(status, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run cooking guide database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) UpsertSession(ctx context.Context, userID string, session Session) (Session, error) {
	completed := 0
	if session.Completed {
		completed = 1
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO cooking_guide_sessions
			(user_id, dish_id, step_index, total_steps, completed, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, dish_id) DO UPDATE SET
			step_index = excluded.step_index,
			total_steps = excluded.total_steps,
			completed = excluded.completed,
			updated_at = excluded.updated_at
	`, userID, session.DishID, session.StepIndex, session.TotalSteps, completed, time.Now().UTC().Unix())
	if err != nil {
		return Session{}, fmt.Errorf("save cooking guide session: %w", err)
	}
	return session, nil
}

func (s *Store) RecordView(ctx context.Context, userID, dishID string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO cooking_guide_views (user_id, dish_id, created_at)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id, dish_id) DO UPDATE SET created_at = excluded.created_at
	`, userID, dishID, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("record cooking guide view: %w", err)
	}
	return nil
}

func (s *Store) ListHistory(ctx context.Context, userID string, limit int) ([]HistoryItem, error) {
	if limit <= 0 || limit > 50 {
		limit = 30
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT dish_id, 'view', created_at FROM cooking_guide_views WHERE user_id = ?
		UNION ALL
		SELECT dish_id, 'session', updated_at FROM cooking_guide_sessions WHERE user_id = ?
		UNION ALL
		SELECT dish_id, 'favorite', created_at FROM cooking_guide_favorites WHERE user_id = ?
		ORDER BY created_at DESC
		LIMIT ?
	`, userID, userID, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list cooking guide history: %w", err)
	}
	defer rows.Close()

	items := []HistoryItem{}
	seen := map[string]bool{}
	for rows.Next() {
		var item HistoryItem
		var createdAt int64
		if err := rows.Scan(&item.DishID, &item.Kind, &createdAt); err != nil {
			return nil, fmt.Errorf("scan cooking guide history: %w", err)
		}
		if seen[item.DishID] {
			continue
		}
		seen[item.DishID] = true
		item.CreatedAt = time.Unix(createdAt, 0).UTC().Format(time.RFC3339)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) SaveFeedback(ctx context.Context, userID string, input FeedbackInput) error {
	helpful := 0
	if input.Helpful {
		helpful = 1
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO cooking_guide_feedback (id, user_id, dish_id, helpful, note, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, uuid.NewString(), userID, input.DishID, helpful, input.Note, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("save cooking guide feedback: %w", err)
	}
	return nil
}

func (s *Store) ListFavorites(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT dish_id FROM cooking_guide_favorites
		WHERE user_id = ?
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list cooking guide favorites: %w", err)
	}
	defer rows.Close()

	items := []string{}
	for rows.Next() {
		var dishID string
		if err := rows.Scan(&dishID); err != nil {
			return nil, fmt.Errorf("scan cooking guide favorite: %w", err)
		}
		items = append(items, dishID)
	}
	return items, rows.Err()
}

func (s *Store) AddFavorite(ctx context.Context, userID, dishID string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO cooking_guide_favorites (user_id, dish_id, created_at)
		VALUES (?, ?, ?)
		ON CONFLICT(user_id, dish_id) DO NOTHING
	`, userID, dishID, time.Now().UTC().Unix())
	if err != nil {
		return fmt.Errorf("save cooking guide favorite: %w", err)
	}
	return nil
}

func (s *Store) RemoveFavorite(ctx context.Context, userID, dishID string) error {
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM cooking_guide_favorites WHERE user_id = ? AND dish_id = ?
	`, userID, dishID); err != nil {
		return fmt.Errorf("remove cooking guide favorite: %w", err)
	}
	return nil
}

func (s *Store) CreateContribution(ctx context.Context, userID string, input ContributionInput) (Contribution, error) {
	payload, err := json.Marshal(input)
	if err != nil {
		return Contribution{}, fmt.Errorf("encode cooking guide contribution: %w", err)
	}
	contribution := Contribution{
		ID:           uuid.NewString(),
		Status:       ContributionPending,
		Name:         input.Name,
		NameZh:       input.NameZh,
		Area:         input.Area,
		Category:     input.Category,
		ImageURL:     input.ImageURL,
		RecipeSource: input.RecipeSource,
		Ingredients:  append([]string(nil), input.Ingredients...),
		Steps:        append([]string(nil), input.Steps...),
		CreatedAt:    nowISO(),
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO cooking_guide_contributions
			(id, user_id, status, payload_json, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, contribution.ID, userID, ContributionPending, string(payload), time.Now().UTC().Unix())
	if err != nil {
		return Contribution{}, fmt.Errorf("save cooking guide contribution: %w", err)
	}
	return contribution, nil
}

func (s *Store) ListContributions(ctx context.Context, status string) ([]Contribution, error) {
	query := `
		SELECT id, user_id, status, payload_json, review_note, created_at, reviewed_at
		FROM cooking_guide_contributions
	`
	args := []any{}
	if status != "" {
		query += " WHERE status = ?"
		args = append(args, status)
	}
	query += " ORDER BY created_at DESC"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list cooking guide contributions: %w", err)
	}
	defer rows.Close()

	items := []Contribution{}
	for rows.Next() {
		var item Contribution
		var payloadJSON string
		var userID, reviewNote string
		var createdAt, reviewedAt int64
		if err := rows.Scan(&item.ID, &userID, &item.Status, &payloadJSON, &reviewNote, &createdAt, &reviewedAt); err != nil {
			return nil, fmt.Errorf("scan cooking guide contribution: %w", err)
		}
		var input ContributionInput
		if err := json.Unmarshal([]byte(payloadJSON), &input); err == nil {
			item.Name = input.Name
			item.NameZh = input.NameZh
			item.Area = input.Area
			item.Category = input.Category
			item.ImageURL = input.ImageURL
			item.RecipeSource = input.RecipeSource
			item.Ingredients = input.Ingredients
			item.Steps = input.Steps
		}
		item.ReviewNote = reviewNote
		item.CreatedAt = time.Unix(createdAt, 0).UTC().Format(time.RFC3339)
		if reviewedAt > 0 {
			item.ReviewedAt = time.Unix(reviewedAt, 0).UTC().Format(time.RFC3339)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) UpdateContributionStatus(ctx context.Context, contributionID, status, reviewerID, note string) (Contribution, error) {
	var payloadJSON, reviewNote string
	var createdAt, reviewedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, payload_json, review_note, created_at, reviewed_at
		FROM cooking_guide_contributions WHERE id = ?
	`, contributionID).Scan(&contributionID, &payloadJSON, &reviewNote, &createdAt, &reviewedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Contribution{}, ErrContributionNotFound
		}
		return Contribution{}, fmt.Errorf("load cooking guide contribution: %w", err)
	}
	now := time.Now().UTC().Unix()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE cooking_guide_contributions
		SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?
		WHERE id = ?
	`, status, note, reviewerID, now, contributionID); err != nil {
		return Contribution{}, fmt.Errorf("update cooking guide contribution: %w", err)
	}

	var input ContributionInput
	_ = json.Unmarshal([]byte(payloadJSON), &input)
	return Contribution{
		ID:           contributionID,
		Status:       status,
		Name:         input.Name,
		NameZh:       input.NameZh,
		Area:         input.Area,
		Category:     input.Category,
		ImageURL:     input.ImageURL,
		RecipeSource: input.RecipeSource,
		Ingredients:  input.Ingredients,
		Steps:        input.Steps,
		CreatedAt:    time.Unix(createdAt, 0).UTC().Format(time.RFC3339),
		ReviewedAt:   time.Unix(now, 0).UTC().Format(time.RFC3339),
		ReviewNote:   note,
	}, nil
}
