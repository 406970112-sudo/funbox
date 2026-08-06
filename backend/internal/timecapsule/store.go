package timecapsule

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

var (
	ErrInvalidInput      = errors.New("time capsule invalid input")
	ErrNotFound          = errors.New("time capsule not found")
	ErrForbidden         = errors.New("time capsule forbidden")
	ErrDatabasePathEmpty = errors.New("time capsule database path is empty")
)

const (
	ModePersonal = "personal"
	ModeJoint    = "joint"

	StatusDraft   = "draft"
	StatusSealed  = "sealed"
	StatusOpened  = "opened"
	StatusArchived = "archived"

	InvitePending  = "pending"
	InviteAccepted = "accepted"
	InviteDeclined = "declined"
	InviteExited   = "exited"

	OpenDate       = "date"
	OpenBirthday   = "birthday"
	OpenDaysLeft   = "days_left"
	OpenFocusGoal  = "focus_goal"
	OpenFocusTask  = "focus_task"

	ContentText  = "text"
	ContentPhoto = "photo"
	ContentVoice = "voice"

	MaxTitleRunes       = 40
	MaxNoteRunes        = 200
	MaxTextRunes        = 2000
	MaxPersonalContents = 6
	MaxMemberContents   = 6
	MaxPhotos           = 6
	MaxVoices           = 1
)

