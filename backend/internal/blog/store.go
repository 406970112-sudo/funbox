package blog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

const (
	VisibilityPublic  = "public"
	VisibilityFriends = "friends"
	VisibilitySelf    = "self"

	PostStatusActive  = "active"
	PostStatusDeleted = "deleted"
	PostStatusHidden  = "hidden"

	MaxTitleRunes       = 80
	MaxSummaryRunes     = 300
	MaxBodyRunes        = 10000
	MaxCommentRunes     = 200
	MaxReportRunes      = 200
	DefaultPageSize     = 20
	MaxPageSize         = 50
	RecentCommentsLimit = 2
)

var (
	ErrBodyInvalid    = errors.New("blog post body is invalid")
	ErrCommentInvalid = errors.New("blog comment is invalid")
	ErrCoverInvalid   = errors.New("blog cover is invalid")
	ErrCoverTooLarge  = errors.New("blog cover is too large")
	ErrForbidden      = errors.New("blog operation is forbidden")
	ErrNotFound       = errors.New("blog record not found")
	ErrReportExists   = errors.New("blog report already exists")
)

type UserSummary struct {
	ID          string
	Username    string
	DisplayName string
	AvatarFile  string
	Role        string
}

type Comment struct {
	ID        string
	PostID    string
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
	PostID      string
	CommentID   string
	Type        string
	Preview     string
	Read        bool
	CreatedAt   time.Time
}

