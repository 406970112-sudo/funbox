package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

type leftoverItemResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	PhotoCount int    `json:"photoCount"`
}

type leftoverHomeResponse struct {
	Summary struct {
		ActiveCount  int `json:"activeCount"`
		TodayCount   int `json:"todayCount"`
		ExpiredCount int `json:"expiredCount"`
	} `json:"summary"`
	Priority    []leftoverItemResponse `json:"priority"`
	Suggestions []struct {
		RecipeID string `json:"recipeId"`
	} `json:"suggestions"`
	ServerNow int64 `json:"serverNow"`
}

func TestLeftoverManagerHTTPFlow(t *testing.T) {
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
			LeftoverDir:    filepath.Join(tempDir, "leftover-photos"),
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
		`{"username":"13700137010","password":"password-123","displayName":"冰箱用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"冰箱"} `,
		"",
		http.StatusCreated,
	)
	token := session.AccessToken

	empty := requestJSON[leftoverHomeResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/leftover-manager/home",
		"",
		token,
		http.StatusOK,
	)
	if empty.Summary.ActiveCount != 0 || len(empty.Priority) != 0 || len(empty.Suggestions) != 0 {
		t.Fatalf("expected empty leftover home, got %+v", empty)
	}

	now := time.Now().UnixMilli()
	itemBody := `{
		"name":"昨天的红烧肉",
		"sourceType":"leftover",
		"merchant":"",
		"enteredFridgeAt":` + strconv.FormatInt(now-20*60*60*1000, 10) + `,
		"expectedConsumeAt":` + strconv.FormatInt(now+2*60*60*1000, 10) + `,
		"storedZone":"fridge",
		"remainingPercent":50,
		"remainingText":"一半",
		"reheatCount":0,
		"tags":["红烧肉"],
		"costCents":1800,
		"notes":""
	}`
	item := requestJSON[leftoverItemResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/leftover-manager/items",
		itemBody,
		token,
		http.StatusCreated,
	)
	if item.Name != "昨天的红烧肉" || item.Status != "active" {
		t.Fatalf("unexpected created item: %+v", item)
	}

	home := requestJSON[leftoverHomeResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/leftover-manager/home",
		"",
		token,
		http.StatusOK,
	)
	if home.Summary.ActiveCount != 1 || len(home.Priority) != 1 {
		t.Fatalf("unexpected home after create: %+v", home)
	}

	eaten := requestJSON[leftoverItemResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/leftover-manager/items/"+item.ID+"/eat",
		"{}",
		token,
		http.StatusOK,
	)
	if eaten.Status != "eaten" {
		t.Fatalf("unexpected eaten item: %+v", eaten)
	}

	history := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/leftover-manager/history",
		"",
		token,
		http.StatusOK,
	)
	if history["items"] == nil {
		t.Fatalf("expected history items, got %+v", history)
	}

	settingsBody := `{
		"remindBeforeHours":4,
		"daily09Enabled":true,
		"evening19Enabled":false,
		"notificationEnabled":false
	}`
	settings := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/leftover-manager/settings",
		settingsBody,
		token,
		http.StatusOK,
	)
	if settings["remindBeforeHours"] != float64(4) {
		t.Fatalf("unexpected settings: %+v", settings)
	}

	cleared := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodDelete,
		testServer.URL+"/api/v1/leftover-manager/data",
		"",
		token,
		http.StatusOK,
	)
	if cleared["success"] != true {
		t.Fatalf("expected clear success, got %+v", cleared)
	}
}
