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

type timeCapsuleTestCapsule struct {
	ID       string `json:"id"`
	Mode     string `json:"mode"`
	Title    string `json:"title"`
	Status   string `json:"status"`
	OpenRule string `json:"openRule"`
	OpenAt   string `json:"openAt,omitempty"`
}

type timeCapsuleTestDetail struct {
	Capsule  timeCapsuleTestCapsule `json:"capsule"`
	Contents []map[string]any       `json:"contents"`
}

func TestTimeCapsuleHTTPFlow(t *testing.T) {
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

	cfg := config.Config{
		Auth: config.AuthConfig{
			TimeCapsuleSecret: "test-time-capsule-secret",
			TokenTTL:          time.Hour,
		},
		Database: config.DatabaseConfig{Path: databasePath},
		Server: config.ServerConfig{
			Host:         "127.0.0.1",
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 5 * time.Second,
		},
		Security: config.SecurityConfig{
			MaxRequestBodyBytes: 1 << 20,
			RateLimitMax:        100,
			RateLimitWindow:     time.Minute,
		},
		Storage: config.StorageConfig{
			AvatarDir:      filepath.Join(tempDir, "avatars"),
			TimeCapsuleDir: filepath.Join(tempDir, "time-capsule-media"),
			MaxAvatarBytes: 1 << 20,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	httpServer := NewServer(cfg, nil, nil, authService, socialStore, accessStore)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(func() {
		_ = httpServer.Shutdown(context.Background())
		testServer.Close()
	})

	alice := requestJSON[sessionResponse](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register",
		`{"username":"13800138004","password":"password-123","displayName":"小明","securityQuestion":"你最喜欢的书是什么？","securityAnswer":"答案"}`,
		"", http.StatusCreated,
	)
	bob := requestJSON[sessionResponse](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register",
		`{"username":"13800138005","password":"password-123","displayName":"小红","securityQuestion":"你最喜欢的书是什么？","securityAnswer":"答案"}`,
		"", http.StatusCreated,
	)

	createdRequest := requestJSON[map[string]any](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/friend-requests",
		`{"userId":"`+bob.User.ID+`"}`, alice.AccessToken, http.StatusCreated,
	)
	requestID := createdRequest["request"].(map[string]any)["id"].(string)
	requestJSON[map[string]any](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/friend-requests/"+requestID+"/accept",
		`{}`, bob.AccessToken, http.StatusOK,
	)

	openAt := time.Now().UTC().Add(2 * time.Second).Format(time.RFC3339)
	created := requestJSON[map[string]timeCapsuleTestCapsule](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/time-capsules",
		`{"mode":"personal","title":"写给两个月后的自己","openRule":"date","openTimezone":"Asia/Shanghai","openAt":"`+openAt+`"}`,
		alice.AccessToken, http.StatusCreated,
	)
	capsuleID := created["capsule"].ID

	requestJSON[map[string]any](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/time-capsules/"+capsuleID+"/contents",
		`{"kind":"text","textContent":"希望我已完成今天的计划"}`, alice.AccessToken, http.StatusCreated,
	)
	sealed := requestJSON[map[string]timeCapsuleTestCapsule](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/time-capsules/"+capsuleID+"/seal",
		`{}`, alice.AccessToken, http.StatusOK,
	)
	if sealed["capsule"].Status != "sealed" {
		t.Fatalf("expected sealed capsule, got %+v", sealed)
	}
	hidden := requestJSON[timeCapsuleTestDetail](
		t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/time-capsules/"+capsuleID,
		"", alice.AccessToken, http.StatusOK,
	)
	if len(hidden.Contents) != 0 {
		t.Fatalf("expected hidden contents, got %+v", hidden.Contents)
	}

	time.Sleep(2100 * time.Millisecond)
	opened := requestJSON[timeCapsuleTestDetail](
		t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/time-capsules/"+capsuleID,
		"", alice.AccessToken, http.StatusOK,
	)
	if opened.Capsule.Status != "opened" || len(opened.Contents) != 1 {
		t.Fatalf("expected opened capsule with one content, got %+v", opened)
	}

	joint := requestJSON[map[string]timeCapsuleTestCapsule](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/time-capsules",
		`{"mode":"joint","title":"恋爱一周年","friendId":"`+bob.User.ID+`","openRule":"date","openTimezone":"Asia/Shanghai","openAt":"`+time.Now().UTC().Add(time.Hour).Format(time.RFC3339)+`"}`,
		alice.AccessToken, http.StatusCreated,
	)
	jointID := joint["capsule"].ID
	requestJSON[map[string]any](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/time-capsules/"+jointID+"/accept",
		`{}`, bob.AccessToken, http.StatusOK,
	)
	requestJSON[map[string]any](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/time-capsules/"+jointID+"/contents",
		`{"kind":"text","textContent":"我留下的内容"}`, alice.AccessToken, http.StatusCreated,
	)
	requestJSON[map[string]any](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/time-capsules/"+jointID+"/contents",
		`{"kind":"text","textContent":"你也留下了一句话"}`, bob.AccessToken, http.StatusCreated,
	)
	jointSealed := requestJSON[map[string]timeCapsuleTestCapsule](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/time-capsules/"+jointID+"/seal",
		`{}`, bob.AccessToken, http.StatusOK,
	)
	if jointSealed["capsule"].Status != "sealed" {
		t.Fatalf("expected joint sealed, got %+v", jointSealed)
	}
	home := requestJSON[map[string]any](
		t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/time-capsule/home",
		"", alice.AccessToken, http.StatusOK,
	)
	counts := home["counts"].(map[string]any)
	if counts["sealed"].(float64) < 1 {
		t.Fatalf("expected sealed count, got %+v", counts)
	}
}
