package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
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
	"my-first-expo-app/backend/internal/feedback"
	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestFeedbackRoutesRequireAuthenticationAndAdmin(t *testing.T) {
	server, normalToken, _ := newFeedbackHTTPTestServer(t)
	if status := performFeedbackRequest(t, server, "POST", "/api/v1/feedback", nil, "", "").StatusCode; status != http.StatusUnauthorized {
		t.Fatalf("got %d", status)
	}
	if status := performFeedbackRequest(t, server, "GET", "/api/v1/admin/feedback", nil, normalToken, "").StatusCode; status != http.StatusForbidden {
		t.Fatalf("got %d", status)
	}
}

func TestFeedbackSubmissionAndAdminImageRead(t *testing.T) {
	server, normalToken, adminToken := newFeedbackHTTPTestServer(t)
	body, contentType := feedbackMultipart(t, "提交时页面一直显示加载中", [][]byte{feedbackPNGBytes(t)})
	created := performFeedbackRequest(t, server, "POST", "/api/v1/feedback", body, normalToken, contentType)
	created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("status=%d", created.StatusCode)
	}

	page := performFeedbackRequest(t, server, "GET", "/api/v1/admin/feedback?limit=30&offset=0", nil, adminToken, "")
	pageBody, err := io.ReadAll(page.Body)
	page.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if page.StatusCode != http.StatusOK || !bytes.Contains(pageBody, []byte("提交时页面一直显示加载中")) {
		t.Fatalf("body=%s", pageBody)
	}

	imagePath := decodeFirstFeedbackImagePath(t, pageBody)
	imageResponse := performFeedbackRequest(t, server, "GET", imagePath, nil, adminToken, "")
	imageResponse.Body.Close()
	if imageResponse.StatusCode != http.StatusOK || imageResponse.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("headers=%v status=%d", imageResponse.Header, imageResponse.StatusCode)
	}
	if cacheControl := imageResponse.Header.Get("Cache-Control"); !strings.Contains(cacheControl, "private") {
		t.Fatalf("cache control = %q", cacheControl)
	}

	forbidden := performFeedbackRequest(t, server, "GET", imagePath, nil, normalToken, "")
	forbidden.Body.Close()
	if forbidden.StatusCode != http.StatusForbidden {
		t.Fatalf("normal user image status = %d", forbidden.StatusCode)
	}
}

func TestFeedbackValidationErrors(t *testing.T) {
	server, normalToken, _ := newFeedbackHTTPTestServer(t)

	tooMany, contentType := feedbackMultipart(t, "这条描述内容足够长可以通过校验", [][]byte{
		feedbackPNGBytes(t),
		feedbackPNGBytes(t),
		feedbackPNGBytes(t),
		feedbackPNGBytes(t),
	})
	response := performFeedbackRequest(t, server, "POST", "/api/v1/feedback", tooMany, normalToken, contentType)
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d", response.StatusCode)
	}

	shortBody := &bytes.Buffer{}
	writer := multipart.NewWriter(shortBody)
	if err := writer.WriteField("description", "太短"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	response = performFeedbackRequest(
		t,
		server,
		"POST",
		"/api/v1/feedback",
		shortBody,
		normalToken,
		writer.FormDataContentType(),
	)
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("short description status = %d", response.StatusCode)
	}
}

