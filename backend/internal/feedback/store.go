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
	ID             string
	Kind           string
	Title          string
	Category       string
	Description    string
	Status         string
	AdminReply     string
	AdminUserID    string
	User           UserSummary
	Images         []Image
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ProcessedAt    *time.Time
	ReplyUpdatedAt *time.Time
	UserReadAt     *time.Time
}

type Page struct {
	Items  []Submission
	Total  int
	Limit  int
	Offset int
}

type ListOptions struct {
	ID                string
	Kind              string
	Status            string
	Query             string
	UserID            string
	NotificationsOnly bool
	Limit             int
	Offset            int
}

type Store struct {
	db *sql.DB
}

type rowScanner interface {
	Scan(...any) error
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
	if err := s.ensureFeedbackColumns(); err != nil {
		return err
	}
	return nil
}

func (s *Store) ensureFeedbackColumns() error {
	rows, err := s.db.Query(`PRAGMA table_info(feedback_submissions)`)
	if err != nil {
		return fmt.Errorf("read feedback table info: %w", err)
	}
	columns := make(map[string]bool)
	for rows.Next() {
		var cid int
		var name string
		var columnType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			rows.Close()
			return fmt.Errorf("scan feedback table info: %w", err)
		}
		columns[name] = true
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close feedback table info: %w", err)
	}

	additions := []struct {
		name string
		ddl  string
	}{
		{name: "kind", ddl: `ALTER TABLE feedback_submissions ADD COLUMN kind TEXT NOT NULL DEFAULT 'problem'`},
		{name: "title", ddl: `ALTER TABLE feedback_submissions ADD COLUMN title TEXT`},
		{name: "category", ddl: `ALTER TABLE feedback_submissions ADD COLUMN category TEXT`},
		{name: "status", ddl: `ALTER TABLE feedback_submissions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`},
		{name: "admin_reply", ddl: `ALTER TABLE feedback_submissions ADD COLUMN admin_reply TEXT`},
		{name: "admin_user_id", ddl: `ALTER TABLE feedback_submissions ADD COLUMN admin_user_id TEXT`},
		{name: "processed_at", ddl: `ALTER TABLE feedback_submissions ADD COLUMN processed_at INTEGER`},
		{name: "reply_updated_at", ddl: `ALTER TABLE feedback_submissions ADD COLUMN reply_updated_at INTEGER`},
		{name: "user_read_at", ddl: `ALTER TABLE feedback_submissions ADD COLUMN user_read_at INTEGER`},
		{name: "updated_at", ddl: `ALTER TABLE feedback_submissions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`},
	}
	for _, addition := range additions {
		if columns[addition.name] {
			continue
		}
		if _, err := s.db.Exec(addition.ddl); err != nil {
			return fmt.Errorf("add feedback column %s: %w", addition.name, err)
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
	return s.CreateWithType(ctx, userID, "problem", "", "", description, images)
}

func (s *Store) CreateWithType(
	ctx context.Context,
	userID string,
	kind string,
	title string,
	category string,
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
		`INSERT INTO feedback_submissions (
			id, user_id, kind, title, category, description, status, updated_at, created_at
		) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
		submissionID,
		userID,
		kind,
		title,
		category,
		description,
		now.UnixMilli(),
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
		Kind:        kind,
		Title:       title,
		Category:    category,
		Description: description,
		Status:      "pending",
		Images:      images,
		CreatedAt:   now,
		UpdatedAt:   now,
	}, nil
}

func (s *Store) List(ctx context.Context, limit, offset int) (Page, error) {
	return s.ListFiltered(ctx, ListOptions{Limit: limit, Offset: offset})
}

func (s *Store) ListByUser(ctx context.Context, userID string, limit, offset int) (Page, error) {
	return s.ListFiltered(ctx, ListOptions{UserID: userID, Limit: limit, Offset: offset})
}

func (s *Store) ListNotifications(ctx context.Context, userID string, limit, offset int) (Page, error) {
	return s.ListFiltered(ctx, ListOptions{
		UserID:            userID,
		NotificationsOnly: true,
		Limit:             limit,
		Offset:            offset,
	})
}

func (s *Store) ListFiltered(ctx context.Context, opts ListOptions) (Page, error) {
	if opts.Limit <= 0 {
		opts.Limit = 30
	}
	if opts.Limit > 100 {
		opts.Limit = 100
	}
	if opts.Offset < 0 {
		opts.Offset = 0
	}

	where, args := s.feedbackWhere(opts)
	var total int
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM feedback_submissions s
		 JOIN users u ON u.id = s.user_id
		 WHERE `+where,
		args...,
	).Scan(&total); err != nil {
		return Page{}, fmt.Errorf("count feedback submissions: %w", err)
	}

	queryArgs := append(append([]any{}, args...), opts.Limit, opts.Offset)
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT s.id, s.kind, s.title, s.category, s.description, s.status,
		        s.admin_reply, s.admin_user_id,
		        s.processed_at, s.reply_updated_at, s.user_read_at,
		        s.created_at, s.updated_at,
		        u.id, u.username, u.display_name, u.avatar_file
		 FROM feedback_submissions s
		 JOIN users u ON u.id = s.user_id
		 WHERE `+where+`
		 ORDER BY s.created_at DESC, s.rowid DESC
		 LIMIT ? OFFSET ?`,
		queryArgs...,
	)
	if err != nil {
		return Page{}, fmt.Errorf("list feedback submissions: %w", err)
	}

	items := make([]Submission, 0, opts.Limit)
	feedbackIDs := make([]string, 0, opts.Limit)
	for rows.Next() {
		item, err := scanFeedbackSubmission(rows)
		if err != nil {
			rows.Close()
			return Page{}, err
		}
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

	return Page{Items: items, Total: total, Limit: opts.Limit, Offset: opts.Offset}, nil
}

func (s *Store) Get(ctx context.Context, feedbackID string) (Submission, error) {
	page, err := s.ListFiltered(ctx, ListOptions{ID: feedbackID, Limit: 1})
	if err != nil {
		return Submission{}, err
	}
	if len(page.Items) == 0 {
		return Submission{}, ErrNotFound
	}
	return page.Items[0], nil
}

func (s *Store) GetByUser(ctx context.Context, userID string, feedbackID string) (Submission, error) {
	page, err := s.ListFiltered(ctx, ListOptions{UserID: userID, ID: feedbackID, Limit: 1})
	if err != nil {
		return Submission{}, err
	}
	if len(page.Items) == 0 {
		return Submission{}, ErrNotFound
	}
	return page.Items[0], nil
}

func (s *Store) UnreadCount(ctx context.Context, userID string) (int, error) {
	var count int
	err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM feedback_submissions
		 WHERE user_id = ?
		   AND status = 'resolved'
		   AND admin_reply IS NOT NULL
		   AND admin_reply <> ''
		   AND COALESCE(reply_updated_at, 0) > COALESCE(user_read_at, 0)`,
		userID,
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count feedback notifications: %w", err)
	}
	return count, nil
}

