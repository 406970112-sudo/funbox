package user

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

	"my-first-expo-app/backend/internal/roles"
)

var (
	ErrNotFound           = errors.New("user not found")
	ErrProtectedAdminRole = errors.New("administrator role is protected")
	ErrRoleChanged        = errors.New("user role changed")
	ErrUsernameTaken      = errors.New("username already exists")
)

type User struct {
	ID                     string
	Username               string
	PasswordHash           string
	DisplayName            string
	Role                   roles.Role
	AvatarFile             string
	SecurityQuestion       string
	SecurityAnswerHash     string
	RecoveryFailedAttempts int
	RecoveryLockedUntil    time.Time
	TokenVersion           int
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

type Store struct {
	db *sql.DB
}

type ListOptions struct {
	Limit  int
	Offset int
	Query  string
	Role   roles.Role
}

type ListResult struct {
	Total int
	Users []User
}

type RoleChange struct {
	CreatedAt           time.Time
	FromRole            roles.Role
	ID                  string
	OperatorDisplayName string
	OperatorUserID      string
	OperatorUsername    string
	Reason              string
	TargetUserID        string
	ToRole              roles.Role
}

type RoleChangeListResult struct {
	Changes []RoleChange
	Total   int
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
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}
	db.SetMaxOpenConns(1)

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
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			username TEXT NOT NULL COLLATE NOCASE UNIQUE,
			password_hash TEXT NOT NULL,
			display_name TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'normal',
			avatar_file TEXT NOT NULL DEFAULT '',
			security_question TEXT NOT NULL DEFAULT '',
			security_answer_hash TEXT NOT NULL DEFAULT '',
			recovery_failed_attempts INTEGER NOT NULL DEFAULT 0,
			recovery_locked_until INTEGER NOT NULL DEFAULT 0,
			token_version INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS user_role_changes (
			id TEXT PRIMARY KEY,
			target_user_id TEXT NOT NULL,
			operator_user_id TEXT NOT NULL,
			from_role TEXT NOT NULL,
			to_role TEXT NOT NULL,
			reason TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			FOREIGN KEY(target_user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY(operator_user_id) REFERENCES users(id) ON DELETE RESTRICT
		)`,
		`CREATE INDEX IF NOT EXISTS idx_user_role_changes_target_created
			ON user_role_changes(target_user_id, created_at DESC)`,
	}

	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run database migration: %w", err)
		}
	}

	columns := []struct {
		name       string
		definition string
	}{
		{name: "security_question", definition: "TEXT NOT NULL DEFAULT ''"},
		{name: "security_answer_hash", definition: "TEXT NOT NULL DEFAULT ''"},
		{name: "recovery_failed_attempts", definition: "INTEGER NOT NULL DEFAULT 0"},
		{name: "recovery_locked_until", definition: "INTEGER NOT NULL DEFAULT 0"},
		{name: "role", definition: "TEXT NOT NULL DEFAULT 'normal'"},
	}
	for _, column := range columns {
		if err := s.ensureUserColumn(column.name, column.definition); err != nil {
			return err
		}
	}

	return nil
}

func (s *Store) ensureUserColumn(name string, definition string) error {
	rows, err := s.db.Query(`PRAGMA table_info(users)`)
	if err != nil {
		return fmt.Errorf("read users table info: %w", err)
	}

	found := false
	for rows.Next() {
		var cid int
		var columnName string
		var columnType string
		var notNull int
		var defaultValue any
		var primaryKey int
		if err := rows.Scan(
			&cid,
			&columnName,
			&columnType,
			&notNull,
			&defaultValue,
			&primaryKey,
		); err != nil {
			rows.Close()
			return fmt.Errorf("scan users table info: %w", err)
		}
		if columnName == name {
			found = true
		}
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close users table info: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate users table info: %w", err)
	}
	if found {
		return nil
	}

	if _, err := s.db.Exec(fmt.Sprintf(`ALTER TABLE users ADD COLUMN %s %s`, name, definition)); err != nil {
		return fmt.Errorf("add users.%s column: %w", name, err)
	}
	return nil
}

func (s *Store) Create(
	ctx context.Context,
	username string,
	passwordHash string,
	displayName string,
	securityQuestion string,
	securityAnswerHash string,
) (User, error) {
	now := time.Now().UTC()
	created := User{
		ID:                 uuid.NewString(),
		Username:           username,
		PasswordHash:       passwordHash,
		DisplayName:        displayName,
		Role:               roles.Normal,
		SecurityQuestion:   securityQuestion,
		SecurityAnswerHash: securityAnswerHash,
		TokenVersion:       1,
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO users (
			id, username, password_hash, display_name, role, avatar_file,
			security_question, security_answer_hash,
			recovery_failed_attempts, recovery_locked_until,
			token_version, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, '', ?, ?, 0, 0, ?, ?, ?)`,
		created.ID,
		created.Username,
		created.PasswordHash,
		created.DisplayName,
		created.Role,
		created.SecurityQuestion,
		created.SecurityAnswerHash,
		created.TokenVersion,
		created.CreatedAt.Unix(),
		created.UpdatedAt.Unix(),
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique constraint") {
			return User{}, ErrUsernameTaken
		}
		return User{}, fmt.Errorf("create user: %w", err)
	}

	return created, nil
}

