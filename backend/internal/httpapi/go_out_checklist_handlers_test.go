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

type goOutTemplateResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type goOutHomeResponse struct {
	Items         []map[string]any `json:"items"`
	ActiveSceneID string           `json:"activeSceneId"`
	Weather       map[string]any   `json:"weather"`
}

type goOutCompletionResponse struct {
	ID         string `json:"id"`
	ResultText string `json:"resultText"`
}

type goOutHistoryResponse struct {
	Records []map[string]any `json:"records"`
}

func TestGoOutChecklistHTTPFlow(t *testing.T) {
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
		`{"username":"13700137006","password":"password-123","displayName":"出门清单用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小出"} `,
		"",
		http.StatusCreated,
	)
	token := session.AccessToken

	initial := requestJSON[goOutHomeResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/go-out-checklist/home",
		"",
		token,
		http.StatusOK,
	)
	if len(initial.Items) != 0 {
		t.Fatalf("expected empty initial items, got %+v", initial.Items)
	}

	templates := requestJSON[map[string][]goOutTemplateResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/go-out-checklist/templates",
		"",
		token,
		http.StatusOK,
	)
	if len(templates["templates"]) != 3 {
		t.Fatalf("expected 3 templates, got %d", len(templates["templates"]))
	}

	scene := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/go-out-checklist/templates/work/apply",
		"{}",
		token,
		http.StatusCreated,
	)
	sceneID, _ := scene["id"].(string)
	if sceneID == "" {
		t.Fatalf("apply template did not return scene: %+v", scene)
	}

	home := requestJSON[goOutHomeResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/go-out-checklist/home?sceneId="+sceneID,
		"",
		token,
		http.StatusOK,
	)
	if len(home.Items) != 4 || home.ActiveSceneID != sceneID {
		t.Fatalf("unexpected home after template: %+v", home)
	}

	confirmed := make([]map[string]any, 0, len(home.Items))
	for _, item := range home.Items {
		confirmed = append(confirmed, map[string]any{
			"id":   item["id"],
			"name": item["name"],
		})
	}
	completion := requestJSON[goOutCompletionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/go-out-checklist/completions",
		`{"sceneId":"`+sceneID+`","confirmedItems":`+mustJSON(t, confirmed)+`}`,
		token,
		http.StatusCreated,
	)
	if completion.ResultText != "今日出门检查完成，没有遗漏。" {
		t.Fatalf("unexpected result text: %s", completion.ResultText)
	}

	history := requestJSON[goOutHistoryResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/go-out-checklist/history",
		"",
		token,
		http.StatusOK,
	)
	if len(history.Records) != 1 {
		t.Fatalf("expected 1 history record, got %d", len(history.Records))
	}

	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodDelete,
		testServer.URL+"/api/v1/go-out-checklist/completions/"+completion.ID,
		"",
		token,
		http.StatusOK,
	)
	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodDelete,
		testServer.URL+"/api/v1/go-out-checklist/data",
		"",
		token,
		http.StatusOK,
	)
	afterClear := requestJSON[goOutHomeResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/go-out-checklist/home",
		"",
		token,
		http.StatusOK,
	)
	if len(afterClear.Items) != 0 {
		t.Fatalf("expected data cleared, got %+v", afterClear.Items)
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json: %v", err)
	}
	return string(encoded)
}