func (s *Store) MarkNotificationsRead(ctx context.Context, userID string, feedbackIDs []string) error {
	now := time.Now().UTC().UnixMilli()
	if len(feedbackIDs) == 0 {
		if _, err := s.db.ExecContext(
			ctx,
			`UPDATE feedback_submissions SET user_read_at = ?
			 WHERE user_id = ? AND status = 'resolved'`,
			now,
			userID,
		); err != nil {
			return fmt.Errorf("mark feedback notifications read: %w", err)
		}
		return nil
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(feedbackIDs)), ",")
	args := make([]any, 0, len(feedbackIDs)+2)
	args = append(args, now, userID)
	for _, id := range feedbackIDs {
		args = append(args, id)
	}
	if _, err := s.db.ExecContext(
		ctx,
		`UPDATE feedback_submissions SET user_read_at = ?
		 WHERE user_id = ? AND id IN (`+placeholders+`)`,
		args...,
	); err != nil {
		return fmt.Errorf("mark feedback notification read: %w", err)
	}
	return nil
}

func (s *Store) Resolve(
	ctx context.Context,
	feedbackID string,
	adminUserID string,
	status string,
	reply string,
) (Submission, error) {
	now := time.Now().UTC().UnixMilli()
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE feedback_submissions
		 SET status = ?,
		     admin_user_id = ?,
		     admin_reply = CASE WHEN ? = 'resolved' THEN ? ELSE admin_reply END,
		     processed_at = CASE WHEN ? = 'resolved' THEN COALESCE(processed_at, ?) ELSE processed_at END,
		     reply_updated_at = CASE WHEN ? = 'resolved' THEN ? ELSE reply_updated_at END,
		     user_read_at = CASE WHEN ? = 'resolved' THEN NULL ELSE user_read_at END,
		     updated_at = ?
		 WHERE id = ?`,
		status,
		adminUserID,
		status,
		reply,
		status,
		now,
		status,
		now,
		status,
		now,
		feedbackID,
	)
	if err != nil {
		return Submission{}, fmt.Errorf("resolve feedback submission: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Submission{}, fmt.Errorf("resolve feedback rows affected: %w", err)
	}
	if affected == 0 {
		return Submission{}, ErrNotFound
	}
	return s.Get(ctx, feedbackID)
}

func (s *Store) feedbackWhere(opts ListOptions) (string, []any) {
	clauses := make([]string, 0, 5)
	args := make([]any, 0, 5)
	if opts.ID != "" {
		clauses = append(clauses, "s.id = ?")
		args = append(args, opts.ID)
	}
	if opts.UserID != "" {
		clauses = append(clauses, "s.user_id = ?")
		args = append(args, opts.UserID)
	}
	if opts.Kind != "" {
		clauses = append(clauses, "s.kind = ?")
		args = append(args, opts.Kind)
	}
	if opts.Status != "" {
		clauses = append(clauses, "s.status = ?")
		args = append(args, opts.Status)
	}
	if opts.NotificationsOnly {
		clauses = append(
			clauses,
			`s.status = 'resolved' AND s.admin_reply IS NOT NULL AND s.admin_reply <> ''`,
		)
	}
	if query := strings.TrimSpace(opts.Query); query != "" {
		pattern := "%" + escapeFeedbackLike(strings.ToLower(query)) + "%"
		clauses = append(
			clauses,
			`(LOWER(s.title) LIKE ? ESCAPE '\' OR LOWER(s.description) LIKE ? ESCAPE '\'
			  OR LOWER(u.username) LIKE ? ESCAPE '\' OR LOWER(u.display_name) LIKE ? ESCAPE '\')`,
		)
		args = append(args, pattern, pattern, pattern, pattern)
	}
	if len(clauses) == 0 {
		return "1=1", args
	}
	return strings.Join(clauses, " AND "), args
}

