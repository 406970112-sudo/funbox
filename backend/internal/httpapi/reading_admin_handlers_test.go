package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/reading"
	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestAdminReadingUploadReviewPublishAndHideFlow(t *testing.T) {
	server, userStore, adminToken, memberToken := newAdminReadingHTTPTestServer(t)

	uploadReadingFile(t, server, memberToken, "book.txt", []byte("第一章 无权上传\n内容"), http.StatusForbidden)
	result := uploadReadingFile(t, server, adminToken, "fog.txt", []byte("书名：雾港来信\n作者：林深\n\n第一章 雾中的灯\n灯塔亮了。\n\n第二章 旧邮局\n信还在。"), http.StatusCreated)
	if result.Book.PublishStatus != reading.StatusDraft || len(result.Chapters) != 2 {
		t.Fatalf("import result = %+v", result)
	}
	previewChapters := requestJSON[map[string][]reading.Chapter](t, server.Client(), http.MethodGet,
		server.URL+"/api/v1/admin/reading/books/"+result.Book.ID+"/chapters", "", adminToken, http.StatusOK)
	if len(previewChapters["chapters"]) != 2 {
		t.Fatalf("preview chapters = %+v", previewChapters)
	}
	preview := requestJSON[reading.ChapterContent](t, server.Client(), http.MethodGet,
		server.URL+"/api/v1/admin/reading/books/"+result.Book.ID+"/chapters/"+result.Chapters[0].ID, "", adminToken, http.StatusOK)
	if preview.BookID != result.Book.ID || preview.Content == "" {
		t.Fatalf("chapter preview = %+v", preview)
	}

	job := requestJSON[reading.ImportJob](t, server.Client(), http.MethodGet,
		server.URL+"/api/v1/admin/reading/imports/"+result.ImportID, "", adminToken, http.StatusOK)
	if job.BookID != result.Book.ID || job.Status != "completed" {
		t.Fatalf("import job = %+v", job)
	}

	requestJSON[map[string]any](t, server.Client(), http.MethodPost,
		server.URL+"/api/v1/admin/reading/books/"+result.Book.ID+"/publish", "", adminToken, http.StatusBadRequest)
	updated := requestJSON[map[string]reading.Book](t, server.Client(), http.MethodPatch,
		server.URL+"/api/v1/admin/reading/books/"+result.Book.ID,
		`{"title":"雾港来信","author":"林深","intro":"一封跨越二十年的来信。","category":"悬疑","rights":{"licensor":"星河版权中心","scope":"中国大陆地区免费在线阅读","proofNote":"合同 YW-2026-001","validFrom":"2026-01-01T00:00:00Z","validUntil":"2027-12-31T23:59:59Z"}}`,
		adminToken, http.StatusOK)
	if updated["book"].Rights == nil || updated["book"].Rights.Licensor != "星河版权中心" {
		t.Fatalf("updated book = %+v", updated)
	}
	published := requestJSON[map[string]reading.Book](t, server.Client(), http.MethodPost,
		server.URL+"/api/v1/admin/reading/books/"+result.Book.ID+"/publish", "", adminToken, http.StatusOK)
	if published["book"].PublishStatus != reading.StatusPublished {
		t.Fatalf("published book = %+v", published)
	}

	public := requestJSON[map[string][]reading.Book](t, server.Client(), http.MethodGet,
		server.URL+"/api/v1/reading/books?q=雾港", "", "", http.StatusOK)
	if len(public["books"]) != 1 || public["books"][0].ID != result.Book.ID {
		t.Fatalf("public books = %+v", public)
	}
	requestJSON[map[string]reading.Book](t, server.Client(), http.MethodPost,
		server.URL+"/api/v1/admin/reading/books/"+result.Book.ID+"/hide", "", adminToken, http.StatusOK)
	requestJSON[map[string]any](t, server.Client(), http.MethodGet,
		server.URL+"/api/v1/reading/books/"+result.Book.ID, "", "", http.StatusGone)

	account, err := userStore.GetByUsername(context.Background(), "13800138000")
	if err != nil || account.Role != roles.Admin {
		t.Fatalf("admin account = %+v, err = %v", account, err)
	}
}

func newAdminReadingHTTPTestServer(t *testing.T) (*httptest.Server, *user.Store, string, string) {
	t.Helper()
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
	readingStore, err := reading.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open reading store: %v", err)
	}
	t.Cleanup(func() { _ = readingStore.Close() })
	readingService := reading.NewService(readingStore, reading.NewMockProvider(), reading.ServiceOptions{LibraryEnabled: true, StorageDir: filepath.Join(tempDir, "reading")})

	cfg := config.Config{
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server:   config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 100, RateLimitWindow: time.Minute},
		Storage:  config.StorageConfig{AvatarDir: filepath.Join(tempDir, "avatars"), ReadingDir: filepath.Join(tempDir, "reading"), MaxAvatarBytes: 1 << 20, MaxReadingUploadBytes: 2 << 20, MaxReadingExtractedBytes: 8 << 20},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	httpServer := NewServerWithReadingAndNews(cfg, nil, nil, authService, socialStore, accessStore, nil, readingService)
	server := httptest.NewServer(httpServer.Handler)
	t.Cleanup(server.Close)

	admin := requestJSON[sessionResponse](t, server.Client(), http.MethodPost, server.URL+"/api/v1/auth/register",
		`{"username":"13800138000","password":"password-123","displayName":"管理员","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小管"}`, "", http.StatusCreated)
	if _, err := userStore.UpdateRoleByUsername(context.Background(), admin.User.Username, roles.Admin); err != nil {
		t.Fatalf("promote admin: %v", err)
	}
	admin = requestJSON[sessionResponse](t, server.Client(), http.MethodPost, server.URL+"/api/v1/auth/login",
		`{"username":"13800138000","password":"password-123"}`, "", http.StatusOK)
	member := requestJSON[sessionResponse](t, server.Client(), http.MethodPost, server.URL+"/api/v1/auth/register",
		`{"username":"13900139000","password":"password-123","displayName":"普通用户","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小普"}`, "", http.StatusCreated)
	return server, userStore, admin.AccessToken, member.AccessToken
}

func uploadReadingFile(t *testing.T, server *httptest.Server, token, name string, content []byte, wantStatus int) reading.ImportResult {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		t.Fatalf("create reading file part: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write reading file part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close reading form: %v", err)
	}
	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/admin/reading/imports", body)
	if err != nil {
		t.Fatalf("create upload request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("upload reading file: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != wantStatus {
		t.Fatalf("upload status = %d, want %d", response.StatusCode, wantStatus)
	}
	var result reading.ImportResult
	if wantStatus == http.StatusCreated {
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatalf("decode import result: %v", err)
		}
	}
	return result
}
