package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/moments"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestMomentsHTTPFlow(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "moments-http.db")
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
	momentsStore, err := moments.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open moments store: %v", err)
	}
	t.Cleanup(func() { _ = momentsStore.Close() })
	momentsService := moments.NewService(momentsStore, filepath.Join(tempDir, "moment-media"), 5<<20, 9)

	cfg := config.Config{
		Auth: config.AuthConfig{TokenTTL: time.Hour},
		Server: config.ServerConfig{
			Host:         "127.0.0.1",
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 5 * time.Second,
		},
		Security: config.SecurityConfig{
			MaxRequestBodyBytes: 64 << 20,
			RateLimitMax:        100,
			RateLimitWindow:     time.Minute,
		},
		Storage: config.StorageConfig{
			MomentDir:           filepath.Join(tempDir, "moment-media"),
			MaxMomentImageBytes: 5 << 20,
			MaxMomentImages:     9,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("s", 32)), time.Hour)
	httpServer := NewServerWithMoments(
		cfg,
		nil,
		nil,
		authService,
		socialStore,
		nil,
		nil,
		nil,
		nil,
		nil,
		nil,
		nil,
		nil,
		momentsService,
		nil,
	)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	alice := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800138000","password":"password-123","displayName":"Alice","securityQuestion":"你小时候最喜欢的书是什么？","securityAnswer":"海底两万里"}`,
		"",
		http.StatusCreated,
	)
	bob := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13900139000","password":"password-456","displayName":"Bob","securityQuestion":"你的第一个昵称是什么？","securityAnswer":"小布同学"}`,
		"",
		http.StatusCreated,
	)
	makeMomentsTestFriends(t, socialStore, alice.User.ID, bob.User.ID)

	createdMoment := postMultipartMoment(
		t,
		testServer.Client(),
		testServer.URL+"/api/v1/moments",
		alice.AccessToken,
		"今天记录第一条真实动态",
		"friends",
	)["moment"]
	if createdMoment.Author.ID != alice.User.ID || createdMoment.Body == "" {
		t.Fatalf("created moment = %+v", createdMoment)
	}

	feed := requestJSON[struct {
		Moments    []momentResponse `json:"moments"`
		NextCursor string           `json:"nextCursor"`
	}](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/moments/feed",
		"",
		bob.AccessToken,
		http.StatusOK,
	)
	if len(feed.Moments) != 1 || feed.Moments[0].ID != createdMoment.ID {
		t.Fatalf("bob feed = %+v", feed.Moments)
	}

	liked := requestJSON[map[string]bool](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/moments/"+createdMoment.ID+"/like",
		"{}",
		bob.AccessToken,
		http.StatusOK,
	)
	if !liked["liked"] {
		t.Fatalf("like response = %+v", liked)
	}
	comment := requestJSON[map[string]momentCommentResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/moments/"+createdMoment.ID+"/comments",
		`{"body":"厉害，一起玩"}`,
		bob.AccessToken,
		http.StatusCreated,
	)["comment"]
	if comment.Author.ID != bob.User.ID || comment.Body == "" {
		t.Fatalf("created comment = %+v", comment)
	}

	notifications := requestJSON[struct {
		Items       []momentNotificationResponse `json:"items"`
		UnreadCount int                          `json:"unreadCount"`
	}](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/moments/notifications",
		"",
		alice.AccessToken,
		http.StatusOK,
	)
	if notifications.UnreadCount != 2 || len(notifications.Items) != 2 {
		t.Fatalf("notifications = %+v", notifications)
	}

	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/moments/notifications/read",
		`{"momentId":"`+createdMoment.ID+`"}`,
		alice.AccessToken,
		http.StatusOK,
	)
	unread := requestJSON[map[string]int](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/moments/unread-count",
		"",
		alice.AccessToken,
		http.StatusOK,
	)
	if unread["unreadCount"] != 0 {
		t.Fatalf("unread count after read = %+v", unread)
	}

	requestJSON[map[string]momentResponse](
		t,
		testServer.Client(),
		http.MethodPatch,
		testServer.URL+"/api/v1/moments/"+createdMoment.ID,
		`{"visibility":"self"}`,
		alice.AccessToken,
		http.StatusOK,
	)
	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/moments/"+createdMoment.ID,
		"",
		bob.AccessToken,
		http.StatusForbidden,
	)

	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodDelete,
		testServer.URL+"/api/v1/moments/"+createdMoment.ID,
		"",
		alice.AccessToken,
		http.StatusOK,
	)
	feed = requestJSON[struct {
		Moments    []momentResponse `json:"moments"`
		NextCursor string           `json:"nextCursor"`
	}](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/moments/feed",
		"",
		bob.AccessToken,
		http.StatusOK,
	)
	if len(feed.Moments) != 0 {
		t.Fatalf("feed after delete = %+v", feed.Moments)
	}
}

func makeMomentsTestFriends(t *testing.T, store *social.Store, senderID string, recipientID string) {
	t.Helper()
	request, err := store.CreateFriendRequest(context.Background(), senderID, recipientID)
	if err != nil {
		t.Fatalf("create friend request: %v", err)
	}
	if _, _, err := store.RespondToFriendRequest(context.Background(), request.ID, recipientID, true); err != nil {
		t.Fatalf("accept friend request: %v", err)
	}
}

func postMultipartMoment(
	t *testing.T,
	client *http.Client,
	url string,
	token string,
	body string,
	visibility string,
) map[string]momentResponse {
	t.Helper()
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	_ = writer.WriteField("body", body)
	_ = writer.WriteField("visibility", visibility)
	imageBytes, err := base64.StdEncoding.DecodeString(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	)
	if err != nil {
		t.Fatalf("decode png: %v", err)
	}
	part, err := writer.CreateFormFile("images", "moment.png")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(imageBytes); err != nil {
		t.Fatalf("write form image: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	request, err := http.NewRequest(http.MethodPost, url, &buffer)
	if err != nil {
		t.Fatalf("create multipart request: %v", err)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("perform multipart request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("multipart status = %d, want %d", response.StatusCode, http.StatusCreated)
	}
	var payload map[string]momentResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode multipart response: %v", err)
	}
	return payload
}
