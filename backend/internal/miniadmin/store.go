package miniadmin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"
)

const (
	UsersRead      = "users.read"
	UsersRole      = "users.role"
	FeedbackManage = "feedback.manage"
	FeaturesManage = "features.manage"
)

var (
	ErrPermissionInvalid = errors.New("invalid mini-program permission")
	ErrNotOwner          = errors.New("mini-program owner required")
	ErrOwnerProtected    = errors.New("mini-program owner protected")
	ErrOwnerExists       = errors.New("mini-program owner already exists")
	ErrUserNotFound      = errors.New("user not found")
	allPermissions       = []string{UsersRead, UsersRole, FeedbackManage, FeaturesManage}
)

type Store struct {
	db *sql.DB
}

type Grant struct {
	UserID      string    `json:"userId"`
	Owner       bool      `json:"owner"`
	Permissions []string  `json:"permissions"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type GrantChange struct {
	ID                  int64     `json:"id"`
	UserID              string    `json:"userId"`
	OperatorID          string    `json:"operatorId"`
	PreviousPermissions []string  `json:"previousPermissions"`
	Permissions         []string  `json:"permissions"`
	CreatedAt           time.Time `json:"createdAt"`
}

func Open(db *sql.DB) (*Store, error) {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS mini_admin_grants (
			user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			owner INTEGER NOT NULL DEFAULT 0 CHECK (owner IN (0, 1)),
			permissions TEXT NOT NULL DEFAULT '[]',
			updated_at INTEGER NOT NULL
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS mini_admin_single_owner ON mini_admin_grants(owner) WHERE owner = 1`,
		`CREATE TABLE IF NOT EXISTS mini_admin_grant_changes (
			id INTEGER PRIMARY KEY,
			user_id TEXT NOT NULL,
			operator_id TEXT NOT NULL,
			previous_permissions TEXT NOT NULL,
			permissions TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS mini_feature_settings (
			feature_id TEXT PRIMARY KEY,
			settings TEXT NOT NULL,
			revision INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS mini_feature_changes (
			id INTEGER PRIMARY KEY,
			feature_id TEXT NOT NULL,
			operator_id TEXT NOT NULL,
			previous_settings TEXT NOT NULL,
			settings TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return nil, fmt.Errorf("migrate mini-program administration: %w", err)
		}
	}
	return &Store{db: db}, nil
}

func (s *Store) GetGrant(ctx context.Context, userID string) (Grant, error) {
	return getGrant(ctx, s.db, userID)
}

func (s *Store) ListGrants(ctx context.Context, limit, offset int) ([]Grant, int, error) {
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mini_admin_grants`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, grantSelect+` ORDER BY owner DESC, updated_at DESC, user_id LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	grants := make([]Grant, 0)
	for rows.Next() {
		grant, err := scanGrant(rows)
		if err != nil {
			return nil, 0, err
		}
		grants = append(grants, grant)
	}
	return grants, total, rows.Err()
}

func (s *Store) BootstrapOwner(ctx context.Context, userID string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var ownerID string
	err = tx.QueryRowContext(ctx, `SELECT user_id FROM mini_admin_grants WHERE owner = 1`).Scan(&ownerID)
	if err == nil {
		if ownerID == userID {
			return nil
		}
		return ErrOwnerExists
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err := requireUser(ctx, tx, userID); err != nil {
		return err
	}
	previous, err := getGrant(ctx, tx, userID)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	_, err = tx.ExecContext(ctx, `INSERT INTO mini_admin_grants (user_id, owner, permissions, updated_at)
		VALUES (?, 1, '[]', ?)
		ON CONFLICT(user_id) DO UPDATE SET owner = 1, permissions = '[]', updated_at = excluded.updated_at`, userID, now)
	if err != nil {
		return err
	}
	if err := logGrant(ctx, tx, userID, "", previous.Permissions, allPermissions, now); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) UpdateGrant(ctx context.Context, operatorID, userID string, permissions []string) (Grant, error) {
	permissions, err := normalizePermissions(permissions)
	if err != nil {
		return Grant{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Grant{}, err
	}
	defer tx.Rollback()
	operator, err := getGrant(ctx, tx, operatorID)
	if err != nil {
		return Grant{}, err
	}
	if !operator.Owner {
		return Grant{}, ErrNotOwner
	}
	if err := requireUser(ctx, tx, userID); err != nil {
		return Grant{}, err
	}
	previous, err := getGrant(ctx, tx, userID)
	if err != nil {
		return Grant{}, err
	}
	if previous.Owner {
		return Grant{}, ErrOwnerProtected
	}
	if slices.Equal(previous.Permissions, permissions) {
		return previous, nil
	}
	now := time.Now().UnixMilli()
	if len(permissions) == 0 {
		_, err = tx.ExecContext(ctx, `DELETE FROM mini_admin_grants WHERE user_id = ?`, userID)
	} else {
		encoded, _ := json.Marshal(permissions)
		_, err = tx.ExecContext(ctx, `INSERT INTO mini_admin_grants (user_id, permissions, updated_at)
			VALUES (?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET permissions = excluded.permissions, updated_at = excluded.updated_at`,
			userID, string(encoded), now)
	}
	if err != nil {
		return Grant{}, err
	}
	if err := logGrant(ctx, tx, userID, operatorID, previous.Permissions, permissions, now); err != nil {
		return Grant{}, err
	}
	if err := tx.Commit(); err != nil {
		return Grant{}, err
	}
	return Grant{UserID: userID, Permissions: permissions, UpdatedAt: time.UnixMilli(now).UTC()}, nil
}

func (s *Store) ListGrantChanges(ctx context.Context, limit, offset int) ([]GrantChange, int, error) {
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM mini_admin_grant_changes`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, user_id, operator_id, previous_permissions, permissions, created_at
		FROM mini_admin_grant_changes ORDER BY id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	changes := make([]GrantChange, 0)
	for rows.Next() {
		var change GrantChange
		var previous, permissions string
		var createdAt int64
		if err := rows.Scan(&change.ID, &change.UserID, &change.OperatorID, &previous, &permissions, &createdAt); err != nil {
			return nil, 0, err
		}
		if err := json.Unmarshal([]byte(previous), &change.PreviousPermissions); err != nil {
			return nil, 0, err
		}
		if err := json.Unmarshal([]byte(permissions), &change.Permissions); err != nil {
			return nil, 0, err
		}
		change.CreatedAt = time.UnixMilli(createdAt).UTC()
		changes = append(changes, change)
	}
	return changes, total, rows.Err()
}

type rowQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type rowScanner interface {
	Scan(...any) error
}

const grantSelect = `SELECT user_id, owner, permissions, updated_at FROM mini_admin_grants`

func getGrant(ctx context.Context, db rowQueryer, userID string) (Grant, error) {
	grant, err := scanGrant(db.QueryRowContext(ctx, grantSelect+` WHERE user_id = ?`, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return Grant{UserID: userID, Permissions: []string{}}, nil
	}
	return grant, err
}

func scanGrant(row rowScanner) (Grant, error) {
	var grant Grant
	var permissions string
	var updatedAt int64
	if err := row.Scan(&grant.UserID, &grant.Owner, &permissions, &updatedAt); err != nil {
		return Grant{}, err
	}
	grant.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	if grant.Owner {
		grant.Permissions = slices.Clone(allPermissions)
		return grant, nil
	}
	err := json.Unmarshal([]byte(permissions), &grant.Permissions)
	return grant, err
}

func requireUser(ctx context.Context, db rowQueryer, userID string) error {
	var id string
	err := db.QueryRowContext(ctx, `SELECT id FROM users WHERE id = ?`, userID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUserNotFound
	}
	return err
}

func normalizePermissions(permissions []string) ([]string, error) {
	for _, permission := range permissions {
		if !slices.Contains(allPermissions, permission) {
			return nil, ErrPermissionInvalid
		}
	}
	normalized := make([]string, 0, len(allPermissions))
	for _, permission := range allPermissions {
		if slices.Contains(permissions, permission) || (permission == UsersRead && slices.Contains(permissions, UsersRole)) {
			normalized = append(normalized, permission)
		}
	}
	return normalized, nil
}

func logGrant(ctx context.Context, tx *sql.Tx, userID, operatorID string, previous, permissions []string, now int64) error {
	previousJSON, _ := json.Marshal(previous)
	permissionsJSON, _ := json.Marshal(permissions)
	_, err := tx.ExecContext(ctx, `INSERT INTO mini_admin_grant_changes
		(user_id, operator_id, previous_permissions, permissions, created_at) VALUES (?, ?, ?, ?, ?)`,
		userID, operatorID, string(previousJSON), string(permissionsJSON), now)
	return err
}
