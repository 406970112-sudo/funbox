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

type daysLeftCategoryResponse struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type daysLeftRecordResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	RecordType string `json:"recordType"`
	Status     string `json:"status"`
	ExpiryDate string `json:"expiryDate"`
	DaysLeft   int    `json:"daysLeft"`
	Verified   bool   `json:"verified"`
}

type daysLeftSummaryResponse struct {
	Date    string                    `json:"date"`
	Overdue int                       `json:"overdue"`
	Next7   int                       `json:"next7"`
	Next30  int                       `json:"next30"`
	Next90  int                       `json:"next90"`
	Today   []daysLeftRecordResponse  `json:"today"`
	Soon    []daysLeftRecordResponse  `json:"soon"`
}

func TestDaysLeftHTTPFlow(t *testing.T) {
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
	if err := accessStore.SyncRegistry(context.Background(), []access.FeatureDefinition{
		{ID: "days-left", Name: "还有几天", Route: "/tools/days-left", Category: "生活"},
	}); err != nil {
		t.Fatalf("sync registry: %v", err)
	}

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
			AvatarDir:             filepath.Join(tempDir, "avatars"),
			DaysLeftDir:           filepath.Join(tempDir, "days-left"),
			MaxAvatarBytes:        1 << 20,
			MaxDaysLeftImageBytes: 5 << 20,
			MaxDaysLeftImages:     5,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	httpServer := NewServerWithReadingNewsFeedbackAndFocus(
		cfg, nil, nil, authService, socialStore, accessStore, nil, nil, nil, nil, nil,
	)
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
		`{"username":"13700137001","password":"password-123","displayName":"期限用户","securityQuestion":"你的第一个绰号是什么？","securityAnswer":"小限"}`,
		"",
		http.StatusCreated,
	)
	token := session.AccessToken

	categories := requestJSON[map[string][]daysLeftCategoryResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/days-left/categories",
		"",
		token,
		http.StatusOK,
	)
	if len(categories["categories"]) != 6 {
		t.Fatalf("system categories = %d", len(categories["categories"]))
	}
	var digitalCategoryID string
	for _, category := range categories["categories"] {
		if category.Name == "数字资产" {
			digitalCategoryID = category.ID
		}
	}
	if digitalCategoryID == "" {
		t.Fatal("digital asset category missing")
	}

	expiry := time.Now().AddDate(0, 0, 83).Format("2006-01-02")
	record := requestJSON[daysLeftRecordResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/days-left/records",
		`{"categoryId":"`+digitalCategoryID+`","name":"xwhub.cn SSL 证书","recordType":"recurring","expiryDate":"`+expiry+`","cycleUnit":"year","cycleInterval":1,"reminderLeadDays":30,"source":"api","verified":true}`,
		token,
		http.StatusCreated,
	)
	if record.RecordType != "recurring" || !record.Verified || record.DaysLeft != 83 {
		t.Fatalf("created record = %+v", record)
	}

	summary := requestJSON[daysLeftSummaryResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/days-left/summary",
		"",
		token,
		http.StatusOK,
	)
	if summary.Next90 != 1 {
		t.Fatalf("summary next90 = %+v", summary)
	}

	records := requestJSON[map[string][]daysLeftRecordResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/days-left/records?category="+digitalCategoryID+"&q=SSL",
		"",
		token,
		http.StatusOK,
	)
	if len(records["records"]) != 1 || records["records"][0].ID != record.ID {
		t.Fatalf("filtered records = %+v", records)
	}

	updated := requestJSON[daysLeftRecordResponse](
		t,
		testServer.Client(),
		http.MethodPatch,
		testServer.URL+"/api/v1/days-left/records/"+record.ID,
		`{"name":"xwhub.cn 证书续期"}`,
		token,
		http.StatusOK,
	)
	if updated.Name != "xwhub.cn 证书续期" {
		t.Fatalf("updated record = %+v", updated)
	}

	renewedExpiry := time.Now().AddDate(1, 0, 0).Format("2006-01-02")
	renewed := requestJSON[daysLeftRecordResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/days-left/records/"+record.ID+"/renew",
		`{"newExpiryDate":"`+renewedExpiry+`","note":"Let's Encrypt 自动续期"}`,
		token,
		http.StatusOK,
	)
	if renewed.Status != "active" || renewed.ExpiryDate != renewedExpiry {
		t.Fatalf("renewed record = %+v", renewed)
	}

	completed := requestJSON[daysLeftRecordResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/days-left/records/"+record.ID+"/complete",
		`{"note":"已完成本期"}`,
		token,
		http.StatusOK,
	)
	if completed.Status != "completed" {
		t.Fatalf("completed record = %+v", completed)
	}

	undone := requestJSON[daysLeftRecordResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/days-left/records/"+record.ID+"/undo",
		"{}",
		token,
		http.StatusOK,
	)
	if undone.Status != "active" {
		t.Fatalf("undone record = %+v", undone)
	}

	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/days-left/export?format=json",
		"",
		token,
		http.StatusOK,
	)
	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/days-left/verify/ssl?host=https://example.com",
		"",
		token,
		http.StatusBadRequest,
	)
}
