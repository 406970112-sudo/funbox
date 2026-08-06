package httpapi

import (
	"context"
	"encoding/json"
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

func TestHomeManualHTTPFlow(t *testing.T) {
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
		Auth: config.AuthConfig{TokenTTL: time.Hour},
		Database: config.DatabaseConfig{
			Path: databasePath,
		},
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

	session := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13700137006","password":"password-123","displayName":"家庭说明书用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小册"} `,
		"",
		http.StatusCreated,
	)
	token := session.AccessToken

	initial := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/home-manual/state",
		"",
		token,
		http.StatusOK,
	)
	if initial["schemaVersion"] != float64(1) {
		t.Fatalf("unexpected initial state: %+v", initial)
	}

	secretBody := `{
		"schemaVersion":1,
		"devices":[],
		"networks":[{"id":"n1","name":"家庭网络","wifiPassword":"real-password","routerUrl":"192.168.1.1"}],
		"contacts":[],
		"reminders":[]
	}`
	rejected := requestJSON[map[string]string](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/home-manual/state",
		secretBody,
		token,
		http.StatusBadRequest,
	)
	if rejected["error"] != "home_manual_password_required" {
		t.Fatalf("expected password required, got %+v", rejected)
	}

	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/home-manual/security/password",
		`{"action":"set","newPassword":"home1234"}`,
		token,
		http.StatusOK,
	)
	unlock := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/home-manual/security/unlock",
		`{"password":"home1234"}`,
		token,
		http.StatusOK,
	)
	unlockToken, _ := unlock["unlockToken"].(string)
	if unlockToken == "" {
		t.Fatalf("unexpected unlock response: %+v", unlock)
	}

	saved := requestHomeManualJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/home-manual/state",
		secretBody,
		token,
		unlockToken,
		http.StatusOK,
	)
	if saved["security"] == nil {
		t.Fatalf("expected security in saved state: %+v", saved)
	}

	metadata := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/home-manual/state",
		"",
		token,
		http.StatusOK,
	)
	networks := metadata["networks"].([]any)
	firstNetwork := networks[0].(map[string]any)
	if firstNetwork["wifiPassword"] != "" {
		t.Fatalf("metadata leaked wifi password: %+v", metadata)
	}

	full := requestHomeManualJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/home-manual/state?view=full",
		"",
		token,
		unlockToken,
		http.StatusOK,
	)
	fullNetworks := full["networks"].([]any)
	fullFirst := fullNetworks[0].(map[string]any)
	if fullFirst["wifiPassword"] != "real-password" {
		t.Fatalf("expected full state secret: %+v", full)
	}

	cleared := requestHomeManualJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodDelete,
		testServer.URL+"/api/v1/home-manual/state",
		"",
		token,
		unlockToken,
		http.StatusOK,
	)
	if cleared["success"] != true {
		t.Fatalf("expected clear success, got %+v", cleared)
	}
}

func requestHomeManualJSON[T any](
	t *testing.T,
	client *http.Client,
	method string,
	url string,
	body string,
	token string,
	unlockToken string,
	wantStatus int,
) T {
	t.Helper()
	request, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if unlockToken != "" {
		request.Header.Set("X-Home-Manual-Unlock-Token", unlockToken)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("perform request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != wantStatus {
		t.Fatalf("status = %d, want %d", response.StatusCode, wantStatus)
	}
	var payload T
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return payload
}