type Capsule struct {
	ID                string     `json:"id"`
	CreatorID         string     `json:"creatorId"`
	Mode              string     `json:"mode"`
	Title             string     `json:"title"`
	Note              string     `json:"note"`
	OpenRule          string     `json:"openRule"`
	OpenAt            *time.Time `json:"openAt,omitempty"`
	OpenTimezone      string     `json:"openTimezone,omitempty"`
	LinkedDaysLeftID  string     `json:"linkedDaysLeftId,omitempty"`
	LinkedFocusGoalID string     `json:"linkedFocusGoalId,omitempty"`
	LinkedFocusTaskID string     `json:"linkedFocusTaskId,omitempty"`
	Status            string     `json:"status"`
	SealedAt          *time.Time `json:"sealedAt,omitempty"`
	OpenedAt          *time.Time `json:"openedAt,omitempty"`
	ArchivedAt        *time.Time `json:"archivedAt,omitempty"`
	ContentCount      int        `json:"contentCount"`
	MemberCount       int        `json:"memberCount"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type Member struct {
	ID            string     `json:"id"`
	CapsuleID     string     `json:"capsuleId"`
	UserID        string     `json:"userId"`
	DisplayName   string     `json:"displayName"`
	Username      string     `json:"username"`
	AvatarFile    string     `json:"avatarFile"`
	Role          string     `json:"role"`
	InviteStatus  string     `json:"inviteStatus"`
	InvitedAt     time.Time  `json:"invitedAt"`
	AcceptedAt    *time.Time `json:"acceptedAt,omitempty"`
	DeclinedAt    *time.Time `json:"declinedAt,omitempty"`
	ExitedAt      *time.Time `json:"exitedAt,omitempty"`
	ContentCount  int        `json:"contentCount"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type Content struct {
	ID          string    `json:"id"`
	CapsuleID   string    `json:"capsuleId"`
	UserID      string    `json:"userId"`
	Kind        string    `json:"kind"`
	TextContent string    `json:"textContent"`
	MediaID     string    `json:"mediaId,omitempty"`
	SortOrder   int       `json:"sortOrder"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type Media struct {
	ID         string    `json:"id"`
	CapsuleID  string    `json:"capsuleId"`
	UserID     string    `json:"userId"`
	Kind       string    `json:"kind"`
	FileName   string    `json:"fileName"`
	FilePath   string    `json:"-"`
	MimeType   string    `json:"mimeType"`
	ByteSize   int64     `json:"byteSize"`
	Width      int       `json:"width"`
	Height     int       `json:"height"`
	DurationMS int       `json:"durationMs"`
	CreatedAt  time.Time `json:"createdAt"`
}

type ContentWithMedia struct {
	Content
	MediaURL     string `json:"mediaUrl,omitempty"`
	FileName     string `json:"fileName,omitempty"`
	MimeType     string `json:"mimeType,omitempty"`
	Width        int    `json:"width,omitempty"`
	Height       int    `json:"height,omitempty"`
	DurationMS   int    `json:"durationMs,omitempty"`
}

type CapsuleInput struct {
	Mode              string     `json:"mode"`
	Title             string     `json:"title"`
	Note              string     `json:"note"`
	OpenRule          string     `json:"openRule"`
	OpenAt            *time.Time `json:"openAt,omitempty"`
	OpenTimezone      string     `json:"openTimezone,omitempty"`
	LinkedDaysLeftID  string     `json:"linkedDaysLeftId,omitempty"`
	LinkedFocusGoalID string     `json:"linkedFocusGoalId,omitempty"`
	LinkedFocusTaskID string     `json:"linkedFocusTaskId,omitempty"`
	FriendID          string     `json:"friendId,omitempty"`
}

type ContentInput struct {
	Kind        string `json:"kind"`
	TextContent string `json:"textContent"`
	MediaID     string `json:"mediaId,omitempty"`
}

type MediaInput struct {
	Kind       string
	FileName   string
	MimeType   string
	ByteSize   int64
	Width      int
	Height     int
	DurationMS int
}

type Notification struct {
	ID        string    `json:"id"`
	CapsuleID string    `json:"capsuleId"`
	Title     string    `json:"title"`
	Type      string    `json:"type"`
	Read      bool      `json:"read"`
	CreatedAt time.Time `json:"createdAt"`
}

type Home struct {
	Counts       HomeCounts `json:"counts"`
	Capsules     []Capsule  `json:"capsules"`
	Invitations  []Capsule  `json:"invitations"`
}

type HomeCounts struct {
	Draft      int `json:"draft"`
	Sealed     int `json:"sealed"`
	Opened     int `json:"opened"`
	Archived   int `json:"archived"`
	Invitations int `json:"invitations"`
}

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
			return nil, fmt.Errorf("create time capsule database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open time capsule database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS time_capsules (
			id TEXT PRIMARY KEY,
			creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			mode TEXT NOT NULL CHECK(mode IN ('personal', 'joint')),
			title TEXT NOT NULL,
			note TEXT NOT NULL DEFAULT '',
			open_rule TEXT NOT NULL,
			open_at INTEGER,
			open_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
			linked_days_left_id TEXT,
			linked_focus_goal_id TEXT,
			linked_focus_task_id TEXT,
			status TEXT NOT NULL DEFAULT 'draft'
				CHECK(status IN ('draft', 'sealed', 'opened', 'archived')),
			sealed_at INTEGER,
			opened_at INTEGER,
			archived_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_time_capsules_creator
			ON time_capsules(creator_id, status, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_time_capsules_status_open
			ON time_capsules(status, open_at)`,
		`CREATE TABLE IF NOT EXISTS time_capsule_members (
			id TEXT PRIMARY KEY,
			capsule_id TEXT NOT NULL REFERENCES time_capsules(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			role TEXT NOT NULL DEFAULT 'participant'
				CHECK(role IN ('creator', 'participant')),
			invite_status TEXT NOT NULL DEFAULT 'pending'
				CHECK(invite_status IN ('pending', 'accepted', 'declined', 'exited')),
			invited_at INTEGER NOT NULL,
			accepted_at INTEGER,
			declined_at INTEGER,
			exited_at INTEGER,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(capsule_id, user_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_time_capsule_members_user
			ON time_capsule_members(user_id, invite_status, updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS time_capsule_contents (
			id TEXT PRIMARY KEY,
			capsule_id TEXT NOT NULL REFERENCES time_capsules(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			kind TEXT NOT NULL CHECK(kind IN ('text', 'photo', 'voice')),
			text_content TEXT NOT NULL DEFAULT '',
			media_id TEXT,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_time_capsule_contents_capsule
			ON time_capsule_contents(capsule_id, user_id, sort_order)`,
		`CREATE TABLE IF NOT EXISTS time_capsule_media (
			id TEXT PRIMARY KEY,
			capsule_id TEXT NOT NULL REFERENCES time_capsules(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			kind TEXT NOT NULL CHECK(kind IN ('photo', 'voice')),
			file_name TEXT NOT NULL,
			file_path TEXT NOT NULL,
			mime_type TEXT NOT NULL,
			byte_size INTEGER NOT NULL DEFAULT 0,
			width INTEGER NOT NULL DEFAULT 0,
			height INTEGER NOT NULL DEFAULT 0,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS time_capsule_events (
			id TEXT PRIMARY KEY,
			capsule_id TEXT NOT NULL REFERENCES time_capsules(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL,
			action TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_time_capsule_events_capsule
			ON time_capsule_events(capsule_id, created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS time_capsule_notifications (
			id TEXT PRIMARY KEY,
			recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			capsule_id TEXT NOT NULL REFERENCES time_capsules(id) ON DELETE CASCADE,
			type TEXT NOT NULL,
			read_at INTEGER,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_time_capsule_notifications_recipient
			ON time_capsule_notifications(recipient_id, read_at, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate time capsule: %w", err)
		}
	}
	return nil
}

func (s *Store) CreateCapsule(ctx context.Context, userID string, input CapsuleInput) (Capsule, error) {
	input.Mode = strings.TrimSpace(input.Mode)
	input.OpenRule = strings.TrimSpace(input.OpenRule)
	input.Title = strings.TrimSpace(input.Title)
	input.Note = strings.TrimSpace(input.Note)
	if input.Mode != ModePersonal && input.Mode != ModeJoint {
		return Capsule{}, fmt.Errorf("%w: invalid mode", ErrInvalidInput)
	}
	if input.Title == "" || len([]rune(input.Title)) > MaxTitleRunes {
		return Capsule{}, fmt.Errorf("%w: invalid title", ErrInvalidInput)
	}
	if len([]rune(input.Note)) > MaxNoteRunes {
		return Capsule{}, fmt.Errorf("%w: invalid note", ErrInvalidInput)
	}
	if input.OpenTimezone == "" {
		input.OpenTimezone = "Asia/Shanghai"
	}

	now := time.Now().UTC()
	openAt, err := s.resolveOpenAt(ctx, userID, input, now)
	if err != nil {
		return Capsule{}, err
	}
	capsuleID := uuid.NewString()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Capsule{}, fmt.Errorf("begin create capsule: %w", err)
	}
	defer tx.Rollback()

	if input.Mode == ModeJoint {
		if strings.TrimSpace(input.FriendID) == "" || input.FriendID == userID {
			return Capsule{}, fmt.Errorf("%w: invalid friend", ErrInvalidInput)
		}
		var friends int
		if err := tx.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM friendships
			WHERE (user_one_id = ? AND user_two_id = ?)
			   OR (user_one_id = ? AND user_two_id = ?)
		`, userID, input.FriendID, input.FriendID, userID).Scan(&friends); err != nil {
			return Capsule{}, fmt.Errorf("check friendship: %w", err)
		}
		if friends == 0 {
			return Capsule{}, fmt.Errorf("%w: not friends", ErrInvalidInput)
		}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO time_capsules (
			id, creator_id, mode, title, note, open_rule, open_at, open_timezone,
			linked_days_left_id, linked_focus_goal_id, linked_focus_task_id,
			status, sealed_at, opened_at, archived_at, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, NULL, NULL, ?, ?)
	`, capsuleID, userID, input.Mode, input.Title, input.Note, input.OpenRule,
		optionalUnix(openAt), input.OpenTimezone,
		nullString(input.LinkedDaysLeftID), nullString(input.LinkedFocusGoalID),
		nullString(input.LinkedFocusTaskID), now.Unix(), now.Unix()); err != nil {
		return Capsule{}, fmt.Errorf("insert time capsule: %w", err)
	}

	if err := insertMember(ctx, tx, capsuleID, userID, "creator", InviteAccepted, now); err != nil {
		return Capsule{}, err
	}
	if input.Mode == ModeJoint {
		if err := insertMember(ctx, tx, capsuleID, input.FriendID, "participant", InvitePending, now); err != nil {
			return Capsule{}, err
		}
		if err := insertEvent(ctx, tx, capsuleID, userID, "invited", now); err != nil {
			return Capsule{}, err
		}
	}
	if err := insertEvent(ctx, tx, capsuleID, userID, "created", now); err != nil {
		return Capsule{}, err
	}
	if err := tx.Commit(); err != nil {
		return Capsule{}, fmt.Errorf("commit create capsule: %w", err)
	}
	return s.GetCapsule(ctx, userID, capsuleID)
}

func (s *Store) UpdateCapsule(ctx context.Context, userID, capsuleID string, input CapsuleInput) (Capsule, error) {
	current, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return Capsule{}, err
	}
	if current.Status != StatusDraft {
		return Capsule{}, fmt.Errorf("%w: sealed capsule cannot be edited", ErrForbidden)
	}
	if input.Title != "" {
		if len([]rune(strings.TrimSpace(input.Title))) > MaxTitleRunes {
			return Capsule{}, fmt.Errorf("%w: invalid title", ErrInvalidInput)
		}
		current.Title = strings.TrimSpace(input.Title)
	}
	if input.Note != "" {
		if len([]rune(strings.TrimSpace(input.Note))) > MaxNoteRunes {
			return Capsule{}, fmt.Errorf("%w: invalid note", ErrInvalidInput)
		}
		current.Note = strings.TrimSpace(input.Note)
	}
	if input.OpenRule != "" && input.OpenRule != current.OpenRule {
		current.OpenRule = input.OpenRule
		current.OpenAt = nil
		current.LinkedDaysLeftID = ""
		current.LinkedFocusGoalID = ""
		current.LinkedFocusTaskID = ""
	}
	if input.OpenAt != nil {
		current.OpenAt = input.OpenAt
	}
	if input.OpenTimezone != "" {
		current.OpenTimezone = input.OpenTimezone
	}
	if input.LinkedDaysLeftID != "" {
		current.LinkedDaysLeftID = strings.TrimSpace(input.LinkedDaysLeftID)
	}
	if input.LinkedFocusGoalID != "" {
		current.LinkedFocusGoalID = strings.TrimSpace(input.LinkedFocusGoalID)
	}
	if input.LinkedFocusTaskID != "" {
		current.LinkedFocusTaskID = strings.TrimSpace(input.LinkedFocusTaskID)
	}
	now := time.Now().UTC()
	openAt, err := s.resolveOpenAt(ctx, userID, capsuleInputFrom(current), now)
	if err != nil {
		return Capsule{}, err
	}
	current.OpenAt = openAt
	current.UpdatedAt = now
	if _, err := s.db.ExecContext(ctx, `
		UPDATE time_capsules
		SET title = ?, note = ?, open_rule = ?, open_at = ?, open_timezone = ?,
			linked_days_left_id = ?, linked_focus_goal_id = ?, linked_focus_task_id = ?,
			updated_at = ?
		WHERE id = ? AND status = 'draft'
	`, current.Title, current.Note, current.OpenRule, optionalUnix(current.OpenAt),
		current.OpenTimezone, nullString(current.LinkedDaysLeftID),
		nullString(current.LinkedFocusGoalID), nullString(current.LinkedFocusTaskID),
		now.Unix(), capsuleID); err != nil {
		return Capsule{}, fmt.Errorf("update capsule: %w", err)
	}
	return s.GetCapsule(ctx, userID, capsuleID)
}

func (s *Store) DeleteCapsule(ctx context.Context, userID, capsuleID string) error {
	current, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return err
	}
	if current.Status != StatusDraft || current.CreatorID != userID {
		return ErrForbidden
	}
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM time_capsules WHERE id = ? AND creator_id = ? AND status = 'draft'
	`, capsuleID, userID); err != nil {
		return fmt.Errorf("delete capsule: %w", err)
	}
	return nil
}

