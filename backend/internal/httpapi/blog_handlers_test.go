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

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/blog"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestBlogHTTPAnonymousPublicFeed(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "blog-http.db")
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
	blogStore, err := blog.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open blog store: %v", err)
	}
	t.Cleanup(func() { _ = blogStore.Close() })
	blogService := blog.NewService(blogStore, filepath.Join(tempDir, "blog-media"), 2<<20)

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
			BlogDir:           filepath.Join(tempDir, "blog-media"),
			MaxBlogCoverBytes: 2 << 20,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("s", 32)), time.Hour)
	httpServer := NewServerWithBlog(
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
		nil,
		nil,
		nil,
		nil,
		nil,
		blogService,
	)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	alice := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800138000","password":"password-123","displayName":"Alice","securityQuestion":"question","securityAnswer":"answer"}`,
		"",
		http.StatusCreated,
	)

	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	_ = writer.WriteField("title", "公开文章")
	_ = writer.WriteField("summary", "摘要")
	_ = writer.WriteField("body", "真实正文内容")
	_ = writer.WriteField("visibility", "public")
	_ = writer.Close()
	request, requestErr := http.NewRequest(
		http.MethodPost,
		testServer.URL+"/api/v1/blog/posts",
		&form,
	)
	if requestErr != nil {
		t.Fatalf("create blog post request: %v", requestErr)
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+alice.AccessToken)
	response, requestErr := testServer.Client().Do(request)
	if requestErr != nil {
		t.Fatalf("perform blog post request: %v", requestErr)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		body := new(bytes.Buffer)
		_, _ = body.ReadFrom(response.Body)
		t.Fatalf("status = %d, want 201, body = %s", response.StatusCode, body.String())
	}
	var created struct {
		Post blogPostResponse `json:"post"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatalf("decode created post: %v", err)
	}
	if created.Post.ID == "" || created.Post.WordCount == 0 {
		t.Fatalf("created post = %+v", created.Post)
	}

	feed := requestJSON[struct {
		Posts []blogPostResponse `json:"posts"`
	}](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/blog/feed?tab=public",
		"",
		"",
		http.StatusOK,
	)
	if len(feed.Posts) != 1 || feed.Posts[0].ID != created.Post.ID {
		t.Fatalf("anonymous public feed = %+v", feed.Posts)
	}

	if _, err := blogStore.Like(context.Background(), alice.User.ID, created.Post.ID); err != nil {
		t.Fatalf("like post: %v", err)
	}
	detail := requestJSON[struct {
		Post blogPostResponse `json:"post"`
	}](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/blog/posts/"+created.Post.ID,
		"",
		alice.AccessToken,
		http.StatusOK,
	)
	if detail.Post.LikeCount != 1 || !detail.Post.LikedByMe {
		t.Fatalf("detail = %+v", detail.Post)
	}
}
