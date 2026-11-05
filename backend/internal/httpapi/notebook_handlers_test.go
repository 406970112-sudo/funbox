package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
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

type notebookBookResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	NoteCount int    `json:"noteCount"`
}

type notebookMediaResponse struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	ContentType string `json:"contentType"`
	URL         string `json:"url"`
	ByteSize    int64  `json:"byteSize"`
}

type notebookNoteResponse struct {
	ID        string                  `json:"id"`
	BookID    string                  `json:"bookId"`
	BookName  string                  `json:"bookName"`
	Title     string                  `json:"title"`
	Body      string                  `json:"body"`
	Tags      []string                `json:"tags"`
	Pinned    bool                    `json:"pinned"`
	Favorite  bool                    `json:"favorite"`
	Encrypted bool                    `json:"encrypted"`
	Locked    bool                    `json:"locked"`
	Media     []notebookMediaResponse `json:"media"`
	CreatedAt time.Time               `json:"createdAt"`
	UpdatedAt time.Time               `json:"updatedAt"`
}

func TestNotebookHTTPFlow(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "app.db")
	users, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open users: %v", err)
	}
	t.Cleanup(func() { _ = users.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open social: %v", err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	cfg := config.Config{
		Database: config.DatabaseConfig{Path: databasePath},
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server: config.ServerConfig{
			Host:         "127.0.0.1",
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 5 * time.Second,
		},
		Security: config.SecurityConfig{
			MaxRequestBodyBytes: 2 << 20,
			RateLimitMax:        200,
			RateLimitWindow:     time.Minute,
		},
		Storage: config.StorageConfig{
			AvatarDir:      filepath.Join(tempDir, "avatars"),
			MaxAvatarBytes: 1 << 20,
		},
	}
	authService := auth.NewService(users, []byte(strings.Repeat("k", 32)), time.Hour)
	server := NewServer(cfg, nil, nil, authService, socialStore, nil)
	testServer := httptest.NewServer(server.Handler)
	t.Cleanup(testServer.Close)

	unauthorized, err := http.Get(testServer.URL + "/api/v1/notebook/books")
	if err != nil {
		t.Fatalf("unauthorized request: %v", err)
	}
	unauthorized.Body.Close()
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d", unauthorized.StatusCode)
	}

	session := requestJSON[sessionResponse](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register",
		`{"username":"13700137011","password":"password-123","displayName":"笔记本用户","securityQuestion":"昵称？","securityAnswer":"小记"}`,
		"", http.StatusCreated,
	)
	token := session.AccessToken
	books := requestJSON[map[string][]notebookBookResponse](
		t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/notebook/books",
		"", token, http.StatusOK,
	)
	if len(books["books"]) != 3 || books["books"][0].Name != "工作" || books["books"][1].Name != "生活" || books["books"][2].Name != "灵感" {
		t.Fatalf("books = %+v", books["books"])
	}
	bookID := books["books"][1].ID

	created := requestJSON[map[string]notebookNoteResponse](
		t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/notebook/notes",
		`{"bookId":"`+bookID+`","title":"杭州两日散步路线","body":"西湖日落和南山路梧桐","checklist":[{"text":"订民宿","done":false}],"tags":["旅行","周末"],"pinned":true}`,
		token, http.StatusCreated,
	)
	note := created["note"]
	if note.Title != "杭州两日散步路线" || !note.Pinned || note.BookName != "生活" {
		t.Fatalf("created note = %+v", note)
	}

	search := requestJSON[map[string]any](
		t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/notebook/notes?q=%E8%A5%BF%E6%B9%96",
		"", token, http.StatusOK,
	)
	notes, ok := search["notes"].([]any)
	if !ok || len(notes) != 1 {
		t.Fatalf("search response = %+v", search)
	}

	updated := requestJSON[map[string]notebookNoteResponse](
		t, testServer.Client(), http.MethodPatch, testServer.URL+"/api/v1/notebook/notes/"+note.ID,
		`{"favorite":true}`,
		token, http.StatusOK,
	)
	if !updated["note"].Favorite {
		t.Fatalf("favorite update = %+v", updated["note"])
	}

	pngData, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatalf("decode png: %v", err)
	}
	uploaded := uploadNotebookMedia(t, testServer, token, note.ID, "image", "dot.png", pngData)
	if uploaded.Kind != "image" || uploaded.ContentType != "image/png" || uploaded.URL == "" {
		t.Fatalf("uploaded media = %+v", uploaded)
	}
	mediaRequest, _ := http.NewRequest(http.MethodGet, testServer.URL+uploaded.URL, nil)
	mediaRequest.Header.Set("Authorization", "Bearer "+token)
	mediaResponse, err := testServer.Client().Do(mediaRequest)
	if err != nil {
		t.Fatalf("get media: %v", err)
	}
	mediaBody, _ := io.ReadAll(mediaResponse.Body)
	mediaResponse.Body.Close()
	if mediaResponse.StatusCode != http.StatusOK || !bytes.Equal(mediaBody, pngData) {
		t.Fatalf("media status=%d body=%d bytes", mediaResponse.StatusCode, len(mediaBody))
	}

	requestJSON[map[string]any](
		t, testServer.Client(), http.MethodDelete, testServer.URL+"/api/v1/notebook/media/"+uploaded.ID,
		"", token, http.StatusOK,
	)
	requestJSON[map[string]any](
		t, testServer.Client(), http.MethodDelete, testServer.URL+"/api/v1/notebook/notes/"+note.ID,
		"", token, http.StatusOK,
	)
	afterDelete := requestJSON[map[string]any](
		t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/notebook/notes?q=%E8%A5%BF%E6%B9%96",
		"", token, http.StatusOK,
	)
	if len(afterDelete["notes"].([]any)) != 0 {
		t.Fatalf("deleted note still listed: %+v", afterDelete)
	}
}