func (s *Store) GetByID(ctx context.Context, id string) (User, error) {
	return scanUser(s.db.QueryRowContext(ctx, userSelect+` WHERE id = ?`, id))
}

func (s *Store) GetByUsername(ctx context.Context, username string) (User, error) {
	return scanUser(s.db.QueryRowContext(ctx, userSelect+` WHERE username = ?`, username))
}

func (s *Store) List(ctx context.Context, options ListOptions) (ListResult, error) {
	limit := options.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	offset := options.Offset
	if offset < 0 {
		offset = 0
	}

	clauses := make([]string, 0, 2)
	args := make([]any, 0, 4)
	if query := strings.TrimSpace(options.Query); query != "" {
		clauses = append(clauses, `(username LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE)`)
		pattern := "%" + query + "%"
		args = append(args, pattern, pattern)
	}
	if options.Role != "" {
		if !roles.IsValid(options.Role) {
			return ListResult{}, fmt.Errorf("invalid role %q", options.Role)
		}
		clauses = append(clauses, `role = ?`)
		args = append(args, options.Role)
	}

	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`+where, args...).Scan(&total); err != nil {
		return ListResult{}, fmt.Errorf("count users: %w", err)
	}

	queryArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.QueryContext(
		ctx,
		userSelect+where+` ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
		queryArgs...,
	)
	if err != nil {
		return ListResult{}, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	users := make([]User, 0, limit)
	for rows.Next() {
		account, err := scanUser(rows)
		if err != nil {
			return ListResult{}, err
		}
		users = append(users, account)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, fmt.Errorf("iterate users: %w", err)
	}

	return ListResult{Total: total, Users: users}, nil
}

