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
	ErrNotFound      = errors.New("user not found")
	ErrUsernameTaken = errors.New("username already exists")
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

func scanUser(row *sql.Row) (User, error) {
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
