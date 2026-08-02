package moments

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

const (
	VisibilityFriends = "friends"
	VisibilitySelf    = "self"

	MomentStatusActive  = "active"
	MomentStatusDeleted = "deleted"
	MomentStatusHidden  = "hidden"

	MaxBodyRunes      = 500
	MaxCommentRunes   = 200
	MaxMomentImages   = 9
	MaxImageBytes     = 5 << 20
	DefaultPageSize   = 20
	MaxPageSize       = 50
	RecentLikersLimit = 3
	RecentCommentsLimit = 2
)

var (
	ErrAttachmentInvalid = errors.New("moment attachment is invalid")
	ErrBodyInvalid       = errors.New("moment body is invalid")
	ErrCommentInvalid    = errors.New("moment comment is invalid")
	ErrForbidden         = errors.New("moment operation is forbidden")
	ErrImageTooLarge     = errors.New("moment image is too large")
	ErrImagesTooMany     = errors.New("moment has too many images")
	ErrImageTypeInvalid  = errors.New("moment image type is invalid")
	ErrNotFound          = errors.New("moment record not found")
	ErrReportExists      = errors.New("moment report already exists")
)

type UserSummary struct {
	ID          string
	Username    string
	DisplayName string
	AvatarFile  string
	Role        string
}

type Media struct {
	ID          string
	StoredName  string
	ContentType string
	Width       int
	Height      int
	SortOrder   int
}

type Attachment struct {
	ID          string
	Type        string
	RefTable    string
	RefID       string
	PayloadJSON string
}

type Comment struct {
	ID        string
	MomentID  string
	Author    UserSummary
	ParentID  string
	Body      string
	Status    string
	CreatedAt time.Time
}

type Notification struct {
	ID          string
	RecipientID string
	Actor       UserSummary
	MomentID    string
	CommentID   string
	Type        string
	Preview     string
	Read        bool
	CreatedAt   time.Time
}

