package access

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"my-first-expo-app/backend/internal/roles"
)

var (
	ErrFeatureNotFound = errors.New("feature not found")
	ErrUserNotFound    = errors.New("user not found")
)

type Feature struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Route      string       `json:"route"`
	Category   string       `json:"category"`
	Roles      []roles.Role `json:"roles"`
	GrantCount int          `json:"grantCount"`
	Grants     []UserGrant  `json:"grants"`
}

type UserGrant struct {
	DisplayName string     `json:"displayName"`
	Role        roles.Role `json:"role"`
	Username    string     `json:"username"`
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
		return nil, fmt.Errorf("open access database: %w", err)
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
		`CREATE TABLE IF NOT EXISTS features (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			route TEXT NOT NULL,
			category TEXT NOT NULL,
			sort_order INTEGER NOT NULL,
			active INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS feature_role_permissions (
			feature_id TEXT NOT NULL,
			role TEXT NOT NULL,
			visible INTEGER NOT NULL DEFAULT 0,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (feature_id, role),
			FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS feature_user_grants (
			feature_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY (feature_id, user_id),
			FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_feature_user_grants_user ON feature_user_grants(user_id)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run access migration: %w", err)
		}
	}
	return nil
}

func (s *Store) SyncRegistry(ctx context.Context, definitions []FeatureDefinition) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin feature registry sync: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `UPDATE features SET active = 0`); err != nil {
		return fmt.Errorf("deactivate old features: %w", err)
	}
	now := time.Now().UTC().Unix()
	for index, definition := range definitions {
		if definition.ID == "" || definition.Name == "" || !isManagedRoute(definition.Route) {
			return fmt.Errorf("invalid feature registry entry at index %d", index)
		}
		result, err := tx.ExecContext(
			ctx,
			`INSERT OR IGNORE INTO features (
				id, name, route, category, sort_order, active, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
			definition.ID,
			definition.Name,
			definition.Route,
			definition.Category,
			index,
			now,
			now,
		)
		if err != nil {
			return fmt.Errorf("register feature %q: %w", definition.ID, err)
		}
		inserted, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("read feature sync result: %w", err)
		}
		if inserted == 0 {
			if _, err := tx.ExecContext(
				ctx,
				`UPDATE features
				 SET name = ?, route = ?, category = ?, sort_order = ?, active = 1, updated_at = ?
				 WHERE id = ?`,
				definition.Name,
				definition.Route,
				definition.Category,
				index,
				now,
				definition.ID,
			); err != nil {
				return fmt.Errorf("update feature %q: %w", definition.ID, err)
			}
		} else {
			initialRoles := definition.InitialRoles
			if len(initialRoles) == 0 {
				initialRoles = []roles.Role{roles.Admin}
			}
			allowed := roleSet(initialRoles)
			allowed[roles.Admin] = struct{}{}
			for _, role := range roles.All {
				visible := 0
				if _, ok := allowed[role]; ok {
					visible = 1
				}
				if _, err := tx.ExecContext(
					ctx,
					`INSERT INTO feature_role_permissions (feature_id, role, visible, updated_at)
					 VALUES (?, ?, ?, ?)`,
					definition.ID,
					role,
					visible,
					now,
				); err != nil {
					return fmt.Errorf("seed permissions for %q: %w", definition.ID, err)
				}
			}
		}

		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO feature_role_permissions (feature_id, role, visible, updated_at)
			 VALUES (?, ?, 1, ?)
			 ON CONFLICT(feature_id, role) DO UPDATE SET visible = 1, updated_at = excluded.updated_at`,
			definition.ID,
			roles.Admin,
			now,
		); err != nil {
			return fmt.Errorf("ensure admin permission for %q: %w", definition.ID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit feature registry sync: %w", err)
	}
	return nil
}

func (s *Store) VisibleFeatureIDs(
	ctx context.Context,
	userID string,
	role roles.Role,
) ([]string, error) {
	if !roles.IsValid(role) {
		role = roles.Normal
	}
	if role == roles.Admin {
		return s.activeFeatureIDs(ctx)
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT DISTINCT f.id
		 FROM features f
		 LEFT JOIN feature_role_permissions rp
		   ON rp.feature_id = f.id AND rp.role = ? AND rp.visible = 1
		 LEFT JOIN feature_user_grants ug
		   ON ug.feature_id = f.id AND ug.user_id = ?
		 WHERE f.active = 1 AND (rp.feature_id IS NOT NULL OR ug.user_id IS NOT NULL)
		 ORDER BY f.sort_order`,
		role,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list visible features: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan visible feature: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate visible features: %w", err)
	}
	return ids, nil
}