func TestFeatureFeedbackSubmitNotifyResolveAndRead(t *testing.T) {
	server, normalToken, adminToken := newFeedbackHTTPTestServer(t)

	body, contentType := featureFeedbackMultipart(
		t,
		"发票识别工具",
		"tool",
		"希望增加发票识别工具，上传或拍照后自动识别发票金额、抬头和税号",
		[][]byte{feedbackPNGBytes(t)},
	)
	created := performFeedbackRequest(t, server, "POST", "/api/v1/feedback", body, normalToken, contentType)
	created.Body.Close()
	if created.StatusCode != http.StatusCreated {
		t.Fatalf("status=%d", created.StatusCode)
	}

	emptyNotifications := performFeedbackRequest(t, server, "GET", "/api/v1/feedback/notifications", nil, normalToken, "")
	emptyBody, err := io.ReadAll(emptyNotifications.Body)
	emptyNotifications.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if emptyNotifications.StatusCode != http.StatusOK || !bytes.Contains(emptyBody, []byte(`"unreadCount":0`)) {
		t.Fatalf("empty notifications body=%s status=%d", emptyBody, emptyNotifications.StatusCode)
	}

	filtered := performFeedbackRequest(
		t,
		server,
		"GET",
		"/api/v1/admin/feedback?kind=feature_request&status=pending",
		nil,
		adminToken,
		"",
	)
	filteredBody, err := io.ReadAll(filtered.Body)
	filtered.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if filtered.StatusCode != http.StatusOK || !bytes.Contains(filteredBody, []byte("发票识别")) {
		t.Fatalf("filtered body=%s status=%d", filteredBody, filtered.StatusCode)
	}

	resolveResponse := performFeedbackRequest(
		t,
		server,
		"POST",
		"/api/v1/admin/feedback/"+feedbackIDFromBody(t, filteredBody)+"/resolve",
		strings.NewReader(`{"status":"resolved","reply":"已评估，计划加入工具分类，先做拍照识别"}`),
		adminToken,
		"application/json",
	)
	resolveBody, err := io.ReadAll(resolveResponse.Body)
	resolveResponse.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if resolveResponse.StatusCode != http.StatusOK || !bytes.Contains(resolveBody, []byte("resolved")) {
		t.Fatalf("resolve body=%s status=%d", resolveBody, resolveResponse.StatusCode)
	}

	notifications := performFeedbackRequest(t, server, "GET", "/api/v1/feedback/notifications", nil, normalToken, "")
	notificationBody, err := io.ReadAll(notifications.Body)
	notifications.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if notifications.StatusCode != http.StatusOK ||
		!bytes.Contains(notificationBody, []byte(`"unreadCount":1`)) ||
		!bytes.Contains(notificationBody, []byte("已评估")) {
		t.Fatalf("notification body=%s status=%d", notificationBody, notifications.StatusCode)
	}

	readResponse := performFeedbackRequest(
		t,
		server,
		"POST",
		"/api/v1/feedback/notifications/read",
		strings.NewReader(`{}`),
		normalToken,
		"application/json",
	)
	readBody, err := io.ReadAll(readResponse.Body)
	readResponse.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if readResponse.StatusCode != http.StatusOK || !bytes.Contains(readBody, []byte(`"unreadCount":0`)) {
		t.Fatalf("read body=%s status=%d", readBody, readResponse.StatusCode)
	}
}

func newFeedbackHTTPTestServer(t *testing.T) (*httptest.Server, string, string) {
	t.Helper()
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "app.db")

	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	accessStore, err := access.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = accessStore.Close() })
	feedbackStore, err := feedback.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = feedbackStore.Close() })

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
			AvatarDir:             filepath.Join(tempDir, "avatars"),
			FeedbackDir:           filepath.Join(tempDir, "feedback-images"),
			MaxAvatarBytes:        1 << 20,
			MaxFeedbackImageBytes: 5 << 20,
			MaxFeedbackImages:     3,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	feedbackService := feedback.NewService(
		feedbackStore,
		cfg.Storage.FeedbackDir,
		cfg.Storage.MaxFeedbackImageBytes,
		cfg.Storage.MaxFeedbackImages,
	)
	httpServer := NewServerWithReadingNewsAndFeedback(
		cfg,
		nil,
		nil,
		authService,
		socialStore,
		accessStore,
		nil,
		nil,
		feedbackService,
	)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	normal := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800138000","password":"password-123","displayName":"普通用户","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小布同学"}`,
		"",
		http.StatusCreated,
	)
	admin := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13900139000","password":"password-123","displayName":"管理员","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小管"}`,
		"",
		http.StatusCreated,
	)
	if _, err := userStore.UpdateRoleByUsername(context.Background(), admin.User.Username, roles.Admin); err != nil {
		t.Fatal(err)
	}
	return testServer, normal.AccessToken, admin.AccessToken
}

func performFeedbackRequest(
	t *testing.T,
	server *httptest.Server,
	method string,
	path string,
	body io.Reader,
	token string,
	contentType string,
) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, server.URL+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func feedbackMultipart(t *testing.T, description string, images [][]byte) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("description", description); err != nil {
		t.Fatal(err)
	}
	for index, imageBytes := range images {
		part, err := writer.CreateFormFile("images", fmt.Sprintf("image-%d.png", index))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(imageBytes); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body, writer.FormDataContentType()
}

func featureFeedbackMultipart(
	t *testing.T,
	title string,
	category string,
	description string,
	images [][]byte,
) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("kind", "feature_request"); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("title", title); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("category", category); err != nil {
		t.Fatal(err)
	}
	if err := writer.WriteField("description", description); err != nil {
		t.Fatal(err)
	}
	for index, imageBytes := range images {
		part, err := writer.CreateFormFile("images", fmt.Sprintf("design-%d.png", index))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(imageBytes); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body, writer.FormDataContentType()
}

func feedbackPNGBytes(t *testing.T) []byte {
	t.Helper()
	buffer := &bytes.Buffer{}
	if err := png.Encode(buffer, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func decodeFirstFeedbackImagePath(t *testing.T, body []byte) string {
	t.Helper()
	var page struct {
		Items []struct {
			Images []struct {
				Path string `json:"path"`
			} `json:"images"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) == 0 || len(page.Items[0].Images) == 0 {
		t.Fatal("feedback image missing")
	}
	return page.Items[0].Images[0].Path
}

func feedbackIDFromBody(t *testing.T, body []byte) string {
	t.Helper()
	var page struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) == 0 {
		t.Fatal("feedback item missing")
	}
	return page.Items[0].ID
}
