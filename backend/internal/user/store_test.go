package user_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"

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
}
