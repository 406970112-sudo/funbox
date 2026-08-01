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
	"my-first-expo-app/backend/internal/reading"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestReadingHTTPFlow(t *testing.T) {
	testServer, readingService, token := newReadingHTTPTestServer(t)

	booksPayload := requestJSON[map[string][]reading.Book](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/reading/books", "", "", http.StatusOK)
	if len(booksPayload["books"]) < 3 {
		t.Fatalf("books = %+v", booksPayload)
	}
	book := booksPayload["books"][0]

	detail := requestJSON[map[string]reading.Book](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/reading/books/"+book.ID, "", token, http.StatusOK)
	if detail["book"].Title == "" {
		t.Fatalf("book detail = %+v", detail)
	}
	chaptersPayload := requestJSON[map[string][]reading.Chapter](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/reading/books/"+book.ID+"/chapters", "", "", http.StatusOK)
	if len(chaptersPayload["chapters"]) < 3 {
		t.Fatalf("chapters = %+v", chaptersPayload)
	}
	chapter := chaptersPayload["chapters"][0]
	content := requestJSON[reading.ChapterContent](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/reading/books/"+book.ID+"/chapters/"+chapter.ID, "", token, http.StatusOK)
	if content.Content == "" || content.NextID == "" {
		t.Fatalf("chapter content = %+v", content)
	}

	requestJSON[map[string]any](t, testServer.Client(), http.MethodPut,
		testServer.URL+"/api/v1/reading/bookshelf/"+book.ID, "", "", http.StatusUnauthorized)
	requestJSON[map[string]any](t, testServer.Client(), http.MethodPut,
		testServer.URL+"/api/v1/reading/bookshelf/"+book.ID, "", token, http.StatusOK)
	detail = requestJSON[map[string]reading.Book](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/reading/books/"+book.ID, "", token, http.StatusOK)
	if !detail["book"].InBookshelf {
		t.Fatalf("book detail bookshelf state = %+v", detail["book"])
	}
	requestJSON[map[string]any](t, testServer.Client(), http.MethodPut,
		testServer.URL+"/api/v1/reading/progress/"+book.ID,
		`{"chapterId":"`+chapter.ID+`","chapterProgress":0.37,"updatedAt":"2026-07-31T12:00:00Z"}`, token, http.StatusOK)
	shelf := requestJSON[map[string][]reading.Book](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/reading/bookshelf", "", token, http.StatusOK)
	if len(shelf["books"]) != 1 || shelf["books"][0].Progress == nil || shelf["books"][0].Progress.ChapterProgress != 0.37 {
		t.Fatalf("bookshelf = %+v", shelf)
	}

	bookmark := requestJSON[reading.Bookmark](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/reading/bookmarks",
		`{"bookId":"`+book.ID+`","chapterId":"`+chapter.ID+`","position":0.37,"note":"回看这里"}`, token, http.StatusCreated)
	if bookmark.ID == "" {
		t.Fatal("bookmark id is empty")
	}
	bookmarks := requestJSON[map[string][]reading.Bookmark](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/reading/bookmarks?bookId="+book.ID, "", token, http.StatusOK)
	if len(bookmarks["bookmarks"]) != 1 {
		t.Fatalf("bookmarks = %+v", bookmarks)
	}
	requestJSON[map[string]any](t, testServer.Client(), http.MethodDelete,
		testServer.URL+"/api/v1/reading/bookmarks/"+bookmark.ID, "", token, http.StatusOK)

	if err := readingService.Store().UpdatePublishStatus(context.Background(), book.ID, reading.StatusHidden, "admin", time.Now().UTC()); err != nil {
		t.Fatalf("hide book: %v", err)
	}
	requestJSON[map[string]any](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/reading/books/"+book.ID+"/chapters/"+chapter.ID, "", token, http.StatusGone)
}

func TestReadingBookmarksAreIsolatedPerUser(t *testing.T) {
	testServer, _, firstToken := newReadingHTTPTestServer(t)
	books := requestJSON[map[string][]reading.Book](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/reading/books", "", "", http.StatusOK)["books"]
	chapters := requestJSON[map[string][]reading.Chapter](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/reading/books/"+books[0].ID+"/chapters", "", "", http.StatusOK)["chapters"]
	bookmark := requestJSON[reading.Bookmark](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/reading/bookmarks", `{"bookId":"`+books[0].ID+`","chapterId":"`+chapters[0].ID+`","position":0.1}`, firstToken, http.StatusCreated)

	second := requestJSON[sessionResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13900139000","password":"password-123","displayName":"第二位读者","securityQuestion":"你喜欢哪本书？","securityAnswer":"山海之间"}`, "", http.StatusCreated)
	requestJSON[map[string]any](t, testServer.Client(), http.MethodDelete,
		testServer.URL+"/api/v1/reading/bookmarks/"+bookmark.ID, "", second.AccessToken, http.StatusNotFound)
}

func newReadingHTTPTestServer(t *testing.T) (*httptest.Server, *reading.Service, string) {
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
	if _, err := readingService.SyncProvider(context.Background(), "full"); err != nil {
		t.Fatalf("sync mock provider: %v", err)
	}

	cfg := config.Config{
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server:   config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 100, RateLimitWindow: time.Minute},
		Storage:  config.StorageConfig{AvatarDir: filepath.Join(tempDir, "avatars"), MaxAvatarBytes: 1 << 20},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("k", 32)), time.Hour)
	httpServer := NewServerWithReadingAndNews(cfg, nil, nil, authService, socialStore, accessStore, nil, readingService)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)
	session := requestJSON[sessionResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"13800138000","password":"password-123","displayName":"阅读用户","securityQuestion":"你喜欢哪本书？","securityAnswer":"星河观测站"}`, "", http.StatusCreated)
	return testServer, readingService, session.AccessToken
}
