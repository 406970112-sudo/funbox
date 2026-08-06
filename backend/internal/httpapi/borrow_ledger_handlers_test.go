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

type borrowLedgerCounterpartyResponse struct {
	FriendID string `json:"friendId"`
	Name     string `json:"name"`
}

type borrowLedgerRecordResponse struct {
	ID           string                           `json:"id"`
	Kind         string                           `json:"kind"`
	SubjectType  string                           `json:"subjectType"`
	Title        string                           `json:"title"`
	Amount       *float64                         `json:"amount"`
	Currency     string                           `json:"currency"`
	Counterparty borrowLedgerCounterpartyResponse `json:"counterparty"`
	LentAt       string                           `json:"lentAt"`
	DueAt        string                           `json:"dueAt"`
	RemindRule   string                           `json:"remindRule"`
	ReturnedAt   string                           `json:"returnedAt"`
}

type borrowLedgerStateResponse struct {
	SchemaVersion int                          `json:"schemaVersion"`
	Records       []borrowLedgerRecordResponse `json:"records"`
	UpdatedAt     int64                        `json:"updatedAt"`
}

func TestBorrowLedgerHTTPFlow(t *testing.T) {
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
		`{"username":"13700137006","password":"password-123","displayName":"借还用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小借"} `,
		"",
		http.StatusCreated,
	)
	token := session.AccessToken

	initial := requestJSON[borrowLedgerStateResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/borrow-ledger/state",
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
			{
				"id":"r1",
				"kind":"lend_out",
				"subjectType":"item",
				"title":"充电器",
				"counterparty":{"friendId":"","name":"阿哲","avatarUrl":""},
				"lentAt":"2026-08-01",
				"dueAt":"2026-08-10",
				"remindRule":"before_3d",
				"returnedAt":"",
				"settledAt":"",
				"note":"",
				"createdAt":100,
				"updatedAt":100
			},
			{
				"id":"r2",
				"kind":"paid_for",
				"subjectType":"money",
				"title":"垫付费用",
				"amount":120,
				"currency":"CNY",
				"counterparty":{"friendId":"","name":"小王","avatarUrl":""},
				"lentAt":"2026-08-02",
				"dueAt":"",
				"remindRule":"none",
				"returnedAt":"",
				"settledAt":"",
				"note":"",
				"createdAt":200,
				"updatedAt":200
			}
		]
	}`
	saved := requestJSON[borrowLedgerStateResponse](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/borrow-ledger/state",
		stateBody,
		token,
		http.StatusOK,
	)
	if saved.UpdatedAt <= 0 || len(saved.Records) != 2 {
		t.Fatalf("unexpected saved state: %+v", saved)
	}
	if saved.Records[1].Amount == nil || *saved.Records[1].Amount != 120 {
		t.Fatalf("unexpected amount: %+v", saved.Records[1].Amount)
	}

	cleared := requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodDelete,
		testServer.URL+"/api/v1/borrow-ledger/state",
		"",
		token,
		http.StatusOK,
	)
	if cleared["success"] != true {
		t.Fatalf("expected clear success, got %+v", cleared)
	}

	afterClear := requestJSON[borrowLedgerStateResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/borrow-ledger/state",
		"",
		token,
		http.StatusOK,
	)
	if len(afterClear.Records) != 0 {
		t.Fatalf("expected state cleared, got %+v", afterClear)
	}
}

func TestBorrowLedgerRejectsInvalidState(t *testing.T) {
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
		`{"username":"13700137007","password":"password-123","displayName":"借还用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小借"} `,
		"",
		http.StatusCreated,
	)
	invalid := requestJSON[map[string]string](
		t,
		testServer.Client(),
		http.MethodPut,
		testServer.URL+"/api/v1/borrow-ledger/state",
		`{
			"schemaVersion":1,
			"records":[
				{
					"id":"r1",
					"kind":"lend_out",
					"subjectType":"money",
					"title":"借款",
					"counterparty":{"friendId":"","name":"阿哲","avatarUrl":""},
					"lentAt":"2026-08-01",
					"remindRule":"none"
				}
			]
		}`,
		session.AccessToken,
		http.StatusBadRequest,
	)
	if invalid["error"] != "borrow_ledger_invalid_input" {
		t.Fatalf("expected invalid input error, got %+v", invalid)
	}
}