func (s *Store) GetCapsule(ctx context.Context, userID, capsuleID string) (Capsule, error) {
	var item Capsule
	var openAt, sealedAt, openedAt, archivedAt sql.NullInt64
	var createdAt, updatedAt int64
	var linkedDaysLeft, linkedFocusGoal, linkedFocusTask sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT c.id, c.creator_id, c.mode, c.title, c.note, c.open_rule, c.open_at,
			c.open_timezone, c.linked_days_left_id, c.linked_focus_goal_id,
			c.linked_focus_task_id, c.status, c.sealed_at, c.opened_at, c.archived_at,
			c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM time_capsule_contents cc WHERE cc.capsule_id = c.id),
			(SELECT COUNT(*) FROM time_capsule_members m
				WHERE m.capsule_id = c.id AND m.invite_status != 'exited')
		FROM time_capsules c
		WHERE c.id = ? AND EXISTS (
			SELECT 1 FROM time_capsule_members m
			WHERE m.capsule_id = c.id AND m.user_id = ?
		)
	`, capsuleID, userID).Scan(
		&item.ID, &item.CreatorID, &item.Mode, &item.Title, &item.Note, &item.OpenRule,
		&openAt, &item.OpenTimezone, &linkedDaysLeft, &linkedFocusGoal, &linkedFocusTask,
		&item.Status, &sealedAt, &openedAt, &archivedAt, &createdAt, &updatedAt,
		&item.ContentCount, &item.MemberCount,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Capsule{}, ErrNotFound
	}
	if err != nil {
		return Capsule{}, fmt.Errorf("get capsule: %w", err)
	}
	item.LinkedDaysLeftID = linkedDaysLeft.String
	item.LinkedFocusGoalID = linkedFocusGoal.String
	item.LinkedFocusTaskID = linkedFocusTask.String
	item.OpenAt = unixToTime(openAt)
	item.SealedAt = unixToTime(sealedAt)
	item.OpenedAt = unixToTime(openedAt)
	item.ArchivedAt = unixToTime(archivedAt)
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return item, nil
}

func (s *Store) ListHome(ctx context.Context, userID string) (Home, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.creator_id, c.mode, c.title, c.note, c.open_rule, c.open_at,
			c.open_timezone, c.linked_days_left_id, c.linked_focus_goal_id,
			c.linked_focus_task_id, c.status, c.sealed_at, c.opened_at, c.archived_at,
			c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM time_capsule_contents cc WHERE cc.capsule_id = c.id),
			(SELECT COUNT(*) FROM time_capsule_members m
				WHERE m.capsule_id = c.id AND m.invite_status != 'exited')
		FROM time_capsules c
		JOIN time_capsule_members m ON m.capsule_id = c.id
		WHERE m.user_id = ? AND m.invite_status != 'exited'
		ORDER BY c.updated_at DESC
	`, userID)
	if err != nil {
		return Home{}, fmt.Errorf("list home: %w", err)
	}
	defer rows.Close()

	home := Home{
		Counts:      HomeCounts{},
		Capsules:    []Capsule{},
		Invitations: []Capsule{},
	}
	for rows.Next() {
		item, err := scanCapsule(rows)
		if err != nil {
			return Home{}, err
		}
		switch item.Status {
		case StatusDraft:
			home.Counts.Draft++
		case StatusSealed:
			home.Counts.Sealed++
		case StatusOpened:
			home.Counts.Opened++
		case StatusArchived:
			home.Counts.Archived++
		}
		home.Capsules = append(home.Capsules, item)
	}
	if err := rows.Err(); err != nil {
		return Home{}, err
	}

	inviteRows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.creator_id, c.mode, c.title, c.note, c.open_rule, c.open_at,
			c.open_timezone, c.linked_days_left_id, c.linked_focus_goal_id,
			c.linked_focus_task_id, c.status, c.sealed_at, c.opened_at, c.archived_at,
			c.created_at, c.updated_at,
			(SELECT COUNT(*) FROM time_capsule_contents cc WHERE cc.capsule_id = c.id),
			(SELECT COUNT(*) FROM time_capsule_members m
				WHERE m.capsule_id = c.id AND m.invite_status != 'exited')
		FROM time_capsules c
		JOIN time_capsule_members m ON m.capsule_id = c.id
		WHERE m.user_id = ? AND m.invite_status = 'pending'
		ORDER BY c.updated_at DESC
	`, userID)
	if err != nil {
		return Home{}, fmt.Errorf("list invitations: %w", err)
	}
	defer inviteRows.Close()
	for inviteRows.Next() {
		item, err := scanCapsule(inviteRows)
		if err != nil {
			return Home{}, err
		}
		home.Invitations = append(home.Invitations, item)
	}
	home.Counts.Invitations = len(home.Invitations)
	return home, inviteRows.Err()
}

func (s *Store) ListMembers(ctx context.Context, userID, capsuleID string) ([]Member, error) {
	if _, err := s.GetCapsule(ctx, userID, capsuleID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT m.id, m.capsule_id, m.user_id, u.display_name, u.username, u.avatar_file,
			m.role, m.invite_status, m.invited_at, m.accepted_at, m.declined_at,
			m.exited_at, m.created_at, m.updated_at,
			(SELECT COUNT(*) FROM time_capsule_contents cc WHERE cc.capsule_id = m.capsule_id AND cc.user_id = m.user_id)
		FROM time_capsule_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.capsule_id = ?
		ORDER BY m.created_at ASC
	`, capsuleID)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}
	defer rows.Close()
	members := []Member{}
	for rows.Next() {
		var member Member
		var invitedAt, createdAt, updatedAt int64
		var acceptedAt, declinedAt, exitedAt sql.NullInt64
		if err := rows.Scan(&member.ID, &member.CapsuleID, &member.UserID,
			&member.DisplayName, &member.Username, &member.AvatarFile, &member.Role,
			&member.InviteStatus, &invitedAt, &acceptedAt, &declinedAt, &exitedAt,
			&createdAt, &updatedAt, &member.ContentCount); err != nil {
			return nil, err
		}
		member.InvitedAt = time.Unix(invitedAt, 0).UTC()
		member.AcceptedAt = unixToTime(acceptedAt)
		member.DeclinedAt = unixToTime(declinedAt)
		member.ExitedAt = unixToTime(exitedAt)
		member.CreatedAt = time.Unix(createdAt, 0).UTC()
		member.UpdatedAt = time.Unix(updatedAt, 0).UTC()
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Store) AddContent(ctx context.Context, userID, capsuleID string, input ContentInput) (Content, error) {
	current, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return Content{}, err
	}
	if current.Status != StatusDraft {
		return Content{}, fmt.Errorf("%w: capsule is not draft", ErrForbidden)
	}
	if err := s.ensureAcceptedMember(ctx, userID, capsuleID); err != nil {
		return Content{}, err
	}
	input.Kind = strings.TrimSpace(input.Kind)
	switch input.Kind {
	case ContentText:
		input.TextContent = strings.TrimSpace(input.TextContent)
		if input.TextContent == "" || len([]rune(input.TextContent)) > MaxTextRunes {
			return Content{}, fmt.Errorf("%w: invalid text", ErrInvalidInput)
		}
	case ContentPhoto, ContentVoice:
		if input.MediaID == "" {
			return Content{}, fmt.Errorf("%w: media required", ErrInvalidInput)
		}
		var mediaCount int
		if err := s.db.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM time_capsule_media
			WHERE capsule_id = ? AND user_id = ? AND id = ?
		`, capsuleID, userID, input.MediaID).Scan(&mediaCount); err != nil {
			return Content{}, fmt.Errorf("check media ownership: %w", err)
		}
		if mediaCount == 0 {
			return Content{}, fmt.Errorf("%w: media not found", ErrInvalidInput)
		}
	default:
		return Content{}, fmt.Errorf("%w: invalid content kind", ErrInvalidInput)
	}

	if err := s.validateContentLimits(ctx, userID, capsuleID, input.Kind); err != nil {
		return Content{}, err
	}
	now := time.Now().UTC()
	item := Content{
		ID:          uuid.NewString(),
		CapsuleID:   capsuleID,
		UserID:      userID,
		Kind:        input.Kind,
		TextContent: input.TextContent,
		MediaID:     strings.TrimSpace(input.MediaID),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO time_capsule_contents (
			id, capsule_id, user_id, kind, text_content, media_id, sort_order, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, item.ID, item.CapsuleID, item.UserID, item.Kind, item.TextContent,
		nullString(item.MediaID), 0, now.Unix(), now.Unix()); err != nil {
		return Content{}, fmt.Errorf("insert content: %w", err)
	}
	if err := insertEvent(ctx, s.db, capsuleID, userID, "content_added", now); err != nil {
		return Content{}, err
	}
	return item, nil
}

func (s *Store) UpdateContent(ctx context.Context, userID, capsuleID, contentID string, input ContentInput) (Content, error) {
	current, err := s.GetContent(ctx, userID, capsuleID, contentID)
	if err != nil {
		return Content{}, err
	}
	capsule, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return Content{}, err
	}
	if capsule.Status != StatusDraft {
		return Content{}, ErrForbidden
	}
	if current.UserID != userID {
		return Content{}, ErrForbidden
	}
	if current.Kind == ContentText {
		input.TextContent = strings.TrimSpace(input.TextContent)
		if input.TextContent == "" || len([]rune(input.TextContent)) > MaxTextRunes {
			return Content{}, fmt.Errorf("%w: invalid text", ErrInvalidInput)
		}
		current.TextContent = input.TextContent
	}
	current.UpdatedAt = time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE time_capsule_contents
		SET text_content = ?, updated_at = ?
		WHERE id = ? AND capsule_id = ? AND user_id = ?
	`, current.TextContent, current.UpdatedAt.Unix(), contentID, capsuleID, userID); err != nil {
		return Content{}, fmt.Errorf("update content: %w", err)
	}
	return current, nil
}

