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
	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestFeatureAccessHTTPFlow(t *testing.T) {
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
		ID:       "admin-only",
		Name:     "Admin Only",
		Route:    "/tools/admin-only",
		Category: "AI",
	}}); err != nil {
		t.Fatalf("sync registry: %v", err)
	}

	cfg := config.Config{
		Auth: config.AuthConfig{TokenTTL: time.Hour},
		Server: config.ServerConfig{
			Host:         "127.0.0.1",
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 5 * time.Second,
		},
		Security: config.SecurityConfig{
			MaxRequestBodyBytes: 64 << 10,
			RateLimitMax:        100,
			RateLimitWindow:     time.Minute,
		},
		Storage: config.StorageConfig{
			AvatarDir:      filepath.Join(tempDir, "avatars"),
			MaxAvatarBytes: 1 << 20,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	httpServer := NewServer(cfg, nil, nil, authService, socialStore, accessStore, nil)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	preflight, err := http.NewRequest(
		http.MethodOptions,
		testServer.URL+"/api/v1/admin/features/admin-only/roles",
		nil,
	)
	if err != nil {
		t.Fatalf("create CORS preflight request: %v", err)
	}
	preflight.Header.Set("Origin", "http://127.0.0.1:8082")
	preflight.Header.Set("Access-Control-Request-Method", http.MethodPut)
	preflightResponse, err := testServer.Client().Do(preflight)
	if err != nil {
		t.Fatalf("send CORS preflight request: %v", err)
	}
	defer preflightResponse.Body.Close()
	if preflightResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("CORS preflight status = %d, want %d", preflightResponse.StatusCode, http.StatusNoContent)
	}
	if methods := preflightResponse.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(methods, http.MethodPut) {
		t.Fatalf("CORS methods = %q, missing PUT", methods)
	}

	adminSession := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800138000","password":"password-123","displayName":"管理员","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小管"}`,
		"",
		http.StatusCreated,
	)
	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/admin/features",
		"",
		adminSession.AccessToken,
		http.StatusForbidden,
	)
	if _, err := userStore.UpdateRoleByUsername(
		context.Background(),
		adminSession.User.Username,
		roles.Admin,
	); err != nil {
		t.Fatalf("promote admin: %v", err)
	}
	managed := requestJSON[map[string][]access.Feature](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/admin/features",
		"",
		adminSession.AccessToken,
		http.StatusOK,
	)
	if len(managed["features"]) != 1 {
		t.Fatalf("managed features = %+v", managed)
	}
	if managed["features"][0].Grants == nil {
		t.Fatal("managed feature grants must be an empty array, not null")
	}

	memberSession := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13900139000","password":"password-123","displayName":"普通用户","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小普"}`,
		"",
		http.StatusCreated,
	)
	matrix := requestJSON[struct {
		Features []struct {
			ID    string   `json:"id"`
			Roles []string `json:"roles"`
		} `json:"features"`
	}](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/membership/features",
		"",
		memberSession.AccessToken,
		http.StatusOK,
	)
	if len(matrix.Features) != 1 ||
		matrix.Features[0].ID != "admin-only" ||
		len(matrix.Features[0].Roles) != 1 ||
		matrix.Features[0].Roles[0] != "admin" {
		t.Fatalf("membership matrix = %+v", matrix.Features)
	}

	visible := requestJSON[map[string][]string](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/features",
		"",
		memberSession.AccessToken,
		http.StatusOK,
	)
	if len(visible["featureIds"]) != 0 {
		t.Fatalf("member initially sees %+v", visible)
	}

	requestJSON[map[string][]access.Feature](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/admin/features/admin-only/grants",
		`{"username":"13900139000","granted":true}`,
		adminSession.AccessToken,
		http.StatusOK,
	)
	visible = requestJSON[map[string][]string](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/features",
		"",
		memberSession.AccessToken,
		http.StatusOK,
	)
	if len(visible["featureIds"]) != 1 || visible["featureIds"][0] != "admin-only" {
		t.Fatalf("granted member sees %+v", visible)
	}
}
