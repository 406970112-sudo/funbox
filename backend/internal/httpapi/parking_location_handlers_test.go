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

type parkingLocationStateResponse struct {
	SchemaVersion int `json:"schemaVersion"`
	Records       []struct {
		ID             string `json:"id"`
		ParkingLotName string `json:"parkingLotName"`
		FloorLabel     string `json:"floorLabel"`
		Status         string `json:"status"`
	} `json:"records"`
	UpdatedAt int64 `json:"updatedAt"`
}

func TestParkingLocationHTTPFlow(t *testing.T) {
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
		`{"username":"13700137006","password":"password-123","displayName":"停车用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"停车"} `,
		"",
		http.StatusCreated,
	)
	token := session.AccessToken

	initial := requestJSON[parkingLocationStateResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/parking-location/state",
		"",
		token,
		http.StatusOK,
	)
	if initial.SchemaVersion != 1 || len(initial.Records) != 0 {
		t.Fatalf("expected empty initial state, got %+v", initial)
	}

	stateBody := `{
		"schemaVersion":1,
		"records":[
			{"id":"parking-1","parkingLotName":"成都新世纪环球中心","mapPoiId":"","mapPoiName":"成都新世纪环球中心","latitude":30.5713,"longitude":104.0624,"accuracyM":18,"floorLabel":"B3","zoneLabel":"C区","spotLabel":"328号","landmarkNote":"靠近蓝色电梯","note":"","parkedAt":1000,"leaveAt":null,"status":"active","feeRuleId":"","reminderMinutes":30,"reminderMode":"fixed","estimatedFeeCents":null,"actualFeeCents":null,"photoCount":0,"coverPhotoUri":"","photos":[],"createdAt":1000,"updatedAt":1000}
		],
		"feeRules":[],
		"settings":{"defaultReminderMinutes":30,"ruleBoundaryEnabled":true,"cancelOnLeave":true,"updatedAt":0},
		"searchHistory":[],
		"updatedAt":0
	}`
	saved := requestJSON[parkingLocationStateResponse](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/parking-location/state",
		stateBody,
		token,
		http.StatusOK,
	)
	if saved.UpdatedAt <= 0 || len(saved.Records) != 1 || saved.Records[0].ParkingLotName != "成都新世纪环球中心" {
		t.Fatalf("unexpected saved state: %+v", saved)
	}

	cleared := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodDelete,
		testServer.URL+"/api/v1/parking-location/state",
		"",
		token,
		http.StatusOK,
	)
	if cleared["success"] != true {
		t.Fatalf("expected clear success, got %+v", cleared)
	}

	afterClear := requestJSON[parkingLocationStateResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/parking-location/state",
		"",
		token,
		http.StatusOK,
	)
	if len(afterClear.Records) != 0 {
		t.Fatalf("expected records cleared, got %+v", afterClear)
	}
}

func TestParkingLocationRejectsInvalidState(t *testing.T) {
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
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
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
		`{"username":"13700137007","password":"password-123","displayName":"停车用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"停车"} `,
		"",
		http.StatusCreated,
	)
	invalid := requestJSON[map[string]string](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/parking-location/state",
		`{"schemaVersion":1,"records":[{"id":"bad","parkingLotName":"测试","parkedAt":1000,"status":"active","reminderMode":"none","createdAt":1000,"updatedAt":1000}],"feeRules":[],"settings":{"defaultReminderMinutes":30,"ruleBoundaryEnabled":true,"cancelOnLeave":true,"updatedAt":0},"searchHistory":[],"updatedAt":0}`,
		session.AccessToken,
		http.StatusBadRequest,
	)
	if !strings.Contains(invalid["error"], "parking_location_invalid_input") {
		t.Fatalf("unexpected error payload: %+v", invalid)
	}
}