func (s *Store) DeleteContent(ctx context.Context, userID, capsuleID, contentID string) error {
	current, err := s.GetContent(ctx, userID, capsuleID, contentID)
	if err != nil {
		return err
	}
	capsule, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return err
	}
	if capsule.Status != StatusDraft {
		return ErrForbidden
	}
	if current.UserID != userID {
		return ErrForbidden
	}
	if _, err := s.db.ExecContext(ctx, `
		DELETE FROM time_capsule_contents WHERE id = ? AND capsule_id = ? AND user_id = ?
	`, contentID, capsuleID, userID); err != nil {
		return fmt.Errorf("delete content: %w", err)
	}
	return nil
}

func (s *Store) GetContent(ctx context.Context, userID, capsuleID, contentID string) (Content, error) {
	if _, err := s.GetCapsule(ctx, userID, capsuleID); err != nil {
		return Content{}, err
	}
	var item Content
	var mediaID sql.NullString
	var createdAt, updatedAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, capsule_id, user_id, kind, text_content, media_id, sort_order, created_at, updated_at
		FROM time_capsule_contents
		WHERE id = ? AND capsule_id = ?
	`, contentID, capsuleID).Scan(&item.ID, &item.CapsuleID, &item.UserID, &item.Kind,
		&item.TextContent, &mediaID, &item.SortOrder, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Content{}, ErrNotFound
	}
	if err != nil {
		return Content{}, fmt.Errorf("get content: %w", err)
	}
	item.MediaID = mediaID.String
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return item, nil
}

func (s *Store) AddMedia(ctx context.Context, userID, capsuleID string, input MediaInput) (Media, error) {
	current, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return Media{}, err
	}
	if current.Status != StatusDraft {
		return Media{}, fmt.Errorf("%w: capsule is not draft", ErrForbidden)
	}
	if err := s.ensureAcceptedMember(ctx, userID, capsuleID); err != nil {
		return Media{}, err
	}
	input.Kind = strings.TrimSpace(input.Kind)
	if input.Kind != ContentPhoto && input.Kind != ContentVoice {
		return Media{}, fmt.Errorf("%w: invalid media kind", ErrInvalidInput)
	}
	if err := s.validateContentLimits(ctx, userID, capsuleID, input.Kind); err != nil {
		return Media{}, err
	}
	now := time.Now().UTC()
	item := Media{
		ID:         uuid.NewString(),
		CapsuleID:  capsuleID,
		UserID:     userID,
		Kind:       input.Kind,
		FileName:   strings.TrimSpace(input.FileName),
		FilePath:   strings.TrimSpace(input.FileName),
		MimeType:   strings.TrimSpace(input.MimeType),
		ByteSize:   input.ByteSize,
		Width:      input.Width,
		Height:     input.Height,
		DurationMS: input.DurationMS,
		CreatedAt:  now,
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO time_capsule_media (
			id, capsule_id, user_id, kind, file_name, file_path, mime_type, byte_size,
			width, height, duration_ms, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, item.ID, item.CapsuleID, item.UserID, item.Kind, item.FileName, item.FilePath,
		item.MimeType, item.ByteSize, item.Width, item.Height, item.DurationMS, now.Unix()); err != nil {
		return Media{}, fmt.Errorf("insert media: %w", err)
	}
	return item, nil
}

func (s *Store) GetMedia(ctx context.Context, userID, mediaID string) (Media, error) {
	var item Media
	var createdAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, capsule_id, user_id, kind, file_name, file_path, mime_type, byte_size,
			width, height, duration_ms, created_at
		FROM time_capsule_media WHERE id = ?
	`, mediaID).Scan(&item.ID, &item.CapsuleID, &item.UserID, &item.Kind, &item.FileName,
		&item.FilePath, &item.MimeType, &item.ByteSize, &item.Width, &item.Height,
		&item.DurationMS, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Media{}, ErrNotFound
	}
	if err != nil {
		return Media{}, fmt.Errorf("get media: %w", err)
	}
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	return item, nil
}