func (s *Store) UpdateRole(
	ctx context.Context,
	targetUserID string,
	operatorUserID string,
	expectedRole roles.Role,
	nextRole roles.Role,
	reason string,
) (User, bool, error) {
	if !roles.IsValid(expectedRole) || !roles.IsValid(nextRole) {
		return User{}, false, fmt.Errorf("invalid role transition %q to %q", expectedRole, nextRole)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return User{}, false, fmt.Errorf("begin role update: %w", err)
	}
	defer tx.Rollback()

	current, err := scanUser(tx.QueryRowContext(ctx, userSelect+` WHERE id = ?`, targetUserID))
	if err != nil {
		return User{}, false, err
	}
	if current.Role == roles.Admin {
		return User{}, false, ErrProtectedAdminRole
	}
	if current.Role == nextRole {
		return current, false, nil
	}
	if current.Role != expectedRole {
		return User{}, false, ErrRoleChanged
	}

	now := time.Now().UTC()
	result, err := tx.ExecContext(
		ctx,
		`UPDATE users SET role = ?, updated_at = ? WHERE id = ? AND role = ?`,
		nextRole,
		now.Unix(),
		targetUserID,
		expectedRole,
	)
	if err != nil {
		return User{}, false, fmt.Errorf("update user role: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return User{}, false, fmt.Errorf("read role update result: %w", err)
	}
	if rowsAffected != 1 {
		return User{}, false, ErrRoleChanged
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO user_role_changes (
			id, target_user_id, operator_user_id, from_role, to_role, reason, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		uuid.NewString(),
		targetUserID,
		operatorUserID,
		expectedRole,
		nextRole,
		strings.TrimSpace(reason),
		now.Unix(),
	); err != nil {
		return User{}, false, fmt.Errorf("create user role change: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return User{}, false, fmt.Errorf("commit role update: %w", err)
	}
	current.Role = nextRole
	current.UpdatedAt = now
	return current, true, nil
}

func (s *Store) ListRoleChangesByUserID(
	ctx context.Context,
	targetUserID string,
	limit int,
	offset int,
) (RoleChangeListResult, error) {
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var total int
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM user_role_changes WHERE target_user_id = ?`,
		targetUserID,
	).Scan(&total); err != nil {
		return RoleChangeListResult{}, fmt.Errorf("count user role changes: %w", err)
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT changes.id, changes.target_user_id, changes.operator_user_id,
			changes.from_role, changes.to_role, changes.reason, changes.created_at,
			operators.display_name, operators.username
		 FROM user_role_changes AS changes
		 JOIN users AS operators ON operators.id = changes.operator_user_id
		 WHERE changes.target_user_id = ?
		 ORDER BY changes.created_at DESC, changes.rowid DESC
		 LIMIT ? OFFSET ?`,
		targetUserID,
		limit,
		offset,
	)
	if err != nil {
		return RoleChangeListResult{}, fmt.Errorf("list user role changes: %w", err)
	}
	defer rows.Close()

	changes := make([]RoleChange, 0, limit)
	for rows.Next() {
		var change RoleChange
		var createdAt int64
		if err := rows.Scan(
			&change.ID,
			&change.TargetUserID,
			&change.OperatorUserID,
			&change.FromRole,
			&change.ToRole,
			&change.Reason,
			&createdAt,
			&change.OperatorDisplayName,
			&change.OperatorUsername,
		); err != nil {
			return RoleChangeListResult{}, fmt.Errorf("scan user role change: %w", err)
		}
		change.CreatedAt = time.Unix(createdAt, 0).UTC()
		changes = append(changes, change)
	}
	if err := rows.Err(); err != nil {
		return RoleChangeListResult{}, fmt.Errorf("iterate user role changes: %w", err)
	}

	return RoleChangeListResult{Changes: changes, Total: total}, nil
}

func (s *Store) UpdateRoleByUsername(
	ctx context.Context,
	username string,
	role roles.Role,
) (User, error) {
	if !roles.IsValid(role) {
		return User{}, fmt.Errorf("invalid role %q", role)
	}
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE users SET role = ?, updated_at = ? WHERE username = ? COLLATE NOCASE`,
		role,
		time.Now().UTC().Unix(),
		strings.TrimSpace(username),
	)
	if err != nil {
		return User{}, fmt.Errorf("update user role: %w", err)
	}
	if err := ensureUpdated(result); err != nil {
		return User{}, err
	}
	return s.GetByUsername(ctx, username)
}

func (s *Store) UpdateDisplayName(ctx context.Context, id string, displayName string) (User, error) {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?`,
		displayName,
		time.Now().UTC().Unix(),
		id,
	)
	if err != nil {
		return User{}, fmt.Errorf("update display name: %w", err)
	}
	if err := ensureUpdated(result); err != nil {
		return User{}, err
	}
	return s.GetByID(ctx, id)
}

func (s *Store) UpdateAvatar(ctx context.Context, id string, avatarFile string) (User, string, error) {
	existing, err := s.GetByID(ctx, id)
	if err != nil {
		return User{}, "", err
	}

	result, err := s.db.ExecContext(
		ctx,
		`UPDATE users SET avatar_file = ?, updated_at = ? WHERE id = ?`,
		avatarFile,
		time.Now().UTC().Unix(),
		id,
	)
	if err != nil {
		return User{}, "", fmt.Errorf("update avatar: %w", err)
	}
	if err := ensureUpdated(result); err != nil {
		return User{}, "", err
	}

	updated, err := s.GetByID(ctx, id)
	return updated, existing.AvatarFile, err
}

func (s *Store) UpdatePasswordHash(ctx context.Context, id string, passwordHash string) (User, error) {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE users
		 SET password_hash = ?, token_version = token_version + 1,
		     recovery_failed_attempts = 0, recovery_locked_until = 0, updated_at = ?
		 WHERE id = ?`,
		passwordHash,
		time.Now().UTC().Unix(),
		id,
	)
	if err != nil {
		return User{}, fmt.Errorf("update password: %w", err)
	}
	if err := ensureUpdated(result); err != nil {
		return User{}, err
	}
	return s.GetByID(ctx, id)
}

func (s *Store) UpdateRecoveryState(
	ctx context.Context,
	id string,
	failedAttempts int,
	lockedUntil time.Time,
) error {
	lockedUntilUnix := int64(0)
	if !lockedUntil.IsZero() {
		lockedUntilUnix = lockedUntil.Unix()
	}
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE users
		 SET recovery_failed_attempts = ?, recovery_locked_until = ?, updated_at = ?
		 WHERE id = ?`,
		failedAttempts,
		lockedUntilUnix,
		time.Now().UTC().Unix(),
		id,
	)
	if err != nil {
		return fmt.Errorf("update recovery state: %w", err)
	}
	return ensureUpdated(result)
}

const userSelect = `SELECT
	id, username, password_hash, display_name, role, avatar_file,
	security_question, security_answer_hash,
	recovery_failed_attempts, recovery_locked_until,
	token_version, created_at, updated_at
	FROM users`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanUser(row rowScanner) (User, error) {
	var result User
	var createdAt int64
	var recoveryLockedUntil int64
	var updatedAt int64

	err := row.Scan(
		&result.ID,
		&result.Username,
		&result.PasswordHash,
		&result.DisplayName,
		&result.Role,
		&result.AvatarFile,
		&result.SecurityQuestion,
		&result.SecurityAnswerHash,
		&result.RecoveryFailedAttempts,
		&recoveryLockedUntil,
		&result.TokenVersion,
		&createdAt,
		&updatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("scan user: %w", err)
	}

	result.CreatedAt = time.Unix(createdAt, 0).UTC()
	if recoveryLockedUntil > 0 {
		result.RecoveryLockedUntil = time.Unix(recoveryLockedUntil, 0).UTC()
	}
	result.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return result, nil
}

func ensureUpdated(result sql.Result) error {
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read affected rows: %w", err)
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}
