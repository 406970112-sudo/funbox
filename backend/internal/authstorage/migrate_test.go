package authstorage

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"my-first-expo-app/backend/internal/user"
)

func TestMigrateCopiesReferencedAuthDataIntoEmptySharedStorage(t *testing.T) {
	t.Parallel()

	sourceRoot := t.TempDir()
	targetRoot := t.TempDir()
	source := Paths{
		Database:  filepath.Join(sourceRoot, "data", "app.db"),
		AvatarDir: filepath.Join(sourceRoot, "data", "avatars"),
		JWTSecret: filepath.Join(sourceRoot, "data", "jwt-secret"),
	}
	target := Paths{
		Database:  filepath.Join(targetRoot, "data", "app.db"),
		AvatarDir: filepath.Join(targetRoot, "data", "avatars"),
		JWTSecret: filepath.Join(targetRoot, "data", "jwt-secret"),
	}

	store, err := user.OpenStore(source.Database)
	if err != nil {
		t.Fatalf("open source store: %v", err)
	}
	account, err := store.Create(
		context.Background(),
		"13800138000",
		"password-hash",
		"Avatar Owner",
		"Question",
		"answer-hash",
	)
	if err != nil {
		store.Close()
		t.Fatalf("create source user: %v", err)
	}
	const avatarFile = "current-avatar.png"
	if _, _, err := store.UpdateAvatar(context.Background(), account.ID, avatarFile); err != nil {
		store.Close()
		t.Fatalf("set source avatar: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close source store: %v", err)
	}

	writeTestFile(t, filepath.Join(source.AvatarDir, avatarFile), []byte("current-avatar"), 0o644)
	writeTestFile(t, filepath.Join(source.AvatarDir, "orphan-avatar.png"), []byte("orphan"), 0o644)
	writeTestFile(t, source.JWTSecret, []byte("legacy-signing-secret"), 0o600)

	result, err := Migrate(context.Background(), source, target)
	if err != nil {
		t.Fatalf("migrate auth storage: %v", err)
	}
	if !result.Migrated {
		t.Fatal("migration was skipped")
	}
	if result.AvatarFilesCopied != 1 {
		t.Fatalf("copied avatars = %d, want 1", result.AvatarFilesCopied)
	}

	targetStore, err := user.OpenStore(target.Database)
	if err != nil {
		t.Fatalf("open migrated store: %v", err)
	}
	t.Cleanup(func() { _ = targetStore.Close() })
	migrated, err := targetStore.GetByUsername(context.Background(), account.Username)
	if err != nil {
		t.Fatalf("read migrated user: %v", err)
	}
	if migrated.AvatarFile != avatarFile {
		t.Fatalf("migrated avatar = %q, want %q", migrated.AvatarFile, avatarFile)
	}

	assertTestFile(t, filepath.Join(target.AvatarDir, avatarFile), "current-avatar")
	if _, err := os.Stat(filepath.Join(target.AvatarDir, "orphan-avatar.png")); !os.IsNotExist(err) {
		t.Fatalf("orphan avatar was migrated: %v", err)
	}
	assertTestFile(t, target.JWTSecret, "legacy-signing-secret")
}

func TestMigrateDoesNotOverwriteExistingSharedDatabase(t *testing.T) {
	t.Parallel()

	sourceRoot := t.TempDir()
	targetRoot := t.TempDir()
	source := Paths{
		Database:  filepath.Join(sourceRoot, "data", "app.db"),
		AvatarDir: filepath.Join(sourceRoot, "data", "avatars"),
		JWTSecret: filepath.Join(sourceRoot, "data", "jwt-secret"),
	}
	target := Paths{
		Database:  filepath.Join(targetRoot, "data", "app.db"),
		AvatarDir: filepath.Join(targetRoot, "data", "avatars"),
		JWTSecret: filepath.Join(targetRoot, "data", "jwt-secret"),
	}

	createTestAccount(t, source.Database, "13800138000", "Source User")
	createTestAccount(t, target.Database, "13900139000", "Shared User")
	writeTestFile(t, target.JWTSecret, []byte("shared-signing-secret"), 0o600)

	result, err := Migrate(context.Background(), source, target)
	if err != nil {
		t.Fatalf("migrate auth storage: %v", err)
	}
	if result.Migrated {
		t.Fatal("existing shared database was overwritten")
	}

	targetStore, err := user.OpenStore(target.Database)
	if err != nil {
		t.Fatalf("open preserved shared store: %v", err)
	}
	t.Cleanup(func() { _ = targetStore.Close() })
	if _, err := targetStore.GetByUsername(context.Background(), "13900139000"); err != nil {
		t.Fatalf("read preserved shared user: %v", err)
	}
	if _, err := targetStore.GetByUsername(context.Background(), "13800138000"); err == nil {
		t.Fatal("source user unexpectedly replaced shared data")
	}
	assertTestFile(t, target.JWTSecret, "shared-signing-secret")
}

func createTestAccount(t *testing.T, databasePath string, username string, displayName string) {
	t.Helper()
	store, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open test store: %v", err)
	}
	if _, err := store.Create(
		context.Background(),
		username,
		"password-hash",
		displayName,
		"Question",
		"answer-hash",
	); err != nil {
		store.Close()
		t.Fatalf("create test user: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close test store: %v", err)
	}
}

func writeTestFile(t *testing.T, path string, contents []byte, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create parent directory for %s: %v", path, err)
	}
	if err := os.WriteFile(path, contents, mode); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func assertTestFile(t *testing.T, path string, want string) {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(contents) != want {
		t.Fatalf("%s contents = %q, want %q", path, contents, want)
	}
}