func (s *Store) GetMediaByFileName(ctx context.Context, fileName string) (Media, error) {
	var item Media
	var createdAt int64
	err := s.db.QueryRowContext(ctx, `
		SELECT id, capsule_id, user_id, kind, file_name, file_path, mime_type, byte_size,
			width, height, duration_ms, created_at
		FROM time_capsule_media WHERE file_name = ?
	`, strings.TrimSpace(fileName)).Scan(&item.ID, &item.CapsuleID, &item.UserID, &item.Kind,
		&item.FileName, &item.FilePath, &item.MimeType, &item.ByteSize, &item.Width, &item.Height,
		&item.DurationMS, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Media{}, ErrNotFound
	}
	if err != nil {
		return Media{}, fmt.Errorf("get media by file name: %w", err)
	}
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	return item, nil
}

func (s *Store) ListContents(ctx context.Context, userID, capsuleID string, includeAll bool) ([]ContentWithMedia, error) {
	current, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return nil, err
	}
	if current.Status == StatusSealed {
		return []ContentWithMedia{}, nil
	}
	if current.Status == StatusDraft && !includeAll {
		// Draft view only returns the current member's own content.
	}
	query := `
		SELECT cc.id, cc.capsule_id, cc.user_id, cc.kind, cc.text_content, cc.media_id,
			cc.sort_order, cc.created_at, cc.updated_at,
			m.file_name, m.mime_type, m.width, m.height, m.duration_ms
		FROM time_capsule_contents cc
		LEFT JOIN time_capsule_media m ON m.id = cc.media_id
		WHERE cc.capsule_id = ?`
	args := []any{capsuleID}
	if current.Status == StatusDraft {
		query += " AND cc.user_id = ?"
		args = append(args, userID)
	}
	query += " ORDER BY cc.sort_order ASC, cc.created_at ASC"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list contents: %w", err)
	}
	defer rows.Close()
	items := []ContentWithMedia{}
	for rows.Next() {
		var item ContentWithMedia
		var mediaID, fileName, mimeType sql.NullString
		var createdAt, updatedAt int64
		var width, height, durationMS sql.NullInt64
		if err := rows.Scan(&item.ID, &item.CapsuleID, &item.UserID, &item.Kind,
			&item.TextContent, &mediaID, &item.SortOrder, &createdAt, &updatedAt,
			&fileName, &mimeType, &width, &height, &durationMS); err != nil {
			return nil, err
		}
		item.MediaID = mediaID.String
		item.FileName = fileName.String
		item.MimeType = mimeType.String
		item.Width = int(width.Int64)
		item.Height = int(height.Int64)
		item.DurationMS = int(durationMS.Int64)
		item.CreatedAt = time.Unix(createdAt, 0).UTC()
		item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) AcceptInvite(ctx context.Context, userID, capsuleID string) (Capsule, error) {
	current, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return Capsule{}, err
	}
	if current.Mode != ModeJoint || current.Status != StatusDraft {
		return Capsule{}, fmt.Errorf("%w: not joinable", ErrForbidden)
	}
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `
		UPDATE time_capsule_members
		SET invite_status = 'accepted', accepted_at = ?, updated_at = ?
		WHERE capsule_id = ? AND user_id = ? AND invite_status = 'pending'
	`, now.Unix(), now.Unix(), capsuleID, userID)
	if err != nil {
		return Capsule{}, fmt.Errorf("accept invite: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Capsule{}, err
	}
	if affected == 0 {
		return Capsule{}, fmt.Errorf("%w: invite not pending", ErrForbidden)
	}
	if err := insertEvent(ctx, s.db, capsuleID, userID, "accepted", now); err != nil {
		return Capsule{}, err
	}
	return s.GetCapsule(ctx, userID, capsuleID)
}

