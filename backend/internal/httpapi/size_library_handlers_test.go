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

type sizeLibraryProfileResponse struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type sizeLibraryMeasurementResponse struct {
	ID           string `json:"id"`
	ProfileID    string `json:"profileId"`
	DimensionKey string `json:"dimensionKey"`
	Value        string `json:"value"`
	Unit         string `json:"unit"`
}

type sizeLibraryStateResponse struct {
	SchemaVersion int                              `json:"schemaVersion"`
	Profiles      []sizeLibraryProfileResponse     `json:"profiles"`
	Measurements  []sizeLibraryMeasurementResponse `json:"measurements"`
	UpdatedAt     int64                            `json:"updatedAt"`
}

func TestSizeLibraryHTTPFlow(t *testing.T) {
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
		`{"username":"13700137004","password":"password-123","displayName":"尺寸库用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小尺"} `,
		"",
		http.StatusCreated,
	)
	token := session.AccessToken

	initial := requestJSON[sizeLibraryStateResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/size-library/state",
		"",
		token,
		http.StatusOK,
	)
	if initial.SchemaVersion != 1 || len(initial.Profiles) != 0 || len(initial.Measurements) != 0 {
		t.Fatalf("expected empty initial state, got %+v", initial)
	}

	stateBody := `{
		"schemaVersion":1,
		"profiles":[
			{"id":"p1","kind":"person","name":"妈妈","relation":"妈妈","roomId":"","color":"#18a78f","createdAt":100,"updatedAt":100}
		],
		"measurements":[
			{"id":"m1","profileId":"p1","dimensionKey":"height","label":"身高","value":"158","unit":"cm","note":"","updatedAt":200},
			{"id":"m2","profileId":"p1","dimensionKey":"clothingSize","label":"衣服尺码","value":"L","unit":"","note":"肩宽偏窄","updatedAt":300}
		]
	}`
	saved := requestJSON[sizeLibraryStateResponse](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/size-library/state",
		stateBody,
		token,
		http.StatusOK,
	)
	if saved.UpdatedAt <= 0 || len(saved.Profiles) != 1 || len(saved.Measurements) != 2 {
		t.Fatalf("unexpected saved state: %+v", saved)
	}

	cleared := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodDelete,
		testServer.URL+"/api/v1/size-library/state",
		"",
		token,
		http.StatusOK,
	)
	if cleared["success"] != true {
		t.Fatalf("expected clear success, got %+v", cleared)
	}

	afterClear := requestJSON[sizeLibraryStateResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/size-library/state",
		"",
		token,
		http.StatusOK,
	)
	if len(afterClear.Profiles) != 0 || len(afterClear.Measurements) != 0 {
		t.Fatalf("expected state cleared, got %+v", afterClear)
	}
}

func TestSizeLibraryRejectsInvalidState(t *testing.T) {
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
		`{"username":"13700137005","password":"password-123","displayName":"尺寸库用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小尺"} `,
		"",
		http.StatusCreated,
	)
	invalid := requestJSON[map[string]string](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/size-library/state",
		`{
			"schemaVersion":1,
			"profiles":[
				{"id":"p1","kind":"person","name":"妈妈","roomId":"","color":"#18a78f","createdAt":100,"updatedAt":100},
				{"id":"p2","kind":"person","name":"妈妈","roomId":"","color":"#18a78f","createdAt":200,"updatedAt":200}
			],
			"measurements":[]
		}`,
		session.AccessToken,
		http.StatusBadRequest,
	)
	if invalid["error"] != "size_library_invalid_input" {
		t.Fatalf("expected invalid input error, got %+v", invalid)
	}
}
