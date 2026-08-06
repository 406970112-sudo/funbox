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

type shoppingRouteListResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type shoppingRouteItemResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Quantity string `json:"quantity"`
}

type shoppingRouteStoreResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type shoppingRouteZoneResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	ZoneType string `json:"zoneType"`
}

type shoppingRouteRouteResponse struct {
	ID            string                          `json:"id"`
	Status        string                          `json:"status"`
	MappedCount   int                             `json:"mappedCount"`
	TotalCount    int                             `json:"totalCount"`
	UnmappedCount int                             `json:"unmappedCount"`
	Zones         []shoppingRouteRouteZoneResponse `json:"zones"`
	CompletedAt   int64                           `json:"completedAt"`
}

type shoppingRouteRouteZoneResponse struct {
	Zone shoppingRouteZoneResponse `json:"zone"`
}

func TestShoppingRouteHTTPFlow(t *testing.T) {
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
		`{"username":"13700137006","password":"password-123","displayName":"购物路线用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小路"} `,
		"",
		http.StatusCreated,
	)
	token := session.AccessToken

	home := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/shopping-route/home",
		"",
		token,
		http.StatusOK,
	)
	if len(home["lists"].([]any)) != 0 || len(home["stores"].([]any)) != 0 {
		t.Fatalf("expected empty home, got %+v", home)
	}

	list := requestJSON[shoppingRouteListResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/shopping-route/lists",
		`{"name":"家庭采购"}`,
		token,
		http.StatusCreated,
	)
	item := requestJSON[shoppingRouteItemResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/shopping-route/lists/"+list.ID+"/items",
		`{"name":"西红柿","quantity":"2个","unit":"","barcode":"","note":""}`,
		token,
		http.StatusCreated,
	)
	store := requestJSON[shoppingRouteStoreResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/shopping-route/stores",
		`{"name":"常去超市","address":"测试路 1 号"}`,
		token,
		http.StatusCreated,
	)
	zonesBody := requestJSON[struct {
		Items []shoppingRouteZoneResponse `json:"items"`
	}](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/shopping-route/stores/"+store.ID+"/zones",
		`[{"name":"蔬菜区","zoneType":"produce"},{"name":"日用品区","zoneType":"household"}]`,
		token,
		http.StatusOK,
	)
	if len(zonesBody.Items) != 2 {
		t.Fatalf("unexpected zones: %+v", zonesBody)
	}

	suggestions := requestJSON[struct {
		Items []shoppingRouteSuggestionResponse `json:"items"`
	}](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/shopping-route/mapping-suggestions?listId="+list.ID+"&storeId="+store.ID,
		"",
		token,
		http.StatusOK,
	)
	if len(suggestions.Items) != 1 || suggestions.Items[0].ItemID != item.ID {
		t.Fatalf("expected verified suggestion for tomato, got %+v", suggestions)
	}

	mapping := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/shopping-route/mappings",
		`{"itemId":"`+item.ID+`","storeId":"`+store.ID+`","zoneId":"`+zonesBody.Items[0].ID+`"}`,
		token,
		http.StatusOK,
	)
	if mapping["itemKey"] != "西红柿" {
		t.Fatalf("unexpected mapping: %+v", mapping)
	}

	route := requestJSON[shoppingRouteRouteResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/shopping-route/routes",
		`{"listId":"`+list.ID+`","storeId":"`+store.ID+`"}`,
		token,
		http.StatusCreated,
	)
	if route.MappedCount != 1 || route.UnmappedCount != 0 || route.TotalCount != 1 {
		t.Fatalf("unexpected route: %+v", route)
	}

	completed := requestJSON[shoppingRouteRouteResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/shopping-route/routes/"+route.ID+"/complete",
		"",
		token,
		http.StatusOK,
	)
	if completed.Status != "complete" || completed.CompletedAt <= 0 {
		t.Fatalf("unexpected completed route: %+v", completed)
	}

	history := requestJSON[struct {
		Items []shoppingRouteRouteResponse `json:"items"`
	}](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/shopping-route/history",
		"",
		token,
		http.StatusOK,
	)
	if len(history.Items) != 1 || history.Items[0].ID != route.ID {
		t.Fatalf("unexpected history: %+v", history)
	}
}

type shoppingRouteSuggestionResponse struct {
	ItemID   string `json:"itemId"`
	Name     string `json:"name"`
	ZoneType string `json:"zoneType"`
	ZoneName string `json:"zoneName"`
}