type Post struct {
	ID             string
	Author         UserSummary
	Title          string
	Summary        string
	Body           string
	CoverPath      string
	WordCount      int
	Visibility     string
	Status         string
	LikeCount      int
	LikedByMe      bool
	CommentCount   int
	RecentComments []Comment
	PublishedAt    time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type Page struct {
	Items      []Post
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

type AdminPost struct {
	Post
	ReportCount int
}

type AdminPage struct {
	Items      []AdminPost
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
			return nil, fmt.Errorf("create blog database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open blog database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS blog_posts (
			id TEXT PRIMARY KEY,
			author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			summary TEXT NOT NULL DEFAULT '',
			body TEXT NOT NULL,
			cover_path TEXT,
			word_count INTEGER NOT NULL DEFAULT 0,
			visibility TEXT NOT NULL CHECK(visibility IN ('public', 'friends', 'self')),
			status TEXT NOT NULL CHECK(status IN ('active', 'deleted', 'hidden')),
			published_at INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_blog_posts_public
			ON blog_posts(status, visibility, published_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_blog_posts_author
			ON blog_posts(author_id, published_at DESC, id DESC)`,
		`CREATE TABLE IF NOT EXISTS blog_likes (
			post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(post_id, user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_blog_likes_post
			ON blog_likes(post_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS blog_comments (
			id TEXT PRIMARY KEY,
			post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
			author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			parent_id TEXT REFERENCES blog_comments(id) ON DELETE CASCADE,
			body TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('active', 'deleted', 'hidden')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_blog_comments_post
			ON blog_comments(post_id, created_at, id)`,
		`CREATE INDEX IF NOT EXISTS idx_blog_comments_parent
			ON blog_comments(parent_id)`,
		`CREATE TABLE IF NOT EXISTS blog_notifications (
			id TEXT PRIMARY KEY,
			recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			post_id TEXT REFERENCES blog_posts(id) ON DELETE CASCADE,
			comment_id TEXT REFERENCES blog_comments(id) ON DELETE CASCADE,
			type TEXT NOT NULL CHECK(type IN ('post.like', 'post.comment', 'post.reply', 'post.mention')),
			preview TEXT NOT NULL DEFAULT '',
			read_at INTEGER,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_blog_notifications_recipient
			ON blog_notifications(recipient_id, created_at DESC, id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_blog_notifications_unread
			ON blog_notifications(recipient_id, read_at)`,
		`CREATE TABLE IF NOT EXISTS blog_reports (
			id TEXT PRIMARY KEY,
			target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
			target_id TEXT NOT NULL,
			reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			reason TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('pending', 'resolved', 'dismissed')),
			created_at INTEGER NOT NULL,
			UNIQUE(target_type, target_id, reporter_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_blog_reports_status
			ON blog_reports(status, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate blog: %w", err)
		}
	}
	return nil
}

func (s *Store) Create(
	ctx context.Context,
	authorID string,
	title string,
	summary string,
	body string,
	coverPath string,
	visibility string,
) (Post, error) {
	title, summary, body = strings.TrimSpace(title), strings.TrimSpace(summary), strings.TrimSpace(body)
	if title == "" || utf8.RuneCountInString(title) > MaxTitleRunes {
		return Post{}, ErrBodyInvalid
	}
	if utf8.RuneCountInString(summary) > MaxSummaryRunes {
		return Post{}, ErrBodyInvalid
	}
	if body == "" || utf8.RuneCountInString(body) > MaxBodyRunes {
		return Post{}, ErrBodyInvalid
	}
	if !validVisibility(visibility) {
		return Post{}, ErrBodyInvalid
	}
	now := time.Now().UTC()
	id := uuid.NewString()
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO blog_posts (
			id, author_id, title, summary, body, cover_path, word_count,
			visibility, status, published_at, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
		id,
		authorID,
		title,
		summary,
		body,
		nullableString(coverPath),
		utf8.RuneCountInString(body),
		visibility,
		now.UnixMilli(),
		now.UnixMilli(),
		now.UnixMilli(),
	)
	if err != nil {
		return Post{}, fmt.Errorf("create blog post: %w", err)
	}
	return s.Get(ctx, authorID, id)
}

func (s *Store) Get(ctx context.Context, viewerID string, postID string) (Post, error) {
	item, err := s.getPost(ctx, postID, viewerID)
	if err != nil {
		return Post{}, err
	}
	items := []Post{item}
	if err := s.enrichPosts(ctx, viewerID, items); err != nil {
		return Post{}, err
	}
	return items[0], nil
}

func (s *Store) ListFeed(
	ctx context.Context,
	viewerID string,
	tab string,
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

	query := `SELECT p.id, p.title, p.summary, p.body, p.cover_path, p.word_count,
	             p.visibility, p.status, p.published_at, p.created_at, p.updated_at,
	             u.id, u.username, u.display_name, u.avatar_file, u.role
	          FROM blog_posts p
	          JOIN users u ON u.id = p.author_id
	          WHERE p.status = 'active'`
	args := make([]any, 0, 8)
	switch tab {
	case "mine":
		query += ` AND p.author_id = ?`
		args = append(args, viewerID)
	case "friends":
		query += ` AND (
		            p.author_id = ?
		            OR (
		              p.visibility = 'friends'
		              AND p.author_id IN (
		                SELECT user_two_id FROM friendships WHERE user_one_id = ?
		                UNION
		                SELECT user_one_id FROM friendships WHERE user_two_id = ?
		              )
		            )
		          )`
		args = append(args, viewerID, viewerID, viewerID)
	default:
		query += ` AND p.visibility = 'public'`
	}
	if cursorMillis > 0 {
		query += ` AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))`
		args = append(args, cursorMillis, cursorMillis, cursorID)
	}
	query += ` ORDER BY p.published_at DESC, p.id DESC LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return Page{}, fmt.Errorf("list blog feed: %w", err)
	}
	defer rows.Close()

	items := make([]Post, 0, limit+1)
	for rows.Next() {
		item, err := scanPostRow(rows)
		if err != nil {
			return Page{}, fmt.Errorf("scan blog feed: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return Page{}, fmt.Errorf("iterate blog feed: %w", err)
	}

	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(items[limit-1].PublishedAt, items[limit-1].ID)
		items = items[:limit]
	}
	if err := s.enrichPosts(ctx, viewerID, items); err != nil {
		return Page{}, err
	}
	return Page{Items: items, NextCursor: nextCursor}, nil
}

func (s *Store) Update(
	ctx context.Context,
	userID string,
	postID string,
	title string,
	summary string,
	body string,
	visibility string,
) (Post, error) {
	title, summary, body = strings.TrimSpace(title), strings.TrimSpace(summary), strings.TrimSpace(body)
	if title == "" || utf8.RuneCountInString(title) > MaxTitleRunes {
		return Post{}, ErrBodyInvalid
	}
	if utf8.RuneCountInString(summary) > MaxSummaryRunes {
		return Post{}, ErrBodyInvalid
	}
	if body == "" || utf8.RuneCountInString(body) > MaxBodyRunes {
		return Post{}, ErrBodyInvalid
	}
	if !validVisibility(visibility) {
		return Post{}, ErrBodyInvalid
	}
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE blog_posts
		 SET title = ?, summary = ?, body = ?, word_count = ?, visibility = ?, updated_at = ?
		 WHERE id = ? AND author_id = ? AND status = 'active'`,
		title,
		summary,
		body,
		utf8.RuneCountInString(body),
		visibility,
		time.Now().UTC().UnixMilli(),
		postID,
		userID,
	)
	if err != nil {
		return Post{}, fmt.Errorf("update blog post: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Post{}, fmt.Errorf("update blog post rows: %w", err)
	}
	if affected == 0 {
		return Post{}, ErrNotFound
	}
	return s.Get(ctx, userID, postID)
}

func (s *Store) UpdateCover(
	ctx context.Context,
	userID string,
	postID string,
	coverPath string,
) (Post, error) {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE blog_posts SET cover_path = ?, updated_at = ?
		 WHERE id = ? AND author_id = ? AND status = 'active'`,
		nullableString(coverPath),
		time.Now().UTC().UnixMilli(),
		postID,
		userID,
	)
	if err != nil {
		return Post{}, fmt.Errorf("update blog cover: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Post{}, fmt.Errorf("update blog cover rows: %w", err)
	}
	if affected == 0 {
		return Post{}, ErrNotFound
	}
	return s.Get(ctx, userID, postID)
}

func (s *Store) Delete(ctx context.Context, userID string, postID string) error {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE blog_posts SET status = 'deleted', updated_at = ?
		 WHERE id = ? AND author_id = ? AND status = 'active'`,
		time.Now().UTC().UnixMilli(),
		postID,
		userID,
	)
	if err != nil {
		return fmt.Errorf("delete blog post: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete blog post rows: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AuthorOf(ctx context.Context, postID string) (string, error) {
	var authorID string
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT author_id FROM blog_posts WHERE id = ?`,
		postID,
	).Scan(&authorID); err != nil {
		return "", ErrNotFound
	}
	return authorID, nil
}

func (s *Store) Like(ctx context.Context, userID string, postID string) (bool, error) {
	if err := s.ensurePostVisible(ctx, userID, postID); err != nil {
		return false, err
	}
	result, err := s.db.ExecContext(
		ctx,
		`INSERT OR IGNORE INTO blog_likes (post_id, user_id, created_at)
		 VALUES (?, ?, ?)`,
		postID,
		userID,
		time.Now().UTC().UnixMilli(),
	)
	if err != nil {
		return false, fmt.Errorf("like blog post: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("like blog post rows: %w", err)
	}
	return affected > 0, nil
}

func (s *Store) Unlike(ctx context.Context, userID string, postID string) (bool, error) {
	result, err := s.db.ExecContext(
		ctx,
		`DELETE FROM blog_likes WHERE post_id = ? AND user_id = ?`,
		postID,
		userID,
	)
	if err != nil {
		return false, fmt.Errorf("unlike blog post: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("unlike blog post rows: %w", err)
	}
	return affected > 0, nil
}

func (s *Store) ListLikes(
	ctx context.Context,
	viewerID string,
	postID string,
	cursor string,
	limit int,
) ([]UserSummary, string, error) {
	if err := s.ensurePostVisible(ctx, viewerID, postID); err != nil {
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
	          FROM blog_likes l
	          JOIN users u ON u.id = l.user_id
	          WHERE l.post_id = ?`
	args := []any{postID}
	if cursorMillis > 0 {
		query += ` AND (l.created_at < ? OR (l.created_at = ? AND u.id < ?))`
		args = append(args, cursorMillis, cursorMillis, cursorID)
	}
	query += ` ORDER BY l.created_at DESC, u.id DESC LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, "", fmt.Errorf("list blog likes: %w", err)
	}
	defer rows.Close()
	users := make([]UserSummary, 0, limit+1)
	lastCreatedAt := int64(0)
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
			return nil, "", fmt.Errorf("scan blog like: %w", err)
		}
		lastCreatedAt = createdAt
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("iterate blog likes: %w", err)
	}
	nextCursor := ""
	if len(users) > limit {
		nextCursor = encodeCursor(time.UnixMilli(lastCreatedAt).UTC(), users[limit-1].ID)
		users = users[:limit]
	}
	return users, nextCursor, nil
}

func (s *Store) Comment(
	ctx context.Context,
	userID string,
	postID string,
	parentID string,
	body string,
	mentionUserIDs []string,
) (Comment, error) {
	if err := s.ensurePostVisible(ctx, userID, postID); err != nil {
		return Comment{}, err
	}
	body = strings.TrimSpace(body)
	if body == "" || utf8.RuneCountInString(body) > MaxCommentRunes {
		return Comment{}, ErrCommentInvalid
	}
	if parentID != "" {
		var parentPostID string
		var parentStatus string
		if err := s.db.QueryRowContext(
			ctx,
			`SELECT post_id, status FROM blog_comments WHERE id = ?`,
			parentID,
		).Scan(&parentPostID, &parentStatus); err != nil {
			return Comment{}, ErrCommentInvalid
		}
		if parentPostID != postID || parentStatus != PostStatusActive {
			return Comment{}, ErrCommentInvalid
		}
	}
	now := time.Now().UTC()
	id := uuid.NewString()
	comment, err := s.createComment(ctx, id, userID, postID, parentID, body, now)
	if err != nil {
		return Comment{}, err
	}
	if err := s.createCommentNotifications(ctx, userID, postID, id, body, parentID, mentionUserIDs, now); err != nil {
		return Comment{}, err
	}
	return comment, nil
}

func (s *Store) ListComments(
	ctx context.Context,
	viewerID string,
	postID string,
	cursor string,
	limit int,
) (CommentPage, error) {
	if err := s.ensurePostVisible(ctx, viewerID, postID); err != nil {
		return CommentPage{}, err
	}
	if limit <= 0 || limit > MaxPageSize {
		limit = DefaultPageSize
	}
	cursorMillis, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return CommentPage{}, ErrNotFound
	}
	query := `SELECT c.id, c.post_id, c.parent_id, c.body, c.status, c.created_at,
	             u.id, u.username, u.display_name, u.avatar_file, u.role
	          FROM blog_comments c
	          JOIN users u ON u.id = c.author_id
	          WHERE c.post_id = ? AND c.status = 'active'`
	args := []any{postID}
	if cursorMillis > 0 {
		query += ` AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))`
		args = append(args, cursorMillis, cursorMillis, cursorID)
	}
	query += ` ORDER BY c.created_at DESC, c.id DESC LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return CommentPage{}, fmt.Errorf("list blog comments: %w", err)
	}
	defer rows.Close()
	items := make([]Comment, 0, limit+1)
	for rows.Next() {
		item, err := scanCommentRow(rows)
		if err != nil {
			return CommentPage{}, fmt.Errorf("scan blog comment: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return CommentPage{}, fmt.Errorf("iterate blog comments: %w", err)
	}
	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(items[limit-1].CreatedAt, items[limit-1].ID)
		items = items[:limit]
	}
	return CommentPage{Items: items, NextCursor: nextCursor}, nil
}

func (s *Store) DeleteComment(ctx context.Context, userID string, commentID string) error {
	var authorID string
	var postID string
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT author_id, post_id FROM blog_comments WHERE id = ?`,
		commentID,
	).Scan(&authorID, &postID); err != nil {
		return ErrNotFound
	}
	if authorID != userID {
		var postAuthorID string
		if err := s.db.QueryRowContext(
			ctx,
			`SELECT author_id FROM blog_posts WHERE id = ?`,
			postID,
		).Scan(&postAuthorID); err != nil || postAuthorID != userID {
			return ErrForbidden
		}
	}
	if _, err := s.db.ExecContext(
		ctx,
		`UPDATE blog_comments SET status = 'deleted', updated_at = ? WHERE id = ? AND status = 'active'`,
		time.Now().UTC().UnixMilli(),
		commentID,
	); err != nil {
		return fmt.Errorf("delete blog comment: %w", err)
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
	query := `SELECT n.id, n.post_id, n.comment_id, n.type, n.preview, n.read_at, n.created_at,
	             u.id, u.username, u.display_name, u.avatar_file, u.role
	          FROM blog_notifications n
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
		return NotificationPage{}, fmt.Errorf("list blog notifications: %w", err)
	}
	defer rows.Close()
	items := make([]Notification, 0, limit+1)
	for rows.Next() {
		var item Notification
		var postID sql.NullString
		var commentID sql.NullString
		var readAt sql.NullInt64
		var createdAt int64
		if err := rows.Scan(
			&item.ID,
			&postID,
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
			return NotificationPage{}, fmt.Errorf("scan blog notification: %w", err)
		}
		item.RecipientID = userID
		item.PostID = postID.String
		item.CommentID = commentID.String
		item.Read = readAt.Valid
		item.CreatedAt = time.UnixMilli(createdAt).UTC()
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return NotificationPage{}, fmt.Errorf("iterate blog notifications: %w", err)
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
		`SELECT COUNT(*) FROM blog_notifications
		 WHERE recipient_id = ? AND read_at IS NULL`,
		userID,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("count unread blog notifications: %w", err)
	}
	return count, nil
}

func (s *Store) MarkNotificationsRead(ctx context.Context, userID string, postID string) error {
	now := time.Now().UTC().UnixMilli()
	if postID == "" {
		_, err := s.db.ExecContext(
			ctx,
			`UPDATE blog_notifications SET read_at = COALESCE(read_at, ?) WHERE recipient_id = ?`,
			now,
			userID,
		)
		return err
	}
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE blog_notifications SET read_at = COALESCE(read_at, ?)
		 WHERE recipient_id = ? AND post_id = ?`,
		now,
		userID,
		postID,
	)
	return err
}

func (s *Store) Report(ctx context.Context, userID string, targetType string, targetID string, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" || utf8.RuneCountInString(reason) > MaxReportRunes {
		return ErrCommentInvalid
	}
	switch targetType {
	case "post":
		if err := s.ensurePostVisible(ctx, userID, targetID); err != nil {
			return err
		}
	case "comment":
		var postID string
		if err := s.db.QueryRowContext(
			ctx,
			`SELECT post_id FROM blog_comments WHERE id = ? AND status = 'active'`,
			targetID,
		).Scan(&postID); err != nil {
			return ErrNotFound
		}
		if err := s.ensurePostVisible(ctx, userID, postID); err != nil {
			return err
		}
	default:
		return ErrCommentInvalid
	}
	result, err := s.db.ExecContext(
		ctx,
		`INSERT OR IGNORE INTO blog_reports (
			id, target_type, target_id, reporter_id, reason, status, created_at
		) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
		uuid.NewString(),
		targetType,
		targetID,
		userID,
		reason,
		time.Now().UTC().UnixMilli(),
	)
	if err != nil {
		return fmt.Errorf("create blog report: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("create blog report rows: %w", err)
	}
	if affected == 0 {
		return ErrReportExists
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
		status = PostStatusActive
	}
	cursorMillis, cursorID, err := decodeCursor(cursor)
	if err != nil {
		return AdminPage{}, ErrNotFound
	}
	query := `SELECT p.id, p.title, p.summary, p.body, p.cover_path, p.word_count,
	             p.visibility, p.status, p.published_at, p.created_at, p.updated_at,
	             u.id, u.username, u.display_name, u.avatar_file, u.role,
	             (SELECT COUNT(*) FROM blog_reports r
	              WHERE r.target_type = 'post' AND r.target_id = p.id AND r.status = 'pending') AS report_count
	          FROM blog_posts p
	          JOIN users u ON u.id = p.author_id
	          WHERE p.status = ?`
	args := []any{status}
	if cursorMillis > 0 {
		query += ` AND (p.published_at < ? OR (p.published_at = ? AND p.id < ?))`
		args = append(args, cursorMillis, cursorMillis, cursorID)
	}
	query += ` ORDER BY p.published_at DESC, p.id DESC LIMIT ?`
	args = append(args, limit+1)

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return AdminPage{}, fmt.Errorf("list admin blog posts: %w", err)
	}
	defer rows.Close()
	items := make([]AdminPost, 0, limit+1)
	for rows.Next() {
		var item AdminPost
		var coverPath sql.NullString
		var publishedAt, createdAt, updatedAt int64
		if err := rows.Scan(
			&item.ID,
			&item.Title,
			&item.Summary,
			&item.Body,
			&coverPath,
			&item.WordCount,
			&item.Visibility,
			&item.Status,
			&publishedAt,
			&createdAt,
			&updatedAt,
			&item.Author.ID,
			&item.Author.Username,
			&item.Author.DisplayName,
			&item.Author.AvatarFile,
			&item.Author.Role,
			&item.ReportCount,
		); err != nil {
			return AdminPage{}, fmt.Errorf("scan admin blog post: %w", err)
		}
		item.CoverPath = coverPath.String
		item.PublishedAt = time.UnixMilli(publishedAt).UTC()
		item.CreatedAt = time.UnixMilli(createdAt).UTC()
		item.UpdatedAt = time.UnixMilli(updatedAt).UTC()
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return AdminPage{}, fmt.Errorf("iterate admin blog posts: %w", err)
	}
	nextCursor := ""
	if len(items) > limit {
		nextCursor = encodeCursor(items[limit-1].PublishedAt, items[limit-1].ID)
		items = items[:limit]
	}
	return AdminPage{Items: items, NextCursor: nextCursor}, nil
}

func (s *Store) AdminHide(ctx context.Context, postID string) error {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE blog_posts SET status = 'hidden', updated_at = ?
		 WHERE id = ? AND status IN ('active', 'hidden')`,
		time.Now().UTC().UnixMilli(),
		postID,
	)
	if err != nil {
		return fmt.Errorf("hide admin blog post: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("hide admin blog post rows: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) getPost(ctx context.Context, postID string, viewerID string) (Post, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT p.id, p.title, p.summary, p.body, p.cover_path, p.word_count,
		        p.visibility, p.status, p.published_at, p.created_at, p.updated_at,
		        u.id, u.username, u.display_name, u.avatar_file, u.role
		 FROM blog_posts p
		 JOIN users u ON u.id = p.author_id
		 WHERE p.id = ?`,
		postID,
	)
	item, err := scanPostRow(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Post{}, ErrNotFound
		}
		return Post{}, fmt.Errorf("get blog post: %w", err)
	}
	if item.Status != PostStatusActive {
		return Post{}, ErrNotFound
	}
	if item.Author.ID != viewerID {
		if item.Visibility == VisibilityPublic {
			return item, nil
		}
		if viewerID == "" {
			return Post{}, ErrForbidden
		}
		allowed, err := s.isFriend(ctx, viewerID, item.Author.ID)
		if err != nil {
			return Post{}, err
		}
		if !allowed || item.Visibility != VisibilityFriends {
			return Post{}, ErrForbidden
		}
	}
	return item, nil
}

func (s *Store) ensurePostVisible(ctx context.Context, viewerID string, postID string) error {
	item, err := s.getPost(ctx, postID, viewerID)
	if err != nil {
		return err
	}
	if item.Status != PostStatusActive {
		return ErrNotFound
	}
	return nil
}

func (s *Store) enrichPosts(ctx context.Context, viewerID string, items []Post) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, 0, len(items))
	placeholders := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
		placeholders = append(placeholders, "?")
	}
	idList := strings.Join(placeholders, ",")
	args := make([]any, 0, len(ids)*2)
	for _, id := range ids {
		args = append(args, id)
	}

	likeCounts, likedByMe, err := s.loadLikeEnrichment(ctx, viewerID, idList, args)
	if err != nil {
		return err
	}
	commentCounts, err := s.loadCommentCounts(ctx, idList, args)
	if err != nil {
		return err
	}
	commentsByPost, err := s.loadRecentComments(ctx, idList, args, RecentCommentsLimit*len(items))
	if err != nil {
		return err
	}

	for index := range items {
		items[index].LikeCount = likeCounts[items[index].ID]
		items[index].LikedByMe = viewerID != "" && likedByMe[items[index].ID]
		items[index].CommentCount = commentCounts[items[index].ID]
		items[index].RecentComments = commentsByPost[items[index].ID]
	}
	return nil
}

func (s *Store) loadLikeEnrichment(
	ctx context.Context,
	viewerID string,
	idList string,
	args []any,
) (map[string]int, map[string]bool, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT l.post_id, COUNT(l.user_id),
		        MAX(CASE WHEN l.user_id = ? THEN 1 ELSE 0 END)
		 FROM blog_likes l
		 WHERE l.post_id IN (`+idList+`)
		 GROUP BY l.post_id`,
		append([]any{viewerID}, args...)...,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("enrich blog likes: %w", err)
	}
	defer rows.Close()
	likeCounts := make(map[string]int, len(args))
	likedByMe := make(map[string]bool, len(args))
	for rows.Next() {
		var postID string
		var count int
		var liked int
		if err := rows.Scan(&postID, &count, &liked); err != nil {
			return nil, nil, fmt.Errorf("scan blog like enrichment: %w", err)
		}
		likeCounts[postID] = count
		likedByMe[postID] = liked > 0
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("iterate blog like enrichment: %w", err)
	}
	return likeCounts, likedByMe, nil
}

func (s *Store) loadCommentCounts(
	ctx context.Context,
	idList string,
	args []any,
) (map[string]int, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT c.post_id, COUNT(*) FROM blog_comments c
		 WHERE c.status = 'active' AND c.post_id IN (`+idList+`)
		 GROUP BY c.post_id`,
		append([]any{}, args...)...,
	)
	if err != nil {
		return nil, fmt.Errorf("enrich blog comment counts: %w", err)
	}
	defer rows.Close()
	commentCounts := make(map[string]int, len(args))
	for rows.Next() {
		var postID string
		var count int
		if err := rows.Scan(&postID, &count); err != nil {
			return nil, fmt.Errorf("scan blog comment count: %w", err)
		}
		commentCounts[postID] = count
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate blog comment counts: %w", err)
	}
	return commentCounts, nil
}

func (s *Store) loadRecentComments(
	ctx context.Context,
	idList string,
	args []any,
	limit int,
) (map[string][]Comment, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT c.id, c.post_id, c.parent_id, c.body, c.status, c.created_at,
		        u.id, u.username, u.display_name, u.avatar_file, u.role
		 FROM blog_comments c
		 JOIN users u ON u.id = c.author_id
		 WHERE c.status = 'active' AND c.post_id IN (`+idList+`)
		 ORDER BY c.created_at DESC, c.id DESC
		 LIMIT ?`,
		append(append([]any{}, args...), limit)...,
	)
	if err != nil {
		return nil, fmt.Errorf("enrich blog comments: %w", err)
	}
	defer rows.Close()
	commentsByPost := make(map[string][]Comment, len(args))
	for rows.Next() {
		comment, err := scanCommentRow(rows)
		if err != nil {
			return nil, fmt.Errorf("scan blog comment enrichment: %w", err)
		}
		list := commentsByPost[comment.PostID]
		if len(list) < RecentCommentsLimit {
			list = append(list, comment)
			commentsByPost[comment.PostID] = list
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate blog comment enrichment: %w", err)
	}
	return commentsByPost, nil
}

func (s *Store) createComment(
	ctx context.Context,
	id string,
	authorID string,
	postID string,
	parentID string,
	body string,
	now time.Time,
) (Comment, error) {
	if _, err := s.db.ExecContext(
		ctx,
		`INSERT INTO blog_comments (
			id, post_id, author_id, parent_id, body, status, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
		id,
		postID,
		authorID,
		nullableString(parentID),
		body,
		now.UnixMilli(),
		now.UnixMilli(),
	); err != nil {
		return Comment{}, fmt.Errorf("create blog comment: %w", err)
	}
	var username, displayName, avatarFile, role string
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT username, display_name, avatar_file, role FROM users WHERE id = ?`,
		authorID,
	).Scan(&username, &displayName, &avatarFile, &role); err != nil {
		return Comment{}, fmt.Errorf("load blog comment author: %w", err)
	}
	return Comment{
		ID:        id,
		PostID:    postID,
		Author:    UserSummary{ID: authorID, Username: username, DisplayName: displayName, AvatarFile: avatarFile, Role: role},
		ParentID:  parentID,
		Body:      body,
		Status:    PostStatusActive,
		CreatedAt: now,
	}, nil
}

func (s *Store) createCommentNotifications(
	ctx context.Context,
	actorID string,
	postID string,
	commentID string,
	body string,
	parentID string,
	mentionUserIDs []string,
	now time.Time,
) error {
	var postAuthorID string
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT author_id FROM blog_posts WHERE id = ?`,
		postID,
	).Scan(&postAuthorID); err != nil {
		return ErrNotFound
	}
	preview := truncatePreview(body)
	recipients := make(map[string]string, 3)
	if postAuthorID != actorID {
		recipients[postAuthorID] = "post.comment"
	}
	if parentID != "" {
		var parentAuthorID string
		if err := s.db.QueryRowContext(
			ctx,
			`SELECT author_id FROM blog_comments WHERE id = ?`,
			parentID,
		).Scan(&parentAuthorID); err == nil && parentAuthorID != actorID {
			recipients[parentAuthorID] = "post.reply"
		}
	}
	for _, mentionID := range mentionUserIDs {
		mentionID = strings.TrimSpace(mentionID)
		if mentionID == "" || mentionID == actorID {
			continue
		}
		if _, exists := recipients[mentionID]; !exists {
			recipients[mentionID] = "post.mention"
		}
	}
	for recipientID, notificationType := range recipients {
		if _, err := s.db.ExecContext(
			ctx,
			`INSERT INTO blog_notifications (
				id, recipient_id, actor_id, post_id, comment_id, type, preview, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			uuid.NewString(),
			recipientID,
			actorID,
			postID,
			commentID,
			notificationType,
			preview,
			now.UnixMilli(),
		); err != nil {
			return fmt.Errorf("create blog comment notification: %w", err)
		}
	}
	return nil
}

func (s *Store) isFriend(ctx context.Context, userID string, otherID string) (bool, error) {
	one, two := orderedUsers(userID, otherID)
	var count int
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM friendships WHERE user_one_id = ? AND user_two_id = ?`,
		one,
		two,
	).Scan(&count); err != nil {
		return false, fmt.Errorf("check blog friendship: %w", err)
	}
	return count > 0, nil
}

func orderedUsers(first string, second string) (string, string) {
	if first < second {
		return first, second
	}
	return second, first
}

func validVisibility(visibility string) bool {
	return visibility == VisibilityPublic || visibility == VisibilityFriends || visibility == VisibilitySelf
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func truncatePreview(value string) string {
	runes := []rune(value)
	if len(runes) > 60 {
		return string(runes[:60]) + "..."
	}
	return value
}

func encodeCursor(t time.Time, id string) string {
	return fmt.Sprintf("%d_%s", t.UnixMilli(), id)
}

func decodeCursor(cursor string) (int64, string, error) {
	if strings.TrimSpace(cursor) == "" {
		return 0, "", nil
	}
	parts := strings.SplitN(cursor, "_", 2)
	if len(parts) != 2 {
		return 0, "", errors.New("invalid cursor")
	}
	var millis int64
	if _, err := fmt.Sscanf(parts[0], "%d", &millis); err != nil || millis <= 0 {
		return 0, "", errors.New("invalid cursor")
	}
	return millis, parts[1], nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanPostRow(row scanner) (Post, error) {
	var item Post
	var coverPath sql.NullString
	var publishedAt, createdAt, updatedAt int64
	if err := row.Scan(
		&item.ID,
		&item.Title,
		&item.Summary,
		&item.Body,
		&coverPath,
		&item.WordCount,
		&item.Visibility,
		&item.Status,
		&publishedAt,
		&createdAt,
		&updatedAt,
		&item.Author.ID,
		&item.Author.Username,
		&item.Author.DisplayName,
		&item.Author.AvatarFile,
		&item.Author.Role,
	); err != nil {
		return Post{}, err
	}
	item.CoverPath = coverPath.String
	item.PublishedAt = time.UnixMilli(publishedAt).UTC()
	item.CreatedAt = time.UnixMilli(createdAt).UTC()
	item.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	return item, nil
}

func scanCommentRow(row scanner) (Comment, error) {
	var item Comment
	var parentID sql.NullString
	var createdAt int64
	if err := row.Scan(
		&item.ID,
		&item.PostID,
		&parentID,
		&item.Body,
		&item.Status,
		&createdAt,
		&item.Author.ID,
		&item.Author.Username,
		&item.Author.DisplayName,
		&item.Author.AvatarFile,
		&item.Author.Role,
	); err != nil {
		return Comment{}, err
	}
	item.ParentID = parentID.String
	item.CreatedAt = time.UnixMilli(createdAt).UTC()
	return item, nil
}