func (s *Store) DeclineInvite(ctx context.Context, userID, capsuleID string) error {
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `
		UPDATE time_capsule_members
		SET invite_status = 'declined', declined_at = ?, updated_at = ?
		WHERE capsule_id = ? AND user_id = ? AND invite_status = 'pending'
	`, now.Unix(), now.Unix(), capsuleID, userID)
	if err != nil {
		return fmt.Errorf("decline invite: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrForbidden
	}
	return insertEvent(ctx, s.db, capsuleID, userID, "declined", now)
}

func (s *Store) ExitCapsule(ctx context.Context, userID, capsuleID string) error {
	current, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return err
	}
	if current.Status != StatusDraft || current.CreatorID == userID {
		return ErrForbidden
	}
	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE time_capsule_members
		SET invite_status = 'exited', exited_at = ?, updated_at = ?
		WHERE capsule_id = ? AND user_id = ?
	`, now.Unix(), now.Unix(), capsuleID, userID); err != nil {
		return fmt.Errorf("exit capsule: %w", err)
	}
	return insertEvent(ctx, s.db, capsuleID, userID, "exited", now)
}

func (s *Store) Seal(ctx context.Context, userID, capsuleID string) (Capsule, error) {
	current, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return Capsule{}, err
	}
	if current.Status != StatusDraft {
		return Capsule{}, fmt.Errorf("%w: capsule already sealed", ErrForbidden)
	}
	members, err := s.ListMembers(ctx, userID, capsuleID)
	if err != nil {
		return Capsule{}, err
	}
	for _, member := range members {
		if member.InviteStatus != InviteAccepted {
			return Capsule{}, fmt.Errorf("%w: member has not accepted", ErrInvalidInput)
		}
		if member.ContentCount < 1 {
			return Capsule{}, fmt.Errorf("%w: member needs content", ErrInvalidInput)
		}
	}
	now := time.Now().UTC()
	openAt, err := s.resolveOpenAt(ctx, current.CreatorID, capsuleInputFrom(current), now)
	if err != nil {
		return Capsule{}, err
	}
	if openAt != nil && !openAt.After(now) {
		return Capsule{}, fmt.Errorf("%w: open time must be in future", ErrInvalidInput)
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE time_capsules
		SET status = 'sealed', open_at = ?, sealed_at = ?, updated_at = ?
		WHERE id = ? AND status = 'draft'
	`, optionalUnix(openAt), now.Unix(), now.Unix(), capsuleID); err != nil {
		return Capsule{}, fmt.Errorf("seal capsule: %w", err)
	}
	if err := insertEvent(ctx, s.db, capsuleID, userID, "sealed", now); err != nil {
		return Capsule{}, err
	}
	for _, member := range members {
		if err := s.createNotification(ctx, member.UserID, capsuleID, "capsule.sealed"); err != nil {
			return Capsule{}, err
		}
	}
	return s.GetCapsule(ctx, userID, capsuleID)
}

func (s *Store) Archive(ctx context.Context, userID, capsuleID string) (Capsule, error) {
	current, err := s.GetCapsule(ctx, userID, capsuleID)
	if err != nil {
		return Capsule{}, err
	}
	if current.Status != StatusOpened {
		return Capsule{}, fmt.Errorf("%w: only opened capsule can be archived", ErrForbidden)
	}
	now := time.Now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE time_capsules SET status = 'archived', archived_at = ?, updated_at = ?
		WHERE id = ? AND status = 'opened'
	`, now.Unix(), now.Unix(), capsuleID); err != nil {
		return Capsule{}, fmt.Errorf("archive capsule: %w", err)
	}
	return s.GetCapsule(ctx, userID, capsuleID)
}

func (s *Store) ListNotifications(ctx context.Context, userID string, limit int) ([]Notification, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT n.id, n.capsule_id, c.title, n.type, n.read_at, n.created_at
		FROM time_capsule_notifications n
		JOIN time_capsules c ON c.id = n.capsule_id
		WHERE n.recipient_id = ?
		ORDER BY n.created_at DESC
		LIMIT ?
	`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list notifications: %w", err)
	}
	defer rows.Close()
	items := []Notification{}
	for rows.Next() {
		var item Notification
		var readAt sql.NullInt64
		var createdAt int64
		if err := rows.Scan(&item.ID, &item.CapsuleID, &item.Title, &item.Type, &readAt, &createdAt); err != nil {
			return nil, err
		}
		item.Read = readAt.Valid
		item.CreatedAt = time.Unix(createdAt, 0).UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) MarkNotificationsRead(ctx context.Context, userID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, 0, len(ids)+2)
	args = append(args, time.Now().UTC().Unix())
	args = append(args, userID)
	for _, id := range ids {
		args = append(args, id)
	}
	_, err := s.db.ExecContext(ctx, `
		UPDATE time_capsule_notifications
		SET read_at = COALESCE(read_at, ?)
		WHERE recipient_id = ? AND id IN (`+placeholders+`)
	`, args...)
	return err
}

func (s *Store) ListBirthdaySource(ctx context.Context, userID string) (string, error) {
	var birthday string
	err := s.db.QueryRowContext(ctx, `SELECT birthday FROM users WHERE id = ?`, userID).Scan(&birthday)
	if err != nil {
		return "", fmt.Errorf("get birthday: %w", err)
	}
	return birthday, nil
}

