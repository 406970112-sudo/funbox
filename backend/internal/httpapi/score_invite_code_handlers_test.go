package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/score"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

type handlerInviteCodeGenerator struct{}

func (handlerInviteCodeGenerator) Generate(_ context.Context, _ string) ([]byte, string, int, error) {
	return []byte{0x89, 0x50, 0x4e, 0x47}, "image/png", 430, nil
}

func TestScoreInviteCodeHTTPFlow(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "funbox.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	scoreStore, err := score.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = scoreStore.Close() })

	cfg := config.Config{
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server:   config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 100, RateLimitWindow: time.Minute},
		Storage:  config.StorageConfig{AvatarDir: filepath.Join(tempDir, "avatars"), MaxAvatarBytes: 1 << 20},
	}
	signingKey := []byte(strings.Repeat("s", 32))
	authService := auth.NewService(userStore, signingKey, time.Hour)
	scoreService := score.NewServiceWithOptions(scoreStore, signingKey, 7*24*time.Hour, score.ServiceOptions{
		MiniProgramCodeGenerator: handlerInviteCodeGenerator{},
	})
	testServer := httptest.NewServer(NewServer(cfg, nil, nil, authService, socialStore, nil, scoreService).Handler)
	t.Cleanup(testServer.Close)

	registered := scoreRequestJSON[sessionResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register", map[string]any{
		"username": "13800138002", "password": "password-123", "displayName": "Host",
		"securityQuestion": "Question?", "securityAnswer": "Answer",
	}, "", http.StatusCreated)
	created := scoreRequestJSON[score.CreateRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms", map[string]any{
		"name": "Friday game", "maxPlayers": 4, "password": "2468", "gameType": "mahjong",
	}, registered.AccessToken, http.StatusCreated)
	inviteCode := scoreRequestJSON[score.InviteCodeResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/invite-code", map[string]any{}, registered.AccessToken, http.StatusOK)
	if inviteCode.InviteScene == "" || inviteCode.ImageBase64 == "" || inviteCode.Width != 430 {
		t.Fatalf("invite code = %+v", inviteCode)
	}
	preview := scoreRequestJSON[score.InvitePreviewResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/invite-preview", map[string]any{
		"inviteScene": inviteCode.InviteScene,
	}, "", http.StatusOK)
	if preview.Room.ID != created.Room.ID {
		t.Fatalf("preview room = %+v", preview.Room)
	}
	joined := scoreRequestJSON[score.JoinRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/join", map[string]any{
		"inviteScene": inviteCode.InviteScene, "displayName": "Invited Guest",
	}, "", http.StatusCreated)
	if joined.Room.ID != created.Room.ID || joined.GuestToken == "" {
		t.Fatalf("joined = %+v", joined)
	}
	scoreRequestJSON[map[string]any](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/join", map[string]any{
		"code": created.Room.Code, "displayName": "No Password",
	}, "", http.StatusBadRequest)
}
