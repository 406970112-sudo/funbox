package auth_test

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

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

	registered, err := service.Register(
		ctx,
		"13800138000",
		"password-123",
		"测试用户",
		"你小时候最喜欢的书是什么？",
		"海底两万里",
	)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if registered.User.Username != "13800138000" {
		t.Fatalf("username was not normalized: %q", registered.User.Username)
	}
	if registered.AccessToken == "" {
		t.Fatal("registration did not return a token")
	}

	_, err = service.Register(
		ctx,
		"13800138000",
		"password-123",
		"另一个用户",
		"你的第一个昵称是什么？",
		"小明同学",
	)
	if !errors.Is(err, auth.ErrUsernameTaken) {
		t.Fatalf("duplicate username error = %v", err)
	}

	_, err = service.Login(ctx, "13800138000", "wrong-password")
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
	if _, err := service.Login(ctx, "13800138000", "password-123"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("old password remained valid: %v", err)
	}
	if _, err := service.Login(ctx, "13800138000", "next-password-456"); err != nil {
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
	registered, err := firstService.Register(
		ctx,
		"13900139000",
		"password-123",
		"Persistent User",
		"你印象最深的一座城市是哪里？",
		"杭州西湖",
	)
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
	if _, err := secondService.Login(ctx, "13900139000", "password-123"); err != nil {
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
		question    string
		answer      string
		want        error
	}{
		{name: "short username", username: "1380013", password: "password-123", displayName: "用户", question: "你小时候最喜欢的书是什么？", answer: "海底两万里", want: auth.ErrUsernameInvalid},
		{name: "invalid username", username: "12800138000", password: "password-123", displayName: "用户", question: "你小时候最喜欢的书是什么？", answer: "海底两万里", want: auth.ErrUsernameInvalid},
		{name: "short password", username: "13800138001", password: "short1", displayName: "用户", question: "你小时候最喜欢的书是什么？", answer: "海底两万里", want: auth.ErrPasswordInvalid},
		{name: "password without number", username: "13800138001", password: "passwordonly", displayName: "用户", question: "你小时候最喜欢的书是什么？", answer: "海底两万里", want: auth.ErrPasswordInvalid},
		{name: "empty display name", username: "13800138001", password: "password-123", displayName: " ", question: "你小时候最喜欢的书是什么？", answer: "海底两万里", want: auth.ErrDisplayNameInvalid},
		{name: "empty security question", username: "13800138001", password: "password-123", displayName: "用户", question: "", answer: "海底两万里", want: auth.ErrSecurityQuestionInvalid},
		{name: "empty security answer", username: "13800138001", password: "password-123", displayName: "用户", question: "你小时候最喜欢的书是什么？", answer: " ", want: auth.ErrSecurityAnswerInvalid},
		{name: "one character Chinese answer", username: "13800138002", password: "password-123", displayName: "用户", question: "你印象最深的一座城市是哪里？", answer: "京"},
		{name: "long Chinese answer", username: "13800138003", password: "password-123", displayName: "用户", question: "你小时候最喜欢的书是什么？", answer: strings.Repeat("中", 64)},
		{name: "answer over limit", username: "13800138004", password: "password-123", displayName: "用户", question: "你小时候最喜欢的书是什么？", answer: strings.Repeat("中", 65), want: auth.ErrSecurityAnswerInvalid},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.Register(
				context.Background(),
				test.username,
				test.password,
				test.displayName,
				test.question,
				test.answer,
			)
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestPasswordRecovery(t *testing.T) {
	store, err := user.OpenStore(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	service := auth.NewService(store, []byte(strings.Repeat("r", 32)), time.Hour)
	ctx := context.Background()
	registered, err := service.Register(
		ctx,
		"13700137000",
		"password-123",
		"找回测试",
		"你小时候最喜欢的书是什么？",
		" 海底两万里 ",
	)
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	question, err := service.PasswordRecoveryQuestion(ctx, "13700137000")
	if err != nil {
		t.Fatalf("read recovery question: %v", err)
	}
	if question != "你小时候最喜欢的书是什么？" {
		t.Fatalf("recovery question = %q", question)
	}
	if _, err := service.VerifyRecoveryAnswer(ctx, "13700137000", "错误答案"); !errors.Is(err, auth.ErrRecoveryAnswerInvalid) {
		t.Fatalf("wrong recovery answer error = %v", err)
	}

	recoveryToken, err := service.VerifyRecoveryAnswer(ctx, "13700137000", "海底两万里")
	if err != nil {
		t.Fatalf("verify recovery answer: %v", err)
	}
	if recoveryToken == "" {
		t.Fatal("recovery token is empty")
	}
	if err := service.ResetPasswordWithRecoveryToken(ctx, recoveryToken, "recovered-456"); err != nil {
		t.Fatalf("reset password: %v", err)
	}
	if _, err := service.AuthenticateToken(ctx, registered.AccessToken); !errors.Is(err, auth.ErrTokenInvalid) {
		t.Fatalf("old token remained valid after recovery: %v", err)
	}
	if _, err := service.Login(ctx, "13700137000", "password-123"); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("old password remained valid: %v", err)
	}
	if _, err := service.Login(ctx, "13700137000", "recovered-456"); err != nil {
		t.Fatalf("login with recovered password: %v", err)
	}
	if err := service.ResetPasswordWithRecoveryToken(ctx, recoveryToken, "another-789"); !errors.Is(err, auth.ErrRecoveryTokenInvalid) {
		t.Fatalf("reused recovery token error = %v", err)
	}
}

func TestPasswordRecoveryAcceptsLegacyAnswerHash(t *testing.T) {
	store, err := user.OpenStore(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	legacyAnswer := "旧答案"
	legacyHash, err := bcrypt.GenerateFromPassword([]byte(legacyAnswer), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash legacy answer: %v", err)
	}
	ctx := context.Background()
	if _, err := store.Create(
		ctx,
		"13500135000",
		"unused-password-hash",
		"旧账号",
		"你小时候最喜欢的书是什么？",
		string(legacyHash),
	); err != nil {
		t.Fatalf("create legacy account: %v", err)
	}

	service := auth.NewService(store, []byte(strings.Repeat("l", 32)), time.Hour)
	if _, err := service.VerifyRecoveryAnswer(ctx, "13500135000", legacyAnswer); err != nil {
		t.Fatalf("verify legacy answer: %v", err)
	}
}

func TestPasswordRecoveryLocksAfterFiveWrongAnswers(t *testing.T) {
	store, err := user.OpenStore(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	service := auth.NewService(store, []byte(strings.Repeat("l", 32)), time.Hour)
	ctx := context.Background()
	_, err = service.Register(
		ctx,
		"13600136000",
		"password-123",
		"锁定测试",
		"你的第一个昵称是什么？",
		"小布同学",
	)
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	for attempt := 1; attempt <= 5; attempt++ {
		_, err := service.VerifyRecoveryAnswer(ctx, "13600136000", "错误答案")
		if attempt < 5 && !errors.Is(err, auth.ErrRecoveryAnswerInvalid) {
			t.Fatalf("attempt %d error = %v", attempt, err)
		}
		if attempt == 5 && !errors.Is(err, auth.ErrRecoveryLocked) {
			t.Fatalf("fifth attempt error = %v", err)
		}
	}
	if _, err := service.VerifyRecoveryAnswer(ctx, "13600136000", "小布同学"); !errors.Is(err, auth.ErrRecoveryLocked) {
		t.Fatalf("locked recovery error = %v", err)
	}
}
