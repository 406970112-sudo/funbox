package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestAuthHTTPFlow(t *testing.T) {
	tempDir := t.TempDir()
	store, err := user.OpenStore(filepath.Join(tempDir, "users.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

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
	authService := auth.NewService(store, []byte(strings.Repeat("k", 32)), time.Hour)
	socialStore, err := social.OpenStore(filepath.Join(tempDir, "users.db"))
	if err != nil {
		t.Fatalf("open social store: %v", err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	httpServer := NewServer(cfg, nil, nil, authService, socialStore)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	registered := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800138000","password":"password-123","displayName":"测试用户","securityQuestion":"你小时候最喜欢的书是什么？","securityAnswer":"海底两万里"}`,
		"",
		http.StatusCreated,
	)
	if registered.User.Username != "13800138000" || registered.AccessToken == "" {
		t.Fatalf("unexpected registration response: %+v", registered)
	}

	me := requestJSON[map[string]authUserResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/auth/me",
		"",
		registered.AccessToken,
		http.StatusOK,
	)
	if me["user"].DisplayName != "测试用户" {
		t.Fatalf("current user = %+v", me["user"])
	}

	updated := requestJSON[map[string]authUserResponse](
		t,
		testServer.Client(),
		http.MethodPatch,
		testServer.URL+"/api/v1/users/me",
		`{"displayName":"新昵称"}`,
		registered.AccessToken,
		http.StatusOK,
	)
	if updated["user"].DisplayName != "新昵称" {
		t.Fatalf("updated user = %+v", updated["user"])
	}

	avatarURL := uploadTestAvatar(t, testServer, registered.AccessToken)
	response, err := testServer.Client().Get(testServer.URL + avatarURL)
	if err != nil {
		t.Fatalf("read uploaded avatar: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("avatar status = %d", response.StatusCode)
	}

	changed := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPatch,
		testServer.URL+"/api/v1/users/me/password",
		`{"currentPassword":"password-123","newPassword":"next-password-456"}`,
		registered.AccessToken,
		http.StatusOK,
	)
	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/auth/me",
		"",
		registered.AccessToken,
		http.StatusUnauthorized,
	)
	requestJSON[map[string]authUserResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/auth/me",
		"",
		changed.AccessToken,
		http.StatusOK,
	)

	if _, err := store.GetByUsername(context.Background(), "13800138000"); err != nil {
		t.Fatalf("read persisted user: %v", err)
	}

	requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13900139000","password":"password-123","displayName":"找回用户","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小布同学"}`,
		"",
		http.StatusCreated,
	)
	question := requestJSON[map[string]string](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/password-recovery/question",
		`{"username":"13900139000"}`,
		"",
		http.StatusOK,
	)
	if question["securityQuestion"] != "你的第一个昵称是什么？" {
		t.Fatalf("recovery question = %q", question["securityQuestion"])
	}
	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/password-recovery/verify",
		`{"username":"13900139000","securityAnswer":"错误答案"}`,
		"",
		http.StatusUnauthorized,
	)
	verified := requestJSON[map[string]string](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/password-recovery/verify",
		`{"username":"13900139000","securityAnswer":"小布同学"}`,
		"",
		http.StatusOK,
	)
	if verified["recoveryToken"] == "" {
		t.Fatal("recovery token is empty")
	}
	resetBody, err := json.Marshal(map[string]string{
		"recoveryToken": verified["recoveryToken"],
		"newPassword":   "recovered-456",
	})
	if err != nil {
		t.Fatalf("encode recovery reset request: %v", err)
	}
	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/password-recovery/reset",
		string(resetBody),
		"",
		http.StatusOK,
	)
	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/login",
		`{"username":"13900139000","password":"password-123"}`,
		"",
		http.StatusUnauthorized,
	)
	requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/login",
		`{"username":"13900139000","password":"recovered-456"}`,
		"",
		http.StatusOK,
	)
}

func uploadTestAvatar(t *testing.T, server *httptest.Server, token string) string {
	t.Helper()

	imageBuffer := &bytes.Buffer{}
	avatar := image.NewRGBA(image.Rect(0, 0, 2, 2))
	avatar.Set(0, 0, color.RGBA{R: 75, G: 107, B: 255, A: 255})
	if err := png.Encode(imageBuffer, avatar); err != nil {
		t.Fatalf("encode avatar: %v", err)
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	filePart, err := writer.CreateFormFile("avatar", "avatar.png")
	if err != nil {
		t.Fatalf("create avatar form field: %v", err)
	}
	if _, err := filePart.Write(imageBuffer.Bytes()); err != nil {
		t.Fatalf("write avatar form field: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close avatar form: %v", err)
	}

	request, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/v1/users/me/avatar",
		body,
	)
	if err != nil {
		t.Fatalf("create avatar request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", writer.FormDataContentType())

	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("upload avatar: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("avatar upload status = %d", response.StatusCode)
	}

	var payload map[string]authUserResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode avatar response: %v", err)
	}
	if payload["user"].AvatarURL == "" {
		t.Fatal("avatar URL is empty")
	}
	return payload["user"].AvatarURL
}

func requestJSON[T any](
	t *testing.T,
	client *http.Client,
	method string,
	url string,
	body string,
	token string,
	wantStatus int,
) T {
	t.Helper()

	request, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}

	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("perform request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != wantStatus {
		t.Fatalf("status = %d, want %d", response.StatusCode, wantStatus)
	}

	var payload T
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return payload
}