func (s *Store) ListDaysLeftSources(ctx context.Context, userID string) ([]map[string]any, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, expiry_date
		FROM days_left_records
		WHERE user_id = ? AND status = 'active' AND expiry_date > ?
		ORDER BY expiry_date ASC
	`, userID, time.Now().Format("2006-01-02"))
	if err != nil {
		return nil, fmt.Errorf("list days left sources: %w", err)
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name, expiry string
		if err := rows.Scan(&id, &name, &expiry); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id":        id,
			"name":      name,
			"expiryDate": expiry,
		})
	}
	return items, rows.Err()
}

func (s *Store) ListFocusSources(ctx context.Context, userID string) ([]map[string]any, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT 'goal' AS kind, id, title, completed_at IS NOT NULL AS done
		FROM focus_goals WHERE user_id = ? AND completed_at IS NULL
		UNION ALL
		SELECT 'task' AS kind, id, title, status = 'done' AS done
		FROM focus_tasks WHERE user_id = ? AND status = 'open'
		ORDER BY title ASC
	`, userID, userID)
	if err != nil {
		return nil, fmt.Errorf("list focus sources: %w", err)
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var kind, id, title string
		var done int
		if err := rows.Scan(&kind, &id, &title, &done); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"kind":  kind,
			"id":    id,
			"title": title,
			"done":  done == 1,
		})
	}
	return items, rows.Err()
}

func (s *Store) OpenDue(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, creator_id, open_rule, open_at, linked_days_left_id,
			linked_focus_goal_id, linked_focus_task_id
		FROM time_capsules WHERE status = 'sealed'
	`)
	if err != nil {
		return 0, fmt.Errorf("list due capsules: %w", err)
	}
	defer rows.Close()
	type dueRow struct {
		id, creator, rule                  string
		daysLeft, goal, task               sql.NullString
		openAt                             sql.NullInt64
	}
	rowsData := []dueRow{}
	for rows.Next() {
		var row dueRow
		if err := rows.Scan(&row.id, &row.creator, &row.rule, &row.openAt,
			&row.daysLeft, &row.goal, &row.task); err != nil {
			return 0, err
		}
		rowsData = append(rowsData, row)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	opened := 0
	for _, row := range rowsData {
		shouldOpen := false
		switch row.rule {
		case OpenDate, OpenBirthday:
			shouldOpen = row.openAt.Valid && row.openAt.Int64 > 0 && row.openAt.Int64 <= now.Unix()
		case OpenDaysLeft:
			var expiry string
			err := s.db.QueryRowContext(ctx, `
				SELECT expiry_date FROM days_left_records
				WHERE id = ? AND user_id = ? AND status = 'active'
			`, row.daysLeft.String, row.creator).Scan(&expiry)
			shouldOpen = err == nil && expiry <= now.Format("2006-01-02")
		case OpenFocusGoal:
			var completedAt sql.NullInt64
			err := s.db.QueryRowContext(ctx, `
				SELECT completed_at FROM focus_goals
				WHERE id = ? AND user_id = ?
			`, row.goal.String, row.creator).Scan(&completedAt)
			shouldOpen = err == nil && completedAt.Valid
		case OpenFocusTask:
			var status string
			err := s.db.QueryRowContext(ctx, `
				SELECT status FROM focus_tasks
				WHERE id = ? AND user_id = ?
			`, row.task.String, row.creator).Scan(&status)
			shouldOpen = err == nil && status == "done"
		}
		if !shouldOpen {
			continue
		}
		if err := s.markOpened(ctx, row.id, now); err != nil {
			return opened, err
		}
		opened++
	}
	return opened, nil
}

func (s *Store) OpenDueLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			if _, err := s.OpenDue(ctx, now.UTC()); err != nil {
				// Background opening failures are retried on the next tick.
			}
		}
	}
}

func (s *Store) markOpened(ctx context.Context, capsuleID string, now time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		UPDATE time_capsules SET status = 'opened', opened_at = ?, updated_at = ?
		WHERE id = ? AND status = 'sealed'
	`, now.Unix(), now.Unix(), capsuleID); err != nil {
		return fmt.Errorf("mark opened: %w", err)
	}
	if err := insertEvent(ctx, tx, capsuleID, "", "opened", now); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT user_id FROM time_capsule_members
		WHERE capsule_id = ? AND invite_status = 'accepted'
	`, capsuleID)
	if err != nil {
		return err
	}
	memberIDs := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		memberIDs = append(memberIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, memberID := range memberIDs {
		if err := insertNotification(ctx, tx, memberID, capsuleID, "capsule.opened", now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) resolveOpenAt(ctx context.Context, userID string, input CapsuleInput, now time.Time) (*time.Time, error) {
	switch input.OpenRule {
	case OpenDate:
		if input.OpenAt == nil {
			return nil, fmt.Errorf("%w: open time required", ErrInvalidInput)
		}
		if !input.OpenAt.After(now) {
			return nil, fmt.Errorf("%w: open time must be in future", ErrInvalidInput)
		}
		return input.OpenAt, nil
	case OpenBirthday:
		birthday, err := s.ListBirthdaySource(ctx, userID)
		if err != nil {
			return nil, err
		}
		if birthday == "" {
			return nil, fmt.Errorf("%w: birthday missing", ErrInvalidInput)
		}
		value, err := nextBirthday(birthday, input.OpenTimezone, now)
		if err != nil {
			return nil, err
		}
		return &value, nil
	case OpenDaysLeft:
		if input.LinkedDaysLeftID == "" {
			return nil, fmt.Errorf("%w: days left record required", ErrInvalidInput)
		}
		var expiry string
		if err := s.db.QueryRowContext(ctx, `
			SELECT expiry_date FROM days_left_records
			WHERE id = ? AND user_id = ? AND status = 'active'
		`, input.LinkedDaysLeftID, userID).Scan(&expiry); err != nil {
			return nil, fmt.Errorf("%w: days left record not found", ErrInvalidInput)
		}
		value, err := dateAtTime(expiry, input.OpenTimezone, 9, 0)
		if err != nil {
			return nil, err
		}
		return &value, nil
	case OpenFocusGoal:
		if input.LinkedFocusGoalID == "" {
			return nil, fmt.Errorf("%w: focus goal required", ErrInvalidInput)
		}
		var completedAt sql.NullInt64
		if err := s.db.QueryRowContext(ctx, `
			SELECT completed_at FROM focus_goals WHERE id = ? AND user_id = ?
		`, input.LinkedFocusGoalID, userID).Scan(&completedAt); err != nil {
			return nil, fmt.Errorf("%w: focus goal not found", ErrInvalidInput)
		}
		if completedAt.Valid {
			return nil, fmt.Errorf("%w: focus goal already completed", ErrInvalidInput)
		}
		return nil, nil
	case OpenFocusTask:
		if input.LinkedFocusTaskID == "" {
			return nil, fmt.Errorf("%w: focus task required", ErrInvalidInput)
		}
		var status string
		if err := s.db.QueryRowContext(ctx, `
			SELECT status FROM focus_tasks WHERE id = ? AND user_id = ?
		`, input.LinkedFocusTaskID, userID).Scan(&status); err != nil {
			return nil, fmt.Errorf("%w: focus task not found", ErrInvalidInput)
		}
		if status != "open" {
			return nil, fmt.Errorf("%w: focus task is not open", ErrInvalidInput)
		}
		return nil, nil
	default:
		return nil, fmt.Errorf("%w: invalid open rule", ErrInvalidInput)
	}
}

func (s *Store) validateContentLimits(ctx context.Context, userID, capsuleID, kind string) error {
	var count int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM time_capsule_contents
		WHERE capsule_id = ? AND user_id = ?
	`, capsuleID, userID).Scan(&count); err != nil {
		return err
	}
	if count >= MaxMemberContents {
		return fmt.Errorf("%w: too many contents", ErrInvalidInput)
	}
	var kindCount int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM time_capsule_contents
		WHERE capsule_id = ? AND user_id = ? AND kind = ?
	`, capsuleID, userID, kind).Scan(&kindCount); err != nil {
		return err
	}
	if kind == ContentPhoto && kindCount >= MaxPhotos {
		return fmt.Errorf("%w: too many photos", ErrInvalidInput)
	}
	if kind == ContentVoice && kindCount >= MaxVoices {
		return fmt.Errorf("%w: too many voices", ErrInvalidInput)
	}
	return nil
}

func (s *Store) ensureAcceptedMember(ctx context.Context, userID, capsuleID string) error {
	var count int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM time_capsule_members
		WHERE capsule_id = ? AND user_id = ? AND invite_status = 'accepted'
	`, capsuleID, userID).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return ErrForbidden
	}
	return nil
}