type Moment struct {
	ID             string
	Author         UserSummary
	Body           string
	Visibility     string
	Status         string
	Media          []Media
	Attachments    []Attachment
	LikeCount      int
	LikedByMe      bool
	RecentLikers   []UserSummary
	CommentCount   int
	RecentComments []Comment
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type Page struct {
	Items      []Moment
	NextCursor string
}

type CommentPage struct {
	Items      []Comment
	NextCursor string
}

type NotificationPage struct {
	Items       []Notification
	NextCursor  string
	UnreadCount int
}

type AttachmentOption struct {
	Type      string
	Source    string
	GameID    string
	Title     string
	Result    string
	RefID     string
	Score     int
	CreatedAt time.Time
}

type AdminMoment struct {
	Moment
	ReportCount int
}

type AdminPage struct {
	Items      []AdminMoment
	NextCursor string
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
			return nil, fmt.Errorf("create moments database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open moments database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS moments (
			id TEXT PRIMARY KEY,
			author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			body TEXT NOT NULL,
			visibility TEXT NOT NULL CHECK(visibility IN ('friends', 'self')),
			status TEXT NOT NULL CHECK(status IN ('active', 'deleted', 'hidden')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_moments_feed
			ON moments(status, visibility, created_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_moments_author_created
			ON moments(author_id, created_at DESC, id DESC)`,
		`CREATE TABLE IF NOT EXISTS moment_media (
			id TEXT PRIMARY KEY,
			moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
			stored_name TEXT NOT NULL,
			content_type TEXT NOT NULL,
			width INTEGER NOT NULL DEFAULT 0,
			height INTEGER NOT NULL DEFAULT 0,
			sort_order INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_moment_media_moment
			ON moment_media(moment_id, sort_order)`,
		`CREATE TABLE IF NOT EXISTS moment_likes (
			moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(moment_id, user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_moment_likes_moment_created
			ON moment_likes(moment_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS moment_comments (
			id TEXT PRIMARY KEY,
			moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
			author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			parent_id TEXT REFERENCES moment_comments(id) ON DELETE CASCADE,
			body TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('active', 'deleted', 'hidden')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_moment_comments_moment_created
			ON moment_comments(moment_id, created_at, id)`,
		`CREATE INDEX IF NOT EXISTS idx_moment_comments_parent
			ON moment_comments(parent_id)`,
		`CREATE TABLE IF NOT EXISTS moment_notifications (
			id TEXT PRIMARY KEY,
			recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			moment_id TEXT REFERENCES moments(id) ON DELETE CASCADE,
			comment_id TEXT REFERENCES moment_comments(id) ON DELETE CASCADE,
			type TEXT NOT NULL CHECK(type IN ('like', 'comment', 'reply', 'mention')),
			preview TEXT NOT NULL DEFAULT '',
			read_at INTEGER,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_moment_notifications_recipient
			ON moment_notifications(recipient_id, created_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_moment_notifications_unread
			ON moment_notifications(recipient_id, read_at)`,
		`CREATE TABLE IF NOT EXISTS moment_reports (
			id TEXT PRIMARY KEY,
			moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
			reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			reason TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('pending', 'resolved', 'dismissed')),
			created_at INTEGER NOT NULL,
			UNIQUE(moment_id, reporter_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_moment_reports_status_created
			ON moment_reports(status, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS moment_attachments (
			id TEXT PRIMARY KEY,
			moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
			attachment_type TEXT NOT NULL,
			ref_table TEXT NOT NULL,
			ref_id TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_moment_attachments_moment
			ON moment_attachments(moment_id)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run moments database migration: %w", err)
		}
	}
	return nil
}

func NormalizeBody(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	length := utf8.RuneCountInString(normalized)
	if length < 1 || length > MaxBodyRunes {
		return "", ErrBodyInvalid
	}
	return normalized, nil
}

func NormalizeComment(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	length := utf8.RuneCountInString(normalized)
	if length < 1 || length > MaxCommentRunes {
		return "", ErrCommentInvalid
	}
	return normalized, nil
}

func (s *Store) Create(
	ctx context.Context,
	userID string,
	body string,
	visibility string,
	media []Media,
	attachment *Attachment,
) (Moment, error) {
	normalized, err := NormalizeBody(body)
	if err != nil {
		return Moment{}, err
	}
	if visibility == "" {
		visibility = VisibilityFriends
	}
	if visibility != VisibilityFriends && visibility != VisibilitySelf {
		return Moment{}, ErrBodyInvalid
	}
	if len(media) > MaxMomentImages {
		return Moment{}, ErrImagesTooMany
	}

	now := time.Now().UTC()
	momentID := uuid.NewString()
	nowMillis := now.UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Moment{}, fmt.Errorf("begin moment transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO moments (id, author_id, body, visibility, status, created_at, updated_at)
		 VALUES (?, ?, ?, ?, 'active', ?, ?)`,
		momentID,
		userID,
		normalized,
		visibility,
		nowMillis,
		nowMillis,
	); err != nil {
		return Moment{}, fmt.Errorf("insert moment: %w", err)
	}

	for _, item := range media {
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO moment_media (
				id, moment_id, stored_name, content_type, width, height, sort_order
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			item.ID,
			momentID,
			item.StoredName,
			item.ContentType,
			item.Width,
			item.Height,
			item.SortOrder,
		); err != nil {
			return Moment{}, fmt.Errorf("insert moment media: %w", err)
		}
	}

	if attachment != nil {
		payload, err := s.validateAttachment(ctx, tx, userID, attachment)
		if err != nil {
			return Moment{}, err
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO moment_attachments (
				id, moment_id, attachment_type, ref_table, ref_id, payload_json, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			attachment.ID,
			momentID,
			attachment.Type,
			attachment.RefTable,
			attachment.RefID,
			payload,
			nowMillis,
		); err != nil {
			return Moment{}, fmt.Errorf("insert moment attachment: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return Moment{}, fmt.Errorf("commit moment transaction: %w", err)
	}
	return s.Get(ctx, userID, momentID)
}

func (s *Store) validateAttachment(
	ctx context.Context,
	tx *sql.Tx,
	userID string,
	attachment *Attachment,
) (string, error) {
	if attachment == nil {
		return "", nil
	}
	if attachment.ID == "" {
		attachment.ID = uuid.NewString()
	}
	if attachment.Type != "game_result" {
		return "", ErrAttachmentInvalid
	}

	switch attachment.RefTable {
	case "game_matches":
		var winnerID string
		var status string
		var gameID string
		if err := tx.QueryRowContext(
			ctx,
			`SELECT status, winner_user_id, game_id FROM game_matches WHERE id = ?`,
			attachment.RefID,
		).Scan(&status, &winnerID, &gameID); err != nil {
			return "", ErrAttachmentInvalid
		}
		if status != "finished" {
			return "", ErrAttachmentInvalid
		}
		var belongs int
		if err := tx.QueryRowContext(
			ctx,
			`SELECT COUNT(*) FROM game_matches
			 WHERE id = ? AND (inviter_id = ? OR opponent_id = ?)`,
			attachment.RefID,
			userID,
			userID,
		).Scan(&belongs); err != nil {
			return "", ErrAttachmentInvalid
		}
		if belongs == 0 {
			return "", ErrAttachmentInvalid
		}
		result := "失败"
		if winnerID == userID {
			result = "胜利"
		}
		return fmt.Sprintf(
			`{"type":"game_result","gameId":%q,"title":"%s","result":%q,"refId":%q}`,
			gameID,
			gameDisplayName(gameID),
			result,
			attachment.RefID,
		), nil
	case "game_score_submissions":
		var score int
		var gameID string
		if err := tx.QueryRowContext(
			ctx,
			`SELECT score, game_id FROM game_score_submissions WHERE id = ? AND user_id = ?`,
			attachment.RefID,
			userID,
		).Scan(&score, &gameID); err != nil {
			return "", ErrAttachmentInvalid
		}
		return fmt.Sprintf(
			`{"type":"game_result","gameId":%q,"title":"%s 成绩","result":"%d 分","score":%d,"refId":%q}`,
			gameID,
			gameDisplayName(gameID),
			score,
			score,
			attachment.RefID,
		), nil
	default:
		return "", ErrAttachmentInvalid
	}
}

func (s *Store) ListFeed(
	ctx context.Context,
	userID string,
	scope string,
	cursor string,
	limit int,
) (Page, error) {
	if limit <= 0 || limit > MaxPageSize {
		limit = DefaultPageSize
	}
	cursorMillis, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return Page{}, ErrNotFound
	}

	query := `SELECT m.id, m.body, m.visibility, m.status, m.created_at, m.updated_at,
	             u.id, u.username, u.display_name, u.avatar_file, u.role
	          FROM moments m
	          JOIN users u ON u.id = m.author_id
	          WHERE m.status = 'active'`
	args := make([]any, 0, 8)
	if scope == "mine" {
		query += ` AND m.author_id = ?`
		args = append(args, userID)
	} else {
		query += ` AND m.visibility = 'friends'
		          AND (
		            m.author_id = ?
		            OR m.author_id IN (
		              SELECT user_two_id FROM friendships WHERE user_one_id = ?
		              UNION
		              SELECT user_one_id FROM friendships WHERE user_two_id = ?
		            )
		          )`
		args = append(args, userID, userID, userID)
	}
	if cursorMillis > 0 {
		query += ` AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))`
		args = append(args, cursorMillis, cursorMillis, cursorID)
	}
	query += ` ORDER BY m.created_at DESC, m.id DESC LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return Page{}, fmt.Errorf("list moment feed: %w", err)
	}
	defer rows.Close()

	items := make([]Moment, 0, limit+1)
	for rows.Next() {
		item, err := scanMomentRow(rows)
		if err != nil {
			return Page{}, fmt.Errorf("scan moment feed: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page{}, fmt.Errorf("iterate moment feed: %w", err)
	}

	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(items[limit-1].CreatedAt, items[limit-1].ID)
		items = items[:limit]
	}
	if err := s.enrichMoments(ctx, userID, items); err != nil {
		return Page{}, err
	}
	return Page{Items: items, NextCursor: nextCursor}, nil
}

func (s *Store) Get(ctx context.Context, viewerID string, momentID string) (Moment, error) {
	item, err := s.getMoment(ctx, momentID, viewerID)
	if err != nil {
		return Moment{}, err
	}
	items := []Moment{item}
	if err := s.enrichMoments(ctx, viewerID, items); err != nil {
		return Moment{}, err
	}
	return items[0], nil
}

func (s *Store) AuthorOf(ctx context.Context, momentID string) (string, error) {
	var authorID string
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT author_id FROM moments WHERE id = ?`,
		momentID,
	).Scan(&authorID); err != nil {
		return "", ErrNotFound
	}
	return authorID, nil
}

func (s *Store) getMoment(ctx context.Context, momentID string, viewerID string) (Moment, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT m.id, m.body, m.visibility, m.status, m.created_at, m.updated_at,
		        u.id, u.username, u.display_name, u.avatar_file, u.role
		 FROM moments m
		 JOIN users u ON u.id = m.author_id
		 WHERE m.id = ?`,
		momentID,
	)
	item, err := scanMomentRow(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Moment{}, ErrNotFound
		}
		return Moment{}, fmt.Errorf("get moment: %w", err)
	}
	if item.Status != MomentStatusActive {
		return Moment{}, ErrNotFound
	}
	if item.Author.ID != viewerID {
		allowed, err := s.isFriend(ctx, viewerID, item.Author.ID)
		if err != nil {
			return Moment{}, err
		}
		if !allowed || item.Visibility != VisibilityFriends {
			return Moment{}, ErrForbidden
		}
	}
	return item, nil
}

func (s *Store) UpdateVisibility(
	ctx context.Context,
	userID string,
	momentID string,
	visibility string,
) (Moment, error) {
	if visibility != VisibilityFriends && visibility != VisibilitySelf {
		return Moment{}, ErrBodyInvalid
	}
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE moments SET visibility = ?, updated_at = ?
		 WHERE id = ? AND author_id = ? AND status = 'active'`,
		visibility,
		time.Now().UTC().UnixMilli(),
		momentID,
		userID,
	)
	if err != nil {
		return Moment{}, fmt.Errorf("update moment visibility: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Moment{}, fmt.Errorf("update moment visibility rows: %w", err)
	}
	if affected == 0 {
		return Moment{}, ErrNotFound
	}
	return s.Get(ctx, userID, momentID)
}

func (s *Store) Delete(ctx context.Context, userID string, momentID string) error {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE moments SET status = 'deleted', updated_at = ?
		 WHERE id = ? AND author_id = ? AND status = 'active'`,
		time.Now().UTC().UnixMilli(),
		momentID,
		userID,
	)
	if err != nil {
		return fmt.Errorf("delete moment: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete moment rows: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) Like(ctx context.Context, userID string, momentID string) (bool, error) {
	if err := s.ensureMomentVisible(ctx, userID, momentID); err != nil {
		return false, err
	}
	result, err := s.db.ExecContext(
		ctx,
		`INSERT OR IGNORE INTO moment_likes (moment_id, user_id, created_at)
		 VALUES (?, ?, ?)`,
		momentID,
		userID,
		time.Now().UTC().UnixMilli(),
	)
	if err != nil {
		return false, fmt.Errorf("like moment: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("like moment rows: %w", err)
	}
	if affected > 0 {
		s.notify(ctx, userID, momentID, "", "like", "")
	}
	return affected > 0, nil
}

func (s *Store) Unlike(ctx context.Context, userID string, momentID string) (bool, error) {
	result, err := s.db.ExecContext(
		ctx,
		`DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?`,
		momentID,
		userID,
	)
	if err != nil {
		return false, fmt.Errorf("unlike moment: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("unlike moment rows: %w", err)
	}
	return affected > 0, nil
}

func (s *Store) ListLikes(
	ctx context.Context,
	viewerID string,
	momentID string,
	cursor string,
	limit int,
) ([]UserSummary, string, error) {
	if err := s.ensureMomentVisible(ctx, viewerID, momentID); err != nil {
		return nil, "", err
	}
	if limit <= 0 || limit > MaxPageSize {
		limit = DefaultPageSize
	}
	cursorMillis, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return nil, "", ErrNotFound
	}
	query := `SELECT u.id, u.username, u.display_name, u.avatar_file, u.role, l.created_at
	          FROM moment_likes l
	          JOIN users u ON u.id = l.user_id
	          WHERE l.moment_id = ?`
	args := []any{momentID}
	if cursorMillis > 0 {
		query += ` AND (l.created_at < ? OR (l.created_at = ? AND l.user_id < ?))`
		args = append(args, cursorMillis, cursorMillis, cursorID)
	}
	query += ` ORDER BY l.created_at DESC, l.user_id DESC LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("list moment likes: %w", err)
	}
	defer rows.Close()
	users := make([]UserSummary, 0, limit+1)
	var lastCreatedAt int64
	for rows.Next() {
		var user UserSummary
		var createdAt int64
		if err := rows.Scan(
			&user.ID,
			&user.Username,
			&user.DisplayName,
			&user.AvatarFile,
			&user.Role,
			&createdAt,
		); err != nil {
			return nil, "", fmt.Errorf("scan moment like: %w", err)
		}
		lastCreatedAt = createdAt
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("iterate moment likes: %w", err)
	}
	nextCursor := ""
	if len(users) > limit {
		nextCursor = encodeCursor(time.UnixMilli(lastCreatedAt), users[limit-1].ID)
		users = users[:limit]
	}
	return users, nextCursor, nil
}

func (s *Store) Comment(
	ctx context.Context,
	userID string,
	momentID string,
	parentID string,
	body string,
	mentionIDs []string,
) (Comment, error) {
	normalized, err := NormalizeComment(body)
	if err != nil {
		return Comment{}, err
	}
	if err := s.ensureMomentVisible(ctx, userID, momentID); err != nil {
		return Comment{}, err
	}

	now := time.Now().UTC()
	commentID := uuid.NewString()
	nowMillis := now.UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Comment{}, fmt.Errorf("begin moment comment: %w", err)
	}
	defer tx.Rollback()

	if parentID != "" {
		var parentMoment string
		if err := tx.QueryRowContext(
			ctx,
			`SELECT moment_id FROM moment_comments WHERE id = ? AND status = 'active'`,
			parentID,
		).Scan(&parentMoment); err != nil {
			return Comment{}, ErrNotFound
		}
		if parentMoment != momentID {
			return Comment{}, ErrForbidden
		}
	}
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO moment_comments (
			id, moment_id, author_id, parent_id, body, status, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
		commentID,
		momentID,
		userID,
		nullableID(parentID),
		normalized,
		nowMillis,
		nowMillis,
	); err != nil {
		return Comment{}, fmt.Errorf("insert moment comment: %w", err)
	}

	notificationType := "comment"
	if parentID != "" {
		notificationType = "reply"
	}
	if err := s.insertNotification(
		ctx,
		tx,
		userID,
		momentID,
		commentID,
		notificationType,
		normalized,
		nowMillis,
	); err != nil {
		return Comment{}, err
	}
	for _, mentionID := range mentionIDs {
		if strings.TrimSpace(mentionID) == "" || mentionID == userID {
			continue
		}
		if err := s.insertNotificationTo(
			ctx,
			tx,
			strings.TrimSpace(mentionID),
			userID,
			momentID,
			commentID,
			"mention",
			normalized,
			nowMillis,
		); err != nil {
			return Comment{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Comment{}, fmt.Errorf("commit moment comment: %w", err)
	}
	return s.getComment(ctx, commentID)
}

func (s *Store) insertNotification(
	ctx context.Context,
	tx *sql.Tx,
	actorID string,
	momentID string,
	commentID string,
	notificationType string,
	preview string,
	nowMillis int64,
) error {
	recipientID, err := momentAuthorID(ctx, tx, momentID)
	if err != nil {
		return err
	}
	if recipientID == actorID {
		return nil
	}
	return s.insertNotificationTo(
		ctx,
		tx,
		recipientID,
		actorID,
		momentID,
		commentID,
		notificationType,
		preview,
		nowMillis,
	)
}

func (s *Store) insertNotificationTo(
	ctx context.Context,
	tx *sql.Tx,
	recipientID string,
	actorID string,
	momentID string,
	commentID string,
	notificationType string,
	preview string,
	nowMillis int64,
) error {
	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO moment_notifications (
			id, recipient_id, actor_id, moment_id, comment_id, type, preview, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		uuid.NewString(),
		recipientID,
		actorID,
		momentID,
		nullableID(commentID),
		notificationType,
		preview,
		nowMillis,
	); err != nil {
		return fmt.Errorf("insert moment notification: %w", err)
	}
	return nil
}

func momentAuthorID(ctx context.Context, tx *sql.Tx, momentID string) (string, error) {
	var authorID string
	if err := tx.QueryRowContext(
		ctx,
		`SELECT author_id FROM moments WHERE id = ?`,
		momentID,
	).Scan(&authorID); err != nil {
		return "", fmt.Errorf("read moment author: %w", err)
	}
	return authorID, nil
}

func (s *Store) getComment(ctx context.Context, commentID string) (Comment, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT c.id, c.moment_id, c.parent_id, c.body, c.status, c.created_at,
		        u.id, u.username, u.display_name, u.avatar_file, u.role
		 FROM moment_comments c
		 JOIN users u ON u.id = c.author_id
		 WHERE c.id = ?`,
		commentID,
	)
	var comment Comment
	var parentID sql.NullString
	var createdAt int64
	if err := row.Scan(
		&comment.ID,
		&comment.MomentID,
		&parentID,
		&comment.Body,
		&comment.Status,
		&createdAt,
		&comment.Author.ID,
		&comment.Author.Username,
		&comment.Author.DisplayName,
		&comment.Author.AvatarFile,
		&comment.Author.Role,
	); err != nil {
		return Comment{}, ErrNotFound
	}
	comment.ParentID = parentID.String
	comment.CreatedAt = time.UnixMilli(createdAt).UTC()
	return comment, nil
}

func (s *Store) ListComments(
	ctx context.Context,
	viewerID string,
	momentID string,
	cursor string,
	limit int,
) (CommentPage, error) {
	if err := s.ensureMomentVisible(ctx, viewerID, momentID); err != nil {
		return CommentPage{}, err
	}
	if limit <= 0 || limit > MaxPageSize {
		limit = DefaultPageSize
	}
	cursorMillis, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return CommentPage{}, ErrNotFound
	}
	query := `SELECT c.id, c.moment_id, c.parent_id, c.body, c.status, c.created_at,
	                 u.id, u.username, u.display_name, u.avatar_file, u.role
	          FROM moment_comments c
	          JOIN users u ON u.id = c.author_id
	          WHERE c.moment_id = ? AND c.status = 'active'`
	args := []any{momentID}
	if cursorMillis > 0 {
		query += ` AND (c.created_at > ? OR (c.created_at = ? AND c.id > ?))`
		args = append(args, cursorMillis, cursorMillis, cursorID)
	}
	query += ` ORDER BY c.created_at ASC, c.id ASC LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return CommentPage{}, fmt.Errorf("list moment comments: %w", err)
	}
	defer rows.Close()
	comments := make([]Comment, 0, limit+1)
	for rows.Next() {
		var comment Comment
		var parentID sql.NullString
		var createdAt int64
		if err := rows.Scan(
			&comment.ID,
			&comment.MomentID,
			&parentID,
			&comment.Body,
			&comment.Status,
			&createdAt,
			&comment.Author.ID,
			&comment.Author.Username,
			&comment.Author.DisplayName,
			&comment.Author.AvatarFile,
			&comment.Author.Role,
		); err != nil {
			return CommentPage{}, fmt.Errorf("scan moment comment: %w", err)
		}
		comment.ParentID = parentID.String
		comment.CreatedAt = time.UnixMilli(createdAt).UTC()
		comments = append(comments, comment)
	}
	if err := rows.Err(); err != nil {
		return CommentPage{}, fmt.Errorf("iterate moment comments: %w", err)
	}
	nextCursor := ""
	if len(comments) > limit {
		nextCursor = encodeCursor(comments[limit-1].CreatedAt, comments[limit-1].ID)
		comments = comments[:limit]
	}
	return CommentPage{Items: comments, NextCursor: nextCursor}, nil
}

func (s *Store) DeleteComment(ctx context.Context, userID string, commentID string) error {
	var authorID string
	var momentID string
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT author_id, moment_id FROM moment_comments WHERE id = ?`,
		commentID,
	).Scan(&authorID, &momentID); err != nil {
		return ErrNotFound
	}
	var momentAuthorID string
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT author_id FROM moments WHERE id = ?`,
		momentID,
	).Scan(&momentAuthorID); err != nil {
		return ErrNotFound
	}
	if authorID != userID && momentAuthorID != userID {
		return ErrForbidden
	}
	if _, err := s.db.ExecContext(
		ctx,
		`UPDATE moment_comments SET status = 'deleted', updated_at = ? WHERE id = ?`,
		time.Now().UTC().UnixMilli(),
		commentID,
	); err != nil {
		return fmt.Errorf("delete moment comment: %w", err)
	}
	return nil
}

func (s *Store) Notifications(
	ctx context.Context,
	userID string,
	cursor string,
	limit int,
) (NotificationPage, error) {
	if limit <= 0 || limit > MaxPageSize {
		limit = DefaultPageSize
	}
	cursorMillis, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return NotificationPage{}, ErrNotFound
	}
	query := `SELECT n.id, n.moment_id, n.comment_id, n.type, n.preview, n.read_at, n.created_at,
	                 u.id, u.username, u.display_name, u.avatar_file, u.role
	          FROM moment_notifications n
	          JOIN users u ON u.id = n.actor_id
	          WHERE n.recipient_id = ?`
	args := []any{userID}
	if cursorMillis > 0 {
		query += ` AND (n.created_at < ? OR (n.created_at = ? AND n.id < ?))`
		args = append(args, cursorMillis, cursorMillis, cursorID)
	}
	query += ` ORDER BY n.created_at DESC, n.id DESC LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return NotificationPage{}, fmt.Errorf("list moment notifications: %w", err)
	}
	defer rows.Close()
	items := make([]Notification, 0, limit+1)
	for rows.Next() {
		var item Notification
		var momentID sql.NullString
		var commentID sql.NullString
		var readAt sql.NullInt64
		var createdAt int64
		if err := rows.Scan(
			&item.ID,
			&momentID,
			&commentID,
			&item.Type,
			&item.Preview,
			&readAt,
			&createdAt,
			&item.Actor.ID,
			&item.Actor.Username,
			&item.Actor.DisplayName,
			&item.Actor.AvatarFile,
			&item.Actor.Role,
		); err != nil {
			return NotificationPage{}, fmt.Errorf("scan moment notification: %w", err)
		}
		item.RecipientID = userID
		item.MomentID = momentID.String
		item.CommentID = commentID.String
		item.Read = readAt.Valid
		item.CreatedAt = time.UnixMilli(createdAt).UTC()
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return NotificationPage{}, fmt.Errorf("iterate moment notifications: %w", err)
	}
	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(items[limit-1].CreatedAt, items[limit-1].ID)
		items = items[:limit]
	}
	unread, err := s.UnreadCount(ctx, userID)
	if err != nil {
		return NotificationPage{}, err
	}
	return NotificationPage{Items: items, NextCursor: nextCursor, UnreadCount: unread}, nil
}

func (s *Store) UnreadCount(ctx context.Context, userID string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM moment_notifications
		 WHERE recipient_id = ? AND read_at IS NULL`,
		userID,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("count unread moment notifications: %w", err)
	}
	return count, nil
}

func (s *Store) MarkNotificationsRead(ctx context.Context, userID string, momentID string) error {
	if momentID == "" {
		_, err := s.db.ExecContext(
			ctx,
			`UPDATE moment_notifications
			 SET read_at = COALESCE(read_at, ?)
			 WHERE recipient_id = ?`,
			time.Now().UTC().UnixMilli(),
			userID,
		)
		return err
	}
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE moment_notifications
		 SET read_at = COALESCE(read_at, ?)
		 WHERE recipient_id = ? AND moment_id = ?`,
		time.Now().UTC().UnixMilli(),
		userID,
		momentID,
	)
	return err
}

func (s *Store) Report(ctx context.Context, userID string, momentID string, reason string) error {
	if err := s.ensureMomentVisible(ctx, userID, momentID); err != nil {
		return err
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || len([]rune(reason)) > 200 {
		return ErrCommentInvalid
	}
	_, err := s.db.ExecContext(
		ctx,
		`INSERT OR IGNORE INTO moment_reports (
			id, moment_id, reporter_id, reason, status, created_at
		) VALUES (?, ?, ?, ?, 'pending', ?)`,
		uuid.NewString(),
		momentID,
		userID,
		reason,
		time.Now().UTC().UnixMilli(),
	)
	if err != nil {
		return fmt.Errorf("create moment report: %w", err)
	}
	return nil
}

func (s *Store) AdminList(
	ctx context.Context,
	status string,
	cursor string,
	limit int,
) (AdminPage, error) {
	if limit <= 0 || limit > MaxPageSize {
		limit = DefaultPageSize
	}
	if status == "" {
		status = MomentStatusActive
	}
	cursorMillis, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return AdminPage{}, ErrNotFound
	}
	query := `SELECT m.id, m.body, m.visibility, m.status, m.created_at, m.updated_at,
	                 u.id, u.username, u.display_name, u.avatar_file, u.role,
	                 (SELECT COUNT(*) FROM moment_reports r
		          WHERE r.moment_id = m.id AND r.status = 'pending') AS report_count
	          FROM moments m
	          JOIN users u ON u.id = m.author_id
	          WHERE m.status = ?`
	args := []any{status}
	if cursorMillis > 0 {
		query += ` AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))`
		args = append(args, cursorMillis, cursorMillis, cursorID)
	}
	query += ` ORDER BY m.created_at DESC, m.id DESC LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return AdminPage{}, fmt.Errorf("list admin moments: %w", err)
	}
	defer rows.Close()
	items := make([]AdminMoment, 0, limit+1)
	for rows.Next() {
		var item AdminMoment
		var createdAt int64
		var updatedAt int64
		if err := rows.Scan(
			&item.ID,
			&item.Body,
			&item.Visibility,
			&item.Status,
			&createdAt,
			&updatedAt,
			&item.Author.ID,
			&item.Author.Username,
			&item.Author.DisplayName,
			&item.Author.AvatarFile,
			&item.Author.Role,
			&item.ReportCount,
		); err != nil {
			return AdminPage{}, fmt.Errorf("scan admin moment: %w", err)
		}
		item.CreatedAt = time.UnixMilli(createdAt).UTC()
		item.UpdatedAt = time.UnixMilli(updatedAt).UTC()
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return AdminPage{}, fmt.Errorf("iterate admin moments: %w", err)
	}
	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(items[limit-1].CreatedAt, items[limit-1].ID)
		items = items[:limit]
	}
	return AdminPage{Items: items, NextCursor: nextCursor}, nil
}

func (s *Store) AdminHide(ctx context.Context, momentID string) error {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE moments SET status = 'hidden', updated_at = ?
		 WHERE id = ? AND status IN ('active', 'hidden')`,
		time.Now().UTC().UnixMilli(),
		momentID,
	)
	if err != nil {
		return fmt.Errorf("hide admin moment: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("hide admin moment rows: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ListAttachmentOptions(
	ctx context.Context,
	userID string,
	limit int,
) ([]AttachmentOption, error) {
	if limit <= 0 || limit > MaxPageSize {
		limit = DefaultPageSize
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT 'match' AS source, id, game_id, winner_user_id, 0, created_at
		 FROM game_matches
		 WHERE status = 'finished' AND (inviter_id = ? OR opponent_id = ?)
		 ORDER BY created_at DESC LIMIT ?`,
		userID,
		userID,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list moment match attachments: %w", err)
	}
	defer rows.Close()
	options := make([]AttachmentOption, 0, limit)
	for rows.Next() {
		var option AttachmentOption
		var source string
		var winnerID string
		var createdAt int64
		if err := rows.Scan(
			&source,
			&option.RefID,
			&option.GameID,
			&winnerID,
			&option.Score,
			&createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan moment match attachment: %w", err)
		}
		option.Type = "game_result"
		option.Source = "match"
		option.Title = gameDisplayName(option.GameID) + " 好友对局"
		option.Result = "失败"
		if winnerID == userID {
			option.Result = "胜利"
		}
		option.CreatedAt = time.UnixMilli(createdAt).UTC()
		options = append(options, option)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate moment match attachments: %w", err)
	}
	if len(options) >= limit {
		return options, nil
	}

	remaining := limit - len(options)
	scoreRows, err := s.db.QueryContext(
		ctx,
		`SELECT id, game_id, score, created_at
		 FROM game_score_submissions
		 WHERE user_id = ?
		 ORDER BY created_at DESC LIMIT ?`,
		userID,
		remaining,
	)
	if err != nil {
		return nil, fmt.Errorf("list moment score attachments: %w", err)
	}
	defer scoreRows.Close()
	for scoreRows.Next() {
		var option AttachmentOption
		var createdAt int64
		if err := scoreRows.Scan(
			&option.RefID,
			&option.GameID,
			&option.Score,
			&createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan moment score attachment: %w", err)
		}
		option.Type = "game_result"
		option.Source = "score"
		option.Title = gameDisplayName(option.GameID) + " 成绩"
		option.Result = fmt.Sprintf("%d 分", option.Score)
		option.CreatedAt = time.UnixMilli(createdAt).UTC()
		options = append(options, option)
	}
	return options, scoreRows.Err()
}

func (s *Store) enrichMoments(ctx context.Context, viewerID string, items []Moment) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	mediaMap, err := s.mediaForMoments(ctx, ids)
	if err != nil {
		return err
	}
	attachmentMap, err := s.attachmentsForMoments(ctx, ids)
	if err != nil {
		return err
	}
	likeCounts, err := s.likeCounts(ctx, ids)
	if err != nil {
		return err
	}
	likedByMe, err := s.likedByMe(ctx, viewerID, ids)
	if err != nil {
		return err
	}
	recentLikers, err := s.recentLikers(ctx, ids)
	if err != nil {
		return err
	}
	commentCounts, err := s.commentCounts(ctx, ids)
	if err != nil {
		return err
	}
	recentComments, err := s.recentComments(ctx, ids)
	if err != nil {
		return err
	}

	for index := range items {
		item := &items[index]
		item.Media = mediaMap[item.ID]
		item.Attachments = attachmentMap[item.ID]
		item.LikeCount = likeCounts[item.ID]
		item.LikedByMe = likedByMe[item.ID]
		item.RecentLikers = recentLikers[item.ID]
		item.CommentCount = commentCounts[item.ID]
		item.RecentComments = recentComments[item.ID]
	}
	return nil
}

func (s *Store) mediaForMoments(ctx context.Context, ids []string) (map[string][]Media, error) {
	result := make(map[string][]Media, len(ids))
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, moment_id, stored_name, content_type, width, height, sort_order
		 FROM moment_media
		 WHERE moment_id IN (`+placeholders(len(ids))+`)
		 ORDER BY moment_id, sort_order`,
		toAnySlice(ids)...,
	)
	if err != nil {
		return nil, fmt.Errorf("list moment media: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item Media
		var momentID string
		if err := rows.Scan(
			&item.ID,
			&momentID,
			&item.StoredName,
			&item.ContentType,
			&item.Width,
			&item.Height,
			&item.SortOrder,
		); err != nil {
			return nil, fmt.Errorf("scan moment media: %w", err)
		}
		result[momentID] = append(result[momentID], item)
	}
	return result, rows.Err()
}

func (s *Store) attachmentsForMoments(ctx context.Context, ids []string) (map[string][]Attachment, error) {
	result := make(map[string][]Attachment, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, moment_id, attachment_type, ref_table, ref_id, payload_json
		 FROM moment_attachments
		 WHERE moment_id IN (`+placeholders(len(ids))+`)
		 ORDER BY moment_id, created_at`,
		toAnySlice(ids)...,
	)
	if err != nil {
		return nil, fmt.Errorf("list moment attachments: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var item Attachment
		var momentID string
		if err := rows.Scan(
			&item.ID,
			&momentID,
			&item.Type,
			&item.RefTable,
			&item.RefID,
			&item.PayloadJSON,
		); err != nil {
			return nil, fmt.Errorf("scan moment attachment: %w", err)
		}
		result[momentID] = append(result[momentID], item)
	}
	return result, rows.Err()
}

func (s *Store) likeCounts(ctx context.Context, ids []string) (map[string]int, error) {
	result := make(map[string]int, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT moment_id, COUNT(*) FROM moment_likes
		 WHERE moment_id IN (`+placeholders(len(ids))+`)
		 GROUP BY moment_id`,
		toAnySlice(ids)...,
	)
	if err != nil {
		return nil, fmt.Errorf("count moment likes: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var count int
		if err := rows.Scan(&id, &count); err != nil {
			return nil, fmt.Errorf("scan moment like count: %w", err)
		}
		result[id] = count
	}
	return result, rows.Err()
}

func (s *Store) likedByMe(ctx context.Context, viewerID string, ids []string) (map[string]bool, error) {
	result := make(map[string]bool, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	args := append([]any{viewerID}, toAnySlice(ids)...)
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT moment_id FROM moment_likes
		 WHERE user_id = ? AND moment_id IN (`+placeholders(len(ids))+`)`,
		args...,
	)
	if err != nil {
		return nil, fmt.Errorf("list liked moments: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan liked moment: %w", err)
		}
		result[id] = true
	}
	return result, rows.Err()
}

func (s *Store) recentLikers(ctx context.Context, ids []string) (map[string][]UserSummary, error) {
	result := make(map[string][]UserSummary, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT l.moment_id, u.id, u.username, u.display_name, u.avatar_file, u.role, l.created_at
		 FROM moment_likes l
		 JOIN users u ON u.id = l.user_id
		 WHERE l.moment_id IN (`+placeholders(len(ids))+`)
		 ORDER BY l.created_at DESC, l.user_id DESC`,
		toAnySlice(ids)...,
	)
	if err != nil {
		return nil, fmt.Errorf("list recent moment likers: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var momentID string
		var user UserSummary
		var createdAt int64
		if err := rows.Scan(
			&momentID,
			&user.ID,
			&user.Username,
			&user.DisplayName,
			&user.AvatarFile,
			&user.Role,
			&createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan recent moment liker: %w", err)
		}
		if len(result[momentID]) < RecentLikersLimit {
			result[momentID] = append(result[momentID], user)
		}
	}
	return result, rows.Err()
}

func (s *Store) commentCounts(ctx context.Context, ids []string) (map[string]int, error) {
	result := make(map[string]int, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT moment_id, COUNT(*) FROM moment_comments
		 WHERE moment_id IN (`+placeholders(len(ids))+`) AND status = 'active'
		 GROUP BY moment_id`,
		toAnySlice(ids)...,
	)
	if err != nil {
		return nil, fmt.Errorf("count moment comments: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var count int
		if err := rows.Scan(&id, &count); err != nil {
			return nil, fmt.Errorf("scan moment comment count: %w", err)
		}
		result[id] = count
	}
	return result, rows.Err()
}

func (s *Store) recentComments(ctx context.Context, ids []string) (map[string][]Comment, error) {
	result := make(map[string][]Comment, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT c.moment_id, c.id, c.moment_id, c.parent_id, c.body, c.status, c.created_at,
		        u.id, u.username, u.display_name, u.avatar_file, u.role
		 FROM moment_comments c
		 JOIN users u ON u.id = c.author_id
		 WHERE c.moment_id IN (`+placeholders(len(ids))+`) AND c.status = 'active'
		 ORDER BY c.created_at DESC, c.id DESC`,
		toAnySlice(ids)...,
	)
	if err != nil {
		return nil, fmt.Errorf("list recent moment comments: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var comment Comment
		var momentID string
		var parentID sql.NullString
		var createdAt int64
		if err := rows.Scan(
			&momentID,
			&comment.ID,
			&comment.MomentID,
			&parentID,
			&comment.Body,
			&comment.Status,
			&createdAt,
			&comment.Author.ID,
			&comment.Author.Username,
			&comment.Author.DisplayName,
			&comment.Author.AvatarFile,
			&comment.Author.Role,
		); err != nil {
			return nil, fmt.Errorf("scan recent moment comment: %w", err)
		}
		comment.ParentID = parentID.String
		comment.CreatedAt = time.UnixMilli(createdAt).UTC()
		if len(result[momentID]) < RecentCommentsLimit {
			result[momentID] = append(result[momentID], comment)
		}
	}
	return result, rows.Err()
}

func (s *Store) ensureMomentVisible(ctx context.Context, viewerID string, momentID string) error {
	item, err := s.getMoment(ctx, momentID, viewerID)
	if err != nil {
		return err
	}
	if item.Author.ID != viewerID {
		allowed, err := s.isFriend(ctx, viewerID, item.Author.ID)
		if err != nil {
			return err
		}
		if !allowed || item.Visibility != VisibilityFriends {
			return ErrForbidden
		}
	}
	return nil
}

func (s *Store) isFriend(ctx context.Context, userOne string, userTwo string) (bool, error) {
	one, two := orderedUsers(userOne, userTwo)
	var count int
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM friendships WHERE user_one_id = ? AND user_two_id = ?`,
		one,
		two,
	).Scan(&count); err != nil {
		return false, fmt.Errorf("check friendship: %w", err)
	}
	return count > 0, nil
}

func (s *Store) notify(
	ctx context.Context,
	actorID string,
	momentID string,
	commentID string,
	notificationType string,
	preview string,
) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return
	}
	defer tx.Rollback()
	if err := s.insertNotification(
		ctx,
		tx,
		actorID,
		momentID,
		commentID,
		notificationType,
		preview,
		time.Now().UTC().UnixMilli(),
	); err == nil {
		_ = tx.Commit()
	}
}

func scanMomentRow(row interface{ Scan(...any) error }) (Moment, error) {
	var item Moment
	var createdAt int64
	var updatedAt int64
	if err := row.Scan(
		&item.ID,
		&item.Body,
		&item.Visibility,
		&item.Status,
		&createdAt,
		&updatedAt,
		&item.Author.ID,
		&item.Author.Username,
		&item.Author.DisplayName,
		&item.Author.AvatarFile,
		&item.Author.Role,
	); err != nil {
		return Moment{}, err
	}
	item.CreatedAt = time.UnixMilli(createdAt).UTC()
	item.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	return item, nil
}

func orderedUsers(left string, right string) (string, string) {
	if left < right {
		return left, right
	}
	return right, left
}

func nullableID(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

func toAnySlice(values []string) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func encodeCursor(createdAt time.Time, id string) string {
	value := fmt.Sprintf("%d:%s", createdAt.UnixMilli(), id)
	return base64.RawURLEncoding.EncodeToString([]byte(value))
}

func decodeCursor(value string) (int64, string, error) {
	if value == "" {
		return 0, "", nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return 0, "", err
	}
	parts := strings.SplitN(string(raw), ":", 2)
	if len(parts) != 2 {
		return 0, "", errors.New("invalid cursor")
	}
	millis, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, "", err
	}
	return millis, parts[1], nil
}

func gameDisplayName(gameID string) string {
	names := map[string]string{
		"brick-breaker": "打砖块",
		"gomoku":        "五子棋",
		"snake-brawl":   "贪吃蛇大作战",
		"tetris":        "俄罗斯方块",
		"xiangqi":       "象棋",
	}
	if name, ok := names[gameID]; ok {
		return name
	}
	return gameID
}