func scanFeedbackSubmission(row rowScanner) (Submission, error) {
	var item Submission
	var title sql.NullString
	var category sql.NullString
	var adminReply sql.NullString
	var adminUserID sql.NullString
	var processedAt sql.NullInt64
	var replyUpdatedAt sql.NullInt64
	var userReadAt sql.NullInt64
	var createdAt int64
	var updatedAt int64
	if err := row.Scan(
		&item.ID,
		&item.Kind,
		&title,
		&category,
		&item.Description,
		&item.Status,
		&adminReply,
		&adminUserID,
		&processedAt,
		&replyUpdatedAt,
		&userReadAt,
		&createdAt,
		&updatedAt,
		&item.User.ID,
		&item.User.Username,
		&item.User.DisplayName,
		&item.User.AvatarFile,
	); err != nil {
		return Submission{}, fmt.Errorf("scan feedback submission: %w", err)
	}
	item.Title = title.String
	item.Category = category.String
	item.AdminReply = adminReply.String
	item.AdminUserID = adminUserID.String
	if processedAt.Valid {
		value := time.UnixMilli(processedAt.Int64).UTC()
		item.ProcessedAt = &value
	}
	if replyUpdatedAt.Valid {
		value := time.UnixMilli(replyUpdatedAt.Int64).UTC()
		item.ReplyUpdatedAt = &value
	}
	if userReadAt.Valid {
		value := time.UnixMilli(userReadAt.Int64).UTC()
		item.UserReadAt = &value
	}
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	return item, nil
}

func escapeFeedbackLike(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
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