func (s *Store) createNotification(ctx context.Context, recipientID, capsuleID, notificationType string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO time_capsule_notifications (
			id, recipient_id, capsule_id, type, read_at, created_at
		) VALUES (?, ?, ?, ?, NULL, ?)
	`, uuid.NewString(), recipientID, capsuleID, notificationType, time.Now().UTC().Unix())
	return err
}

func scanCapsule(row rowScanner) (Capsule, error) {
	var item Capsule
	var openAt, sealedAt, openedAt, archivedAt sql.NullInt64
	var createdAt, updatedAt int64
	var linkedDaysLeft, linkedFocusGoal, linkedFocusTask sql.NullString
	err := row.Scan(
		&item.ID, &item.CreatorID, &item.Mode, &item.Title, &item.Note, &item.OpenRule,
		&openAt, &item.OpenTimezone, &linkedDaysLeft, &linkedFocusGoal, &linkedFocusTask,
		&item.Status, &sealedAt, &openedAt, &archivedAt, &createdAt, &updatedAt,
		&item.ContentCount, &item.MemberCount,
	)
	if err != nil {
		return Capsule{}, err
	}
	item.LinkedDaysLeftID = linkedDaysLeft.String
	item.LinkedFocusGoalID = linkedFocusGoal.String
	item.LinkedFocusTaskID = linkedFocusTask.String
	item.OpenAt = unixToTime(openAt)
	item.SealedAt = unixToTime(sealedAt)
	item.OpenedAt = unixToTime(openedAt)
	item.ArchivedAt = unixToTime(archivedAt)
	item.CreatedAt = time.Unix(createdAt, 0).UTC()
	item.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return item, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func insertMember(ctx context.Context, q queryer, capsuleID, userID, role, inviteStatus string, now time.Time) error {
	var acceptedAt any
	if inviteStatus == InviteAccepted {
		acceptedAt = now.Unix()
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO time_capsule_members (
			id, capsule_id, user_id, role, invite_status, invited_at, accepted_at,
			declined_at, exited_at, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
	`, uuid.NewString(), capsuleID, userID, role, inviteStatus, now.Unix(), acceptedAt, now.Unix(), now.Unix())
	return err
}

func insertEvent(ctx context.Context, q queryer, capsuleID, userID, action string, now time.Time) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO time_capsule_events (id, capsule_id, user_id, action, created_at)
		VALUES (?, ?, ?, ?, ?)
	`, uuid.NewString(), capsuleID, userID, action, now.Unix())
	return err
}

func insertNotification(ctx context.Context, q queryer, recipientID, capsuleID, notificationType string, now time.Time) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO time_capsule_notifications (
			id, recipient_id, capsule_id, type, read_at, created_at
		) VALUES (?, ?, ?, ?, NULL, ?)
	`, uuid.NewString(), recipientID, capsuleID, notificationType, now.Unix())
	return err
}

type queryer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func capsuleInputFrom(item Capsule) CapsuleInput {
	return CapsuleInput{
		Mode:              item.Mode,
		Title:             item.Title,
		Note:              item.Note,
		OpenRule:          item.OpenRule,
		OpenAt:            item.OpenAt,
		OpenTimezone:      item.OpenTimezone,
		LinkedDaysLeftID:  item.LinkedDaysLeftID,
		LinkedFocusGoalID: item.LinkedFocusGoalID,
		LinkedFocusTaskID: item.LinkedFocusTaskID,
	}
}

func optionalUnix(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.Unix()
}

func unixToTime(value sql.NullInt64) *time.Time {
	if !value.Valid || value.Int64 <= 0 {
		return nil
	}
	parsed := time.Unix(value.Int64, 0).UTC()
	return &parsed
}

func nullString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func loadLocation(name string) (*time.Location, error) {
	if strings.TrimSpace(name) == "" {
		name = "Asia/Shanghai"
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.Local, fmt.Errorf("%w: invalid timezone", ErrInvalidInput)
	}
	return loc, nil
}

func nextBirthday(birthday, timezone string, now time.Time) (time.Time, error) {
	parsed, err := time.Parse("2006-01-02", birthday)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: invalid birthday", ErrInvalidInput)
	}
	loc, err := loadLocation(timezone)
	if err != nil {
		return time.Time{}, err
	}
	nowIn := now.In(loc)
	candidate := time.Date(nowIn.Year(), parsed.Month(), parsed.Day(), 9, 0, 0, 0, loc)
	if !candidate.After(nowIn) {
		candidate = time.Date(nowIn.Year()+1, parsed.Month(), parsed.Day(), 9, 0, 0, 0, loc)
	}
	return candidate.UTC(), nil
}

func dateAtTime(date, timezone string, hour, minute int) (time.Time, error) {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: invalid date", ErrInvalidInput)
	}
	loc, err := loadLocation(timezone)
	if err != nil {
		return time.Time{}, err
	}
	return time.Date(parsed.Year(), parsed.Month(), parsed.Day(), hour, minute, 0, 0, loc).UTC(), nil
}
