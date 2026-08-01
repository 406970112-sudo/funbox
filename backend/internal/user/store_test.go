package user_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/user"
)

func TestOpenStoreMigratesExistingUsersTable(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "users.db")
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatalf("open legacy database: %v", err)
	}
	_, err = db.Exec(`CREATE TABLE users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL COLLATE NOCASE UNIQUE,
		password_hash TEXT NOT NULL,
		display_name TEXT NOT NULL,
		avatar_file TEXT NOT NULL DEFAULT '',
		token_version INTEGER NOT NULL DEFAULT 1,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`)
	if err != nil {
		t.Fatalf("create legacy users table: %v", err)
	}
	now := time.Now().UTC().Unix()
	_, err = db.Exec(
		`INSERT INTO users (
			id, username, password_hash, display_name, avatar_file,
			token_version, created_at, updated_at
		) VALUES (?, ?, ?, ?, '', 1, ?, ?)`,
		"legacy-user",
		"legacy_account",
		"legacy-hash",
		"Legacy User",
		now,
		now,
	)
	if err != nil {
		t.Fatalf("insert legacy user: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close legacy database: %v", err)
	}

	store, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	legacy, err := store.GetByUsername(context.Background(), "legacy_account")
	if err != nil {
		t.Fatalf("read migrated user: %v", err)
	}
	if legacy.SecurityQuestion != "" || legacy.SecurityAnswerHash != "" {
		t.Fatalf("legacy recovery fields = %q, %q", legacy.SecurityQuestion, legacy.SecurityAnswerHash)
	}
	if legacy.Role != roles.Normal {
		t.Fatalf("legacy role = %q, want normal", legacy.Role)
	}

	created, err := store.Create(
		context.Background(),
		"13800138000",
		"password-hash",
		"New User",
		"你小时候最喜欢的书是什么？",
		"answer-hash",
	)
	if err != nil {
		t.Fatalf("create user after migration: %v", err)
	}
	if created.SecurityQuestion == "" || created.SecurityAnswerHash == "" {
		t.Fatalf("new recovery fields were not saved: %+v", created)
	}
	updated, err := store.UpdateRoleByUsername(context.Background(), created.Username, roles.Admin)
	if err != nil {
		t.Fatalf("update role: %v", err)
	}
	if updated.Role != roles.Admin {
		t.Fatalf("updated role = %q, want admin", updated.Role)
	}
}

func TestStoreListUsersFiltersAndPaginates(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	createTestUser(t, store, "13800138001", "林小满")
	vip := createTestUser(t, store, "13800138002", "张玲")
	createTestUser(t, store, "13800138003", "陈野")
	if _, err := store.UpdateRoleByUsername(ctx, vip.Username, roles.VIP); err != nil {
		t.Fatalf("promote vip fixture: %v", err)
	}

	filtered, err := store.List(ctx, user.ListOptions{
		Limit: 20,
		Query: "玲",
		Role:  roles.VIP,
	})
	if err != nil {
		t.Fatalf("list filtered users: %v", err)
	}
	if filtered.Total != 1 || len(filtered.Users) != 1 {
		t.Fatalf("filtered result = %+v, want one user", filtered)
	}
	if filtered.Users[0].ID != vip.ID || filtered.Users[0].Role != roles.VIP {
		t.Fatalf("filtered user = %+v, want vip fixture", filtered.Users[0])
	}

	page, err := store.List(ctx, user.ListOptions{Limit: 2, Offset: 1})
	if err != nil {
		t.Fatalf("list paginated users: %v", err)
	}
	if page.Total != 3 || len(page.Users) != 2 {
		t.Fatalf("paginated result = %+v, want total 3 and two rows", page)
	}
}

func TestStoreUpdateRoleWritesOneAuditEntryAndRetriesIdempotently(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	admin := createTestUser(t, store, "13800138101", "管理员")
	member := createTestUser(t, store, "13800138102", "林小满")
	if _, err := store.UpdateRoleByUsername(ctx, admin.Username, roles.Admin); err != nil {
		t.Fatalf("promote admin fixture: %v", err)
	}

	updated, changed, err := store.UpdateRole(
		ctx,
		member.ID,
		admin.ID,
		roles.Normal,
		roles.VIP,
		"活动赠送",
	)
	if err != nil || !changed || updated.Role != roles.VIP {
		t.Fatalf("updated = %+v, changed = %v, err = %v", updated, changed, err)
	}

	retried, changed, err := store.UpdateRole(
		ctx,
		member.ID,
		admin.ID,
		roles.Normal,
		roles.VIP,
		"重复请求",
	)
	if err != nil || changed || retried.Role != roles.VIP {
		t.Fatalf("retried = %+v, changed = %v, err = %v", retried, changed, err)
	}

	history, err := store.ListRoleChangesByUserID(ctx, member.ID, 10, 0)
	if err != nil {
		t.Fatalf("list role changes: %v", err)
	}
	if history.Total != 1 || len(history.Changes) != 1 {
		t.Fatalf("role change history = %+v, want one entry", history)
	}
	change := history.Changes[0]
	if change.TargetUserID != member.ID || change.OperatorUserID != admin.ID ||
		change.FromRole != roles.Normal || change.ToRole != roles.VIP ||
		change.Reason != "活动赠送" || change.OperatorDisplayName != "管理员" {
		t.Fatalf("role change = %+v", change)
	}
}

func TestStoreUpdateRoleRejectsProtectedAdminAndStaleRole(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	admin := createTestUser(t, store, "13800138201", "管理员")
	member := createTestUser(t, store, "13800138202", "陈野")
	if _, err := store.UpdateRoleByUsername(ctx, admin.Username, roles.Admin); err != nil {
		t.Fatalf("promote admin fixture: %v", err)
	}

	if _, _, err := store.UpdateRole(
		ctx,
		admin.ID,
		admin.ID,
		roles.Admin,
		roles.VIP,
		"错误降级",
	); !errors.Is(err, user.ErrProtectedAdminRole) {
		t.Fatalf("protected admin error = %v", err)
	}

	if _, _, err := store.UpdateRole(
		ctx,
		member.ID,
		admin.ID,
		roles.VIP,
		roles.SVIP,
		"覆盖他人修改",
	); !errors.Is(err, user.ErrRoleChanged) {
		t.Fatalf("stale role error = %v", err)
	}

	history, err := store.ListRoleChangesByUserID(ctx, member.ID, 10, 0)
	if err != nil {
		t.Fatalf("list role changes: %v", err)
	}
	if history.Total != 0 || len(history.Changes) != 0 {
		t.Fatalf("unexpected role changes = %+v", history)
	}
}

func openTestStore(t *testing.T) *user.Store {
	t.Helper()
	store, err := user.OpenStore(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatalf("open test store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func createTestUser(t *testing.T, store *user.Store, username string, displayName string) user.User {
	t.Helper()
	created, err := store.Create(
		context.Background(),
		username,
		"password-hash",
		displayName,
		"你小时候最喜欢的书是什么？",
		"answer-hash",
	)
	if err != nil {
		t.Fatalf("create user %s: %v", username, err)
	}
	return created
}