func (s *Store) ListFeatures(ctx context.Context) ([]Feature, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, name, route, category
		 FROM features WHERE active = 1 ORDER BY sort_order`,
	)
	if err != nil {
		return nil, fmt.Errorf("list features: %w", err)
	}
	defer rows.Close()

	features := make([]Feature, 0)
	featureIndex := make(map[string]int)
	for rows.Next() {
		feature := Feature{
			Roles:  make([]roles.Role, 0),
			Grants: make([]UserGrant, 0),
		}
		if err := rows.Scan(&feature.ID, &feature.Name, &feature.Route, &feature.Category); err != nil {
			return nil, fmt.Errorf("scan feature: %w", err)
		}
		features = append(features, feature)
		featureIndex[feature.ID] = len(features) - 1
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate features: %w", err)
	}

	permissionRows, err := s.db.QueryContext(
		ctx,
		`SELECT rp.feature_id, rp.role
		 FROM feature_role_permissions rp
		 JOIN features f ON f.id = rp.feature_id
		 WHERE f.active = 1 AND rp.visible = 1
		 ORDER BY f.sort_order`,
	)
	if err != nil {
		return nil, fmt.Errorf("list feature permissions: %w", err)
	}
	for permissionRows.Next() {
		var featureID string
		var role roles.Role
		if err := permissionRows.Scan(&featureID, &role); err != nil {
			permissionRows.Close()
			return nil, fmt.Errorf("scan feature permission: %w", err)
		}
		if index, ok := featureIndex[featureID]; ok {
			features[index].Roles = append(features[index].Roles, role)
		}
	}
	if err := permissionRows.Close(); err != nil {
		return nil, fmt.Errorf("close feature permission rows: %w", err)
	}
	if err := permissionRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate feature permissions: %w", err)
	}

	grantRows, err := s.db.QueryContext(
		ctx,
		`SELECT ug.feature_id, u.username, u.display_name, u.role
		 FROM feature_user_grants ug
		 JOIN features f ON f.id = ug.feature_id
		 JOIN users u ON u.id = ug.user_id
		 WHERE f.active = 1
		 ORDER BY f.sort_order, u.username`,
	)
	if err != nil {
		return nil, fmt.Errorf("list feature grants: %w", err)
	}
	defer grantRows.Close()
	for grantRows.Next() {
		var featureID string
		var grant UserGrant
		if err := grantRows.Scan(&featureID, &grant.Username, &grant.DisplayName, &grant.Role); err != nil {
			return nil, fmt.Errorf("scan feature grant: %w", err)
		}
		if index, ok := featureIndex[featureID]; ok {
			features[index].Grants = append(features[index].Grants, grant)
			features[index].GrantCount++
		}
	}
	if err := grantRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate feature grants: %w", err)
	}
	return features, nil
}

func (s *Store) UpdateRolePermissions(
	ctx context.Context,
	featureID string,
	selected []roles.Role,
) error {
	allowed := roleSet(selected)
	for role := range allowed {
		if !roles.IsValid(role) {
			return fmt.Errorf("invalid role %q", role)
		}
	}
	allowed[roles.Admin] = struct{}{}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin role permission update: %w", err)
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRowContext(
		ctx,
		`SELECT EXISTS(SELECT 1 FROM features WHERE id = ? AND active = 1)`,
		featureID,
	).Scan(&exists); err != nil {
		return fmt.Errorf("find feature: %w", err)
	}
	if exists == 0 {
		return ErrFeatureNotFound
	}

	now := time.Now().UTC().Unix()
	for _, role := range roles.All {
		visible := 0
		if _, ok := allowed[role]; ok {
			visible = 1
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO feature_role_permissions (feature_id, role, visible, updated_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(feature_id, role) DO UPDATE
			 SET visible = excluded.visible, updated_at = excluded.updated_at`,
			featureID,
			role,
			visible,
			now,
		); err != nil {
			return fmt.Errorf("update role permission: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit role permission update: %w", err)
	}
	return nil
}

func (s *Store) SetUserGrant(
	ctx context.Context,
	featureID string,
	username string,
	granted bool,
) error {
	var featureExists int
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT EXISTS(SELECT 1 FROM features WHERE id = ? AND active = 1)`,
		featureID,
	).Scan(&featureExists); err != nil {
		return fmt.Errorf("find feature: %w", err)
	}
	if featureExists == 0 {
		return ErrFeatureNotFound
	}

	var userID string
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT id FROM users WHERE username = ? COLLATE NOCASE`,
		strings.TrimSpace(username),
	).Scan(&userID); errors.Is(err, sql.ErrNoRows) {
		return ErrUserNotFound
	} else if err != nil {
		return fmt.Errorf("find grant user: %w", err)
	}

	if granted {
		_, err := s.db.ExecContext(
			ctx,
			`INSERT OR IGNORE INTO feature_user_grants (feature_id, user_id, created_at)
			 VALUES (?, ?, ?)`,
			featureID,
			userID,
			time.Now().UTC().Unix(),
		)
		if err != nil {
			return fmt.Errorf("grant feature access: %w", err)
		}
		return nil
	}

	if _, err := s.db.ExecContext(
		ctx,
		`DELETE FROM feature_user_grants WHERE feature_id = ? AND user_id = ?`,
		featureID,
		userID,
	); err != nil {
		return fmt.Errorf("remove feature grant: %w", err)
	}
	return nil
}

func (s *Store) activeFeatureIDs(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id FROM features WHERE active = 1 ORDER BY sort_order`,
	)
	if err != nil {
		return nil, fmt.Errorf("list active features: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan active feature: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active features: %w", err)
	}
	return ids, nil
}

func roleSet(values []roles.Role) map[roles.Role]struct{} {
	result := make(map[roles.Role]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}
