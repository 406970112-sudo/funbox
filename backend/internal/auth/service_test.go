package auth_test

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/user"
)

func TestAccountLifecycle(t *testing.T) {
	store, err := user.OpenStore(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	service := auth.NewService(store, []byte(strings.Repeat("s", 32)), time.Hour)
	ctx := context.Background()

	registered, err := service.Register(ctx, "Demo.User", "password-123", "测试用户")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if registered.User.Username != "demo.user" {
		t.Fatalf("username was not normalized: %q", registered.User.Username)
	}
	if registered.AccessToken == "" {
		t.Fatal("registration did not return a token")
	}

	_, err = service.Register(ctx, "demo.user", "password-123", "另一个用户")
	if !errors.Is(err, auth.ErrUsernameTaken) {
		t.Fatalf("duplicate username error = %v", err)
	}

	_, err = service.Login(ctx, "demo.user", "wrong-password")
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("wrong password error = %v", err)
	}

	authenticated, err := service.AuthenticateToken(ctx, registered.AccessToken)
	if err != nil {
		t.Fatalf("authenticate registration token: %v", err)
	}
	if authenticated.ID != registered.User.ID {
		t.Fatalf("authenticated user ID = %q", authenticated.ID)
	}

	updated, err := service.UpdateDisplayName(ctx, authenticated.ID, " 新昵称 ")
	if err != nil {
		t.Fatalf("update display name: %v", err)
	}
	if updated.DisplayName != "新昵称" {
		t.Fatalf("display name = %q", updated.DisplayName)
	}

	_, err = service.ChangePassword(ctx, authenticated.ID, "wrong-password", "next-password-456")
	if !errors.Is(err, auth.ErrCurrentPasswordInvalid) {
		t.Fatalf("wrong current password error = %v", err)
	}

	changed, err := service.ChangePassword(
		ctx,
		authenticated.ID,
		"password-123",
		"next-password-456",
	)
	if err != nil {
		t.Fatalf("change password: %v", err)
	}
	if _, err := service.AuthenticateToken(ctx, registered.AccessToken); !errors.Is(err, auth.ErrTokenInvalid) {
		t.Fatalf("old token remained valid after password change: %v", err)
	}
	if _, err := service.AuthenticateToken(ctx, changed.AccessToken); err != nil {
		t.Fatalf("new token is invalid: %v", err)
	}
	if _, err := service.Login(ctx, "demo.user", "password-123"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("old password remained valid: %v", err)
	}
	if _, err := service.Login(ctx, "demo.user", "next-password-456"); err != nil {
		t.Fatalf("login with new password: %v", err)
	}
}

func TestAccountPersistsAcrossStoreReopen(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "users.db")
	signingKey := []byte(strings.Repeat("p", 32))
	ctx := context.Background()

	firstStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open first store: %v", err)
	}
	firstService := auth.NewService(firstStore, signingKey, time.Hour)
	registered, err := firstService.Register(ctx, "persistent_user", "password-123", "Persistent User")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := firstStore.Close(); err != nil {
		t.Fatalf("close first store: %v", err)
	}

	secondStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("reopen store: %v", err)
	}
	t.Cleanup(func() { _ = secondStore.Close() })
	secondService := auth.NewService(secondStore, signingKey, time.Hour)

	if _, err := secondService.AuthenticateToken(ctx, registered.AccessToken); err != nil {
		t.Fatalf("authenticate persisted token: %v", err)
	}
	if _, err := secondService.Login(ctx, "persistent_user", "password-123"); err != nil {
		t.Fatalf("login persisted user: %v", err)
	}
}

func TestValidation(t *testing.T) {
	store, err := user.OpenStore(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	service := auth.NewService(store, []byte(strings.Repeat("s", 32)), time.Hour)
	tests := []struct {
		name        string
		username    string
		password    string
		displayName string
		want        error
	}{
		{name: "short username", username: "ab", password: "password-123", displayName: "用户", want: auth.ErrUsernameInvalid},
		{name: "invalid username", username: "用户账号", password: "password-123", displayName: "用户", want: auth.ErrUsernameInvalid},
		{name: "short password", username: "valid_user", password: "short", displayName: "用户", want: auth.ErrPasswordInvalid},
		{name: "empty display name", username: "valid_user", password: "password-123", displayName: " ", want: auth.ErrDisplayNameInvalid},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.Register(
				context.Background(),
				test.username,
				test.password,
				test.displayName,
			)
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}
