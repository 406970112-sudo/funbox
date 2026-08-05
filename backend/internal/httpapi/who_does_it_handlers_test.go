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

type whoDoesItRecordResponse struct {
	ID               string   `json:"id"`
	WinnerName       string   `json:"winnerName"`
	ParticipantNames []string `json:"participantNames"`
	TaskText         string   `json:"taskText"`
}

type whoDoesItStateResponse struct {
	Participants []whoDoesItParticipantResponse `json:"participants"`
	Records      []whoDoesItRecordResponse      `json:"records"`
	UpdatedAt    int64                          `json:"updatedAt"`
}

type whoDoesItParticipantResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func TestWhoDoesItHTTPFlow(t *testing.T) {
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
		`{"username":"13700137002","password":"password-123","displayName":"转盘用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小转"} `,
		"",
		http.StatusCreated,
	)
	token := session.AccessToken

	initial := requestJSON[whoDoesItStateResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/who-does-it/state",
		"",
		token,
		http.StatusOK,
	)
	if len(initial.Participants) != 0 || len(initial.Records) != 0 {
		t.Fatalf("expected empty initial state, got %+v", initial)
	}

	stateBody := `{
		"participants":[
			{"id":"p1","name":"阿伟","createdAt":100},
			{"id":"p2","name":"小红","createdAt":200}
		],
		"settings":{"taskMode":"custom","customTask":"去洗碗"},
		"records":[{
			"id":"r1",
			"createdAt":` + "1000" + `,
			"participantNames":["阿伟","小红"],
			"winnerName":"小红",
			"taskText":"去洗碗",
			"taskMode":"custom",
			"participantCount":2
		}]
	}`
	saved := requestJSON[whoDoesItStateResponse](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/who-does-it/state",
		stateBody,
		token,
		http.StatusOK,
	)
	if saved.UpdatedAt <= 0 || len(saved.Participants) != 2 {
		t.Fatalf("unexpected saved state: %+v", saved)
	}

	records := requestJSON[map[string][]whoDoesItRecordResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/who-does-it/records",
		"",
		token,
		http.StatusOK,
	)
	if len(records["records"]) != 1 || records["records"][0].WinnerName != "小红" {
		t.Fatalf("unexpected records: %+v", records)
	}

	cleared := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodDelete,
		testServer.URL+"/api/v1/who-does-it/records",
		"",
		token,
		http.StatusOK,
	)
	if cleared["success"] != true {
		t.Fatalf("expected clear success, got %+v", cleared)
	}

	afterClear := requestJSON[map[string][]whoDoesItRecordResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/who-does-it/records",
		"",
		token,
		http.StatusOK,
	)
	if len(afterClear["records"]) != 0 {
		t.Fatalf("expected records cleared, got %+v", afterClear)
	}
}

func TestWhoDoesItRejectsInvalidState(t *testing.T) {
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
		`{"username":"13700137003","password":"password-123","displayName":"转盘用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小转"} `,
		"",
		http.StatusCreated,
	)
	invalid := requestJSON[map[string]string](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/who-does-it/state",
		`{
			"participants":[
				{"id":"p1","name":"阿伟","createdAt":100},
				{"id":"p2","name":"阿伟","createdAt":200}
			],
			"settings":{"taskMode":"person-only"},
			"records":[]
		}`,
		session.AccessToken,
		http.StatusBadRequest,
	)
	if invalid["error"] != "who_does_it_invalid_input" {
		t.Fatalf("expected invalid input error, got %+v", invalid)
	}
}
