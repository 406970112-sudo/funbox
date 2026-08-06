package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

type procrastinatorGoalResponse struct {
	ID             string `json:"id"`
	TotalSteps     int    `json:"totalSteps"`
	CompletedSteps int    `json:"completedSteps"`
	XPEarned       int    `json:"xpEarned"`
	ExpectedXP     int    `json:"expectedXP"`
	Status         string `json:"status"`
	Steps          []struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	} `json:"steps"`
}

type procrastinatorLedgerResponse struct {
	TotalXP int `json:"totalXP"`
	Events  []struct {
		EventType string `json:"eventType"`
		XPDelta   int    `json:"xpDelta"`
	} `json:"events"`
}

func TestProcrastinatorHTTPFlow(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "app.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open social store: %v", err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	accessStore, err := access.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open access store: %v", err)
	}
	t.Cleanup(func() { _ = accessStore.Close() })
	if err := accessStore.SyncRegistry(context.Background(), []access.FeatureDefinition{{
		ID: "procrastination-crusher", Name: "拖延任务粉碎机", Route: "/tools/procrastination-crusher", Category: "效率",
	}}); err != nil {
		t.Fatalf("sync registry: %v", err)
	}
	cfg := config.Config{
		Database: config.DatabaseConfig{Path: databasePath},
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server: config.ServerConfig{
			Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second,
		},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 100, RateLimitWindow: time.Minute},
		Storage:  config.StorageConfig{AvatarDir: filepath.Join(tempDir, "avatars"), MaxAvatarBytes: 1 << 20},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	httpServer := NewServer(cfg, nil, nil, authService, socialStore, accessStore, nil)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
		testServer.Close()
	})
	session := requestJSON[sessionResponse](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register",
		`{"username":"13700138000","password":"password-123","displayName":"粉碎用户","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小碎"}`,
		"", http.StatusCreated,
	)
	goal := requestJSON[procrastinatorGoalResponse](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/procrastination/goals",
		`{"title":"整理房间","steps":[{"title":"只把桌上的垃圾扔掉","estimatedMinutes":3},{"title":"桌面物品放回原位","estimatedMinutes":5}]}`,
		session.AccessToken, http.StatusCreated,
	)
	if goal.TotalSteps != 2 || goal.ExpectedXP != 38 {
		t.Fatalf("created goal = %+v", goal)
	}
	completed := requestJSON[procrastinatorGoalResponse](
		t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/procrastination/steps/"+goal.Steps[0].ID+"/complete",
		`{"date":"2026-08-06"}`, session.AccessToken, http.StatusOK,
	)
	if completed.CompletedSteps != 1 || completed.XPEarned != 8 {
		t.Fatalf("completed goal = %+v", completed)
	}
	ledger := requestJSON[procrastinatorLedgerResponse](
		t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/procrastination/ledger",
		"", session.AccessToken, http.StatusOK,
	)
	if ledger.TotalXP != 8 || len(ledger.Events) != 1 {
		t.Fatalf("ledger = %+v", ledger)
	}
}
