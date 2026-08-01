package feedback

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("feedback record not found")

type Image struct {
	ID          string
	FeedbackID  string
	StoredName  string
	ContentType string
	SizeBytes   int64
	SortOrder   int
}

type UserSummary struct {
	ID          string
	Username    string
	DisplayName string
	AvatarFile  string
}

type Submission struct {
	ID          string
	Description string
	User        UserSummary
	Images      []Image
	CreatedAt   time.Time
}

type Page struct {
	Items  []Submission
	Total  int
	Limit  int
	Offset int
}

type Store struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*Store, error) {
	if strings.TrimSpace(databasePath) == "" {
		return nil, errors.New("database path is required")
	}

	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}

	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open feedback database: %w", err)
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
	return s.db.Close()
}

func (s *Store) migrate() error {
	statements := []string{
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS feedback_submissions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			description TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_feedback_submissions_created
			ON feedback_submissions(created_at DESC, id DESC)`,
		`CREATE TABLE IF NOT EXISTS feedback_images (
			id TEXT PRIMARY KEY,
			feedback_id TEXT NOT NULL REFERENCES feedback_submissions(id) ON DELETE CASCADE,
			stored_name TEXT NOT NULL,
			content_type TEXT NOT NULL,
			size_bytes INTEGER NOT NULL,
			sort_order INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_feedback_images_feedback
			ON feedback_images(feedback_id, sort_order)`,
	}

	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run feedback database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) Create(
	ctx context.Context,
	userID string,
	description string,
	images []Image,
) (Submission, error) {
	now := time.Now().UTC()
	submissionID := uuid.NewString()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Submission{}, fmt.Errorf("begin feedback transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO feedback_submissions (id, user_id, description, created_at) VALUES (?, ?, ?, ?)`,
		submissionID,
		userID,
		description,
		now.Unix(),
	); err != nil {
		return Submission{}, fmt.Errorf("insert feedback submission: %w", err)
	}

	for _, image := range images {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO feedback_images (
				id, feedback_id, stored_name, content_type, size_bytes, sort_order
			) VALUES (?, ?, ?, ?, ?, ?)`,
			image.ID,
			submissionID,
			image.StoredName,
			image.ContentType,
			image.SizeBytes,
			image.SortOrder,
		); err != nil {
			return Submission{}, fmt.Errorf("insert feedback image: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return Submission{}, fmt.Errorf("commit feedback transaction: %w", err)
	}
	return Submission{
		ID:          submissionID,
		Description: description,
		Images:      images,
		CreatedAt:   now,
	}, nil
}

func (s *Store) List(ctx context.Context, limit, offset int) (Page, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM feedback_submissions`).Scan(&total); err != nil {
		return Page{}, fmt.Errorf("count feedback submissions: %w", err)
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT s.id, s.description, s.created_at, u.id, u.username, u.display_name, u.avatar_file
		 FROM feedback_submissions s
		 JOIN users u ON u.id = s.user_id
		 ORDER BY s.created_at DESC, s.rowid DESC
		 LIMIT ? OFFSET ?`,
		limit,
		offset,
	)
	if err != nil {
		return Page{}, fmt.Errorf("list feedback submissions: %w", err)
	}

	items := make([]Submission, 0, limit)
	feedbackIDs := make([]string, 0, limit)
	for rows.Next() {
		var item Submission
		var createdAt int64
		if err := rows.Scan(
			&item.ID,
			&item.Description,
			&createdAt,
			&item.User.ID,
			&item.User.Username,
			&item.User.DisplayName,
			&item.User.AvatarFile,
		); err != nil {
			rows.Close()
			return Page{}, fmt.Errorf("scan feedback submission: %w", err)
		}
		item.CreatedAt = time.Unix(createdAt, 0).UTC()
		items = append(items, item)
		feedbackIDs = append(feedbackIDs, item.ID)
	}
	if err := rows.Close(); err != nil {
		return Page{}, fmt.Errorf("close feedback submissions: %w", err)
	}
	if err := rows.Err(); err != nil {
		return Page{}, fmt.Errorf("iterate feedback submissions: %w", err)
	}

	imageMap, err := s.imagesForFeedbacks(ctx, feedbackIDs)
	if err != nil {
		return Page{}, err
	}
	for index := range items {
		items[index].Images = imageMap[items[index].ID]
	}

	return Page{Items: items, Total: total, Limit: limit, Offset: offset}, nil
}

func (s *Store) imagesForFeedbacks(ctx context.Context, feedbackIDs []string) (map[string][]Image, error) {
	result := make(map[string][]Image, len(feedbackIDs))
	if len(feedbackIDs) == 0 {
		return result, nil
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(feedbackIDs)), ",")
	args := make([]any, 0, len(feedbackIDs))
	for _, id := range feedbackIDs {
		args = append(args, id)
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, feedback_id, stored_name, content_type, size_bytes, sort_order
		 FROM feedback_images
		 WHERE feedback_id IN (`+placeholders+`)
		 ORDER BY feedback_id, sort_order`,
		args...,
	)
	if err != nil {
		return nil, fmt.Errorf("list feedback images: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var image Image
		if err := rows.Scan(
			&image.ID,
			&image.FeedbackID,
			&image.StoredName,
			&image.ContentType,
			&image.SizeBytes,
			&image.SortOrder,
		); err != nil {
			return nil, fmt.Errorf("scan feedback image: %w", err)
		}
		result[image.FeedbackID] = append(result[image.FeedbackID], image)
	}
	return result, rows.Err()
}

func (s *Store) GetImage(ctx context.Context, feedbackID, imageID string) (Image, error) {
	var image Image
	err := s.db.QueryRowContext(
		ctx,
		`SELECT id, feedback_id, stored_name, content_type, size_bytes, sort_order
		 FROM feedback_images
		 WHERE feedback_id = ? AND id = ?`,
		feedbackID,
		imageID,
	).Scan(
		&image.ID,
		&image.FeedbackID,
		&image.StoredName,
		&image.ContentType,
		&image.SizeBytes,
		&image.SortOrder,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Image{}, ErrNotFound
	}
	if err != nil {
		return Image{}, fmt.Errorf("get feedback image: %w", err)
	}
	return image, nil
}