func notebookRequestJSON[T any](
	t *testing.T,
	client *http.Client,
	method string,
	url string,
	body string,
	accessToken string,
	unlockToken string,
	wantStatus int,
) T {
	t.Helper()
	request, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatalf("create notebook request: %v", err)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if accessToken != "" {
		request.Header.Set("Authorization", "Bearer "+accessToken)
	}
	if unlockToken != "" {
		request.Header.Set("X-Notebook-Unlock-Token", unlockToken)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("notebook request: %v", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("read notebook response: %v", err)
	}
	if response.StatusCode != wantStatus {
		t.Fatalf("notebook status=%d want=%d body=%s", response.StatusCode, wantStatus, string(raw))
	}
	var payload T
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			t.Fatalf("decode notebook response: %v body=%s", err, string(raw))
		}
	}
	return payload
}

func TestNotebookEncryptedHTTPFlow(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "app.db")
	users, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open users: %v", err)
	}
	t.Cleanup(func() { _ = users.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open social: %v", err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	cfg := config.Config{
		Database: config.DatabaseConfig{Path: databasePath},
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server:   config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 2 << 20, RateLimitMax: 200, RateLimitWindow: time.Minute},
	}
	authService := auth.NewService(users, []byte(strings.Repeat("k", 32)), time.Hour)
	server := NewServer(cfg, nil, nil, authService, socialStore, nil)
	testServer := httptest.NewServer(server.Handler)
	t.Cleanup(testServer.Close)
	session := requestJSON[sessionResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register",
		`{"username":"13700137013","password":"password-123","displayName":"加密笔记用户","securityQuestion":"昵称？","securityAnswer":"小记"}`,
		"", http.StatusCreated)
	token := session.AccessToken
	books := requestJSON[map[string][]notebookBookResponse](t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/notebook/books", "", token, http.StatusOK)
	bookID := books["books"][0].ID

	requestJSON[map[string]any](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/notebook/security/password",
		`{"action":"set","new":"secret-123"}`, token, http.StatusOK)

	missingToken := notebookRequestJSON[map[string]string](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/notebook/notes",
		`{"bookId":"`+bookID+`","title":"加密标题","body":"加密正文","encrypted":true}`,
		token, "", http.StatusForbidden)
	if missingToken["error"] != "notebook_note_locked" {
		t.Fatalf("missing token error = %+v", missingToken)
	}
	wrongPassword := notebookRequestJSON[map[string]string](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/notebook/security/unlock", `{"password":"not-the-password"}`,
		token, "", http.StatusForbidden)
	if wrongPassword["error"] != "notebook_note_password_mismatch" {
		t.Fatalf("wrong password error = %+v", wrongPassword)
	}
	unlocked := requestJSON[struct {
		UnlockToken      string `json:"unlockToken"`
		ExpiresInSeconds int    `json:"expiresInSeconds"`
	}](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/notebook/security/unlock",
		`{"password":"secret-123"}`, token, http.StatusOK)
	if unlocked.UnlockToken == "" || unlocked.ExpiresInSeconds != 1800 {
		t.Fatalf("unlock response = %+v", unlocked)
	}

	created := notebookRequestJSON[map[string]notebookNoteResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/notebook/notes",
		`{"bookId":"`+bookID+`","title":"加密标题","body":"加密正文","tags":["私密"],"encrypted":true}`,
		token, unlocked.UnlockToken, http.StatusCreated)
	note := created["note"]
	if !note.Encrypted || note.Locked || note.Title != "加密标题" || note.Body != "加密正文" {
		t.Fatalf("created encrypted note = %+v", note)
	}

	listed := requestJSON[struct {
		Notes []notebookNoteResponse `json:"notes"`
	}](t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/notebook/notes?limit=100", "", token, http.StatusOK)
	if len(listed.Notes) != 1 || !listed.Notes[0].Locked || listed.Notes[0].Title != "" || listed.Notes[0].Body != "" {
		t.Fatalf("locked list = %+v", listed.Notes)
	}
	searched := requestJSON[struct {
		Notes []notebookNoteResponse `json:"notes"`
	}](t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/notebook/notes?q=%E5%8A%A0%E5%AF%86", "", token, http.StatusOK)
	if len(searched.Notes) != 0 {
		t.Fatalf("encrypted note appeared in search: %+v", searched.Notes)
	}
	locked := requestJSON[map[string]notebookNoteResponse](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/notebook/notes/"+note.ID, "", token, http.StatusOK)
	if !locked["note"].Locked || locked["note"].Title != "" || len(locked["note"].Media) != 0 {
		t.Fatalf("locked detail = %+v", locked["note"])
	}
	detail := notebookRequestJSON[map[string]notebookNoteResponse](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/notebook/notes/"+note.ID, "", token, unlocked.UnlockToken, http.StatusOK)
	if detail["note"].Locked || detail["note"].Title != "加密标题" {
		t.Fatalf("unlocked detail = %+v", detail["note"])
	}

	pngData, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatalf("decode png: %v", err)
	}
	uploaded := uploadNotebookMedia(t, testServer, token, note.ID, "image", "secret.png", pngData, unlocked.UnlockToken)
	mediaURL := testServer.URL + uploaded.URL
	mediaRequest, _ := http.NewRequest(http.MethodGet, mediaURL, nil)
	mediaRequest.Header.Set("Authorization", "Bearer "+token)
	mediaResponse, err := testServer.Client().Do(mediaRequest)
	if err != nil {
		t.Fatalf("locked media request: %v", err)
	}
	mediaResponse.Body.Close()
	if mediaResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("locked media status = %d", mediaResponse.StatusCode)
	}
	mediaRequest, _ = http.NewRequest(http.MethodGet, mediaURL, nil)
	mediaRequest.Header.Set("Authorization", "Bearer "+token)
	mediaRequest.Header.Set("X-Notebook-Unlock-Token", unlocked.UnlockToken)
	mediaResponse, err = testServer.Client().Do(mediaRequest)
	if err != nil {
		t.Fatalf("unlocked media request: %v", err)
	}
	mediaBody, _ := io.ReadAll(mediaResponse.Body)
	mediaResponse.Body.Close()
	if mediaResponse.StatusCode != http.StatusOK || !bytes.Equal(mediaBody, pngData) {
		t.Fatalf("unlocked media status=%d bytes=%d", mediaResponse.StatusCode, len(mediaBody))
	}

	notebookRequestJSON[map[string]any](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/notebook/security/lock", "", token, unlocked.UnlockToken, http.StatusOK)
	lockedAfter := notebookRequestJSON[map[string]notebookNoteResponse](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/notebook/notes/"+note.ID, "", token, unlocked.UnlockToken, http.StatusOK)
	if !lockedAfter["note"].Locked {
		t.Fatalf("note remained unlocked after lock: %+v", lockedAfter["note"])
	}
	notebookRequestJSON[map[string]any](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/notebook/security/reset", `{"confirm":"DELETE"}`, token, "", http.StatusOK)
	notebookRequestJSON[map[string]string](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/notebook/notes/"+note.ID, "", token, "", http.StatusNotFound)
}

func TestNotebookBooksRejectDeletingNonEmptyBook(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "app.db")
	users, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open users: %v", err)
	}
	t.Cleanup(func() { _ = users.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open social: %v", err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	cfg := config.Config{
		Database: config.DatabaseConfig{Path: databasePath},
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server:   config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 1 << 20, RateLimitMax: 200, RateLimitWindow: time.Minute},
	}
	authService := auth.NewService(users, []byte(strings.Repeat("k", 32)), time.Hour)
	server := NewServer(cfg, nil, nil, authService, socialStore, nil)
	testServer := httptest.NewServer(server.Handler)
	t.Cleanup(testServer.Close)
	session := requestJSON[sessionResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register",
		`{"username":"13700137012","password":"password-123","displayName":"笔记本用户","securityQuestion":"昵称？","securityAnswer":"小记"}`,
		"", http.StatusCreated)
	books := requestJSON[map[string][]notebookBookResponse](t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/notebook/books", "", session.AccessToken, http.StatusOK)
	bookID := books["books"][0].ID
	requestJSON[map[string]notebookNoteResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/notebook/notes",
		`{"bookId":"`+bookID+`","title":"工作记录"}`, session.AccessToken, http.StatusCreated)
	request := func() *http.Response {
		req, _ := http.NewRequest(http.MethodDelete, testServer.URL+"/api/v1/notebook/books/"+bookID, nil)
		req.Header.Set("Authorization", "Bearer "+session.AccessToken)
		resp, err := testServer.Client().Do(req)
		if err != nil {
			t.Fatalf("delete book request: %v", err)
		}
		return resp
	}
	resp := request()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("delete non-empty book status = %d", resp.StatusCode)
	}
}

func uploadNotebookMedia(t *testing.T, server *httptest.Server, token, noteID, kind, filename string, body []byte, unlockToken ...string) notebookMediaResponse {
	t.Helper()
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	if err := writer.WriteField("kind", kind); err != nil {
		t.Fatalf("write kind: %v", err)
	}
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create file part: %v", err)
	}
	if _, err := part.Write(body); err != nil {
		t.Fatalf("write file part: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	request, err := http.NewRequest(http.MethodPost, server.URL+"/api/v1/notebook/notes/"+noteID+"/media", &buffer)
	if err != nil {
		t.Fatalf("create upload request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if len(unlockToken) > 0 && unlockToken[0] != "" {
		request.Header.Set("X-Notebook-Unlock-Token", unlockToken[0])
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatalf("upload media: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		raw, _ := io.ReadAll(response.Body)
		t.Fatalf("upload status=%d body=%s", response.StatusCode, string(raw))
	}
	var payload map[string]notebookMediaResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode upload: %v", err)
	}
	return payload["media"]
}

var _ = context.Background
