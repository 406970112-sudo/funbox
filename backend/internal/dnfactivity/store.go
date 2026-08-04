package dnfactivity

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

type activityRow struct {
	ID          string
	SourceID    string
	Title       string
	StartDate   string
	EndDate     string
	MobileURL   string
	PCURL       string
	MobileImage string
	PCImage     string
	Description string
	FetchedAt   time.Time
}

type Store struct {
	db *sql.DB
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, fmt.Errorf("dnf activity database path empty")
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create dnf activity database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open dnf activity database: %w", err)
	}
	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS dnf_activities (
			id TEXT PRIMARY KEY,
			source_id TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL,
			start_date TEXT NOT NULL DEFAULT '',
			end_date TEXT NOT NULL DEFAULT '',
			mobile_url TEXT NOT NULL DEFAULT '',
			pc_url TEXT NOT NULL DEFAULT '',
			mobile_image TEXT NOT NULL DEFAULT '',
			pc_image TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '',
			fetched_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS dnf_activity_favorites (
			user_id TEXT NOT NULL,
			activity_id TEXT NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (user_id, activity_id)
		)`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(context.Background(), statement); err != nil {
			return fmt.Errorf("migrate dnf activity database: %w", err)
		}
	}
	return nil
}

func (s *Store) ReplaceActivities(ctx context.Context, rows []activityRow) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM dnf_activities`); err != nil {
		return err
	}
	statement, err := tx.PrepareContext(ctx, `
		INSERT INTO dnf_activities (
			id, source_id, title, start_date, end_date, mobile_url, pc_url, mobile_image, pc_image, description, fetched_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer statement.Close()
	for _, row := range rows {
		id := row.ID
		if id == "" {
			id = uuid.NewString()
		}
		if _, err := statement.ExecContext(ctx,
			id,
			row.SourceID,
			row.Title,
			row.StartDate,
			row.EndDate,
			row.MobileURL,
			row.PCURL,
			row.MobileImage,
			row.PCImage,
			row.Description,
			row.FetchedAt.Format(time.RFC3339),
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListActivities(ctx context.Context) ([]activityRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, source_id, title, start_date, end_date, mobile_url, pc_url, mobile_image, pc_image, description, fetched_at
		FROM dnf_activities ORDER BY fetched_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]activityRow, 0)
	for rows.Next() {
		row, err := scanActivityRow(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (s *Store) GetActivity(ctx context.Context, id string) (activityRow, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, source_id, title, start_date, end_date, mobile_url, pc_url, mobile_image, pc_image, description, fetched_at
		FROM dnf_activities WHERE id = ?`, id)
	item, err := scanActivityRow(row)
	if err == sql.ErrNoRows {
		return activityRow{}, ErrNotFound
	}
	return item, err
}

func (s *Store) UpdateDescription(ctx context.Context, id string, description string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE dnf_activities SET description = ? WHERE id = ?`, description, id)
	return err
}

func (s *Store) AddFavorite(ctx context.Context, userID string, activityID string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT OR IGNORE INTO dnf_activity_favorites (user_id, activity_id, created_at)
		VALUES (?, ?, ?)`, userID, activityID, time.Now().Format(time.RFC3339))
	return err
}

func (s *Store) RemoveFavorite(ctx context.Context, userID string, activityID string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM dnf_activity_favorites WHERE user_id = ? AND activity_id = ?`, userID, activityID)
	return err
}

func (s *Store) CountFavorites(ctx context.Context, userID string) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM dnf_activity_favorites WHERE user_id = ?`, userID).Scan(&count)
	return count, err
}

func (s *Store) ListFavoriteIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT activity_id FROM dnf_activity_favorites WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}

func scanActivityRow(scanner interface {
	Scan(...any) error
}) (activityRow, error) {
	var row activityRow
	var fetchedAt string
	err := scanner.Scan(
		&row.ID,
		&row.SourceID,
		&row.Title,
		&row.StartDate,
		&row.EndDate,
		&row.MobileURL,
		&row.PCURL,
		&row.MobileImage,
		&row.PCImage,
		&row.Description,
		&fetchedAt,
	)
	if err != nil {
		return activityRow{}, err
	}
	if parsed, parseErr := time.Parse(time.RFC3339, fetchedAt); parseErr == nil {
		row.FetchedAt = parsed
	}
	return row, nil
}
