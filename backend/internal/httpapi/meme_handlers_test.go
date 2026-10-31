package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/meme"
	"my-first-expo-app/backend/internal/user"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMemeGuestRoutesAndValidation(t *testing.T) {
	s, e := meme.OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	ctx := context.Background()
	s.Import(ctx, []meme.SourceCategory{{Slug: "cats", Title: "猫"}}, []meme.SourceImage{{Src: fmt.Sprintf("media/%064x.png", 1), Thumb: fmt.Sprintf("thumbs/%064x.webp", 1), Label: "开心猫", Category: "cats"}})
	api := &Server{cfg: config.Config{Security: config.SecurityConfig{MaxRequestBodyBytes: 1 << 20}}, memeService: meme.NewService(s, t.TempDir()), rateLimiter: NewRateLimiter(time.Minute, 100)}
	mux := http.NewServeMux()
	registerMemeRoutes(mux, api)
	for _, test := range []struct {
		path string
		code int
	}{{"/api/v1/memes", 200}, {"/api/v1/memes/categories", 200}, {"/api/v1/memes/rankings", 200}, {"/api/v1/memes?cursor=bad", 400}, {"/api/v1/memes?animated=oops", 400}, {"/api/v1/memes?limit=no", 400}, {"/api/v1/memes/missing", 404}} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", test.path, nil))
		if w.Code != test.code {
			t.Fatalf("%s: %d %s", test.path, w.Code, w.Body.String())
		}
		if test.path == "/api/v1/memes" {
			var p meme.Page
			json.Unmarshal(w.Body.Bytes(), &p)
			if p.Total != 1 || !strings.HasPrefix(p.Items[0].URL, "http://example.com/api/v1/") {
				t.Fatal(w.Body.String())
			}
		}
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/memes/events", strings.NewReader(`{"imageId":"x","type":"favorite","eventId":"e","anonymousId":"a"}`)))
	if w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
}
func TestMemeFavoritesRequireJWTAndAreIdempotent(t *testing.T) {
	ctx := context.Background()
	store, e := meme.OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	users, e := user.OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer users.Close()
	service := auth.NewService(users, []byte(strings.Repeat("k", 32)), time.Hour)
	session, e := service.Register(ctx, "13800138001", "1", "藏图用户", "问题", "答案")
	if e != nil {
		t.Fatal(e)
	}
	id := fmt.Sprintf("%064x", 1)
	if e = store.Import(ctx, []meme.SourceCategory{{Slug: "cats", Title: "猫"}}, []meme.SourceImage{{Src: "media/" + id + ".png", Thumb: "thumbs/" + id + ".webp", Category: "cats", Label: "开心"}}); e != nil {
		t.Fatal(e)
	}
	api := &Server{cfg: config.Config{Security: config.SecurityConfig{MaxRequestBodyBytes: 1 << 20}}, memeService: meme.NewService(store, t.TempDir()), authService: service, rateLimiter: NewRateLimiter(time.Minute, 100)}
	mux := http.NewServeMux()
	registerMemeRoutes(mux, api)
	call := func(method, path, token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		return w
	}
	if w := call("PUT", "/api/v1/memes/"+id+"/favorite", ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	for i := 0; i < 2; i++ {
		if w := call("PUT", "/api/v1/memes/"+id+"/favorite", session.AccessToken); w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	w := call("GET", "/api/v1/memes/favorites", session.AccessToken)
	var p meme.Page
	if e = json.Unmarshal(w.Body.Bytes(), &p); e != nil || p.Total != 1 || !p.Items[0].Favorite {
		t.Fatal(w.Code, w.Body.String(), e)
	}
	if w = call("GET", "/api/v1/admin/memes/status", session.AccessToken); w.Code != 403 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = call("DELETE", "/api/v1/memes/"+id+"/favorite", session.AccessToken)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	p, _ = store.List(ctx, meme.Query{Favorites: true}, session.User.ID)
	if p.Total != 0 {
		t.Fatal(p)
	}
}
func TestMemeEventAndMediaRequestBudgets(t *testing.T) {
	store, e := meme.OpenStore(":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer store.Close()
	id := fmt.Sprintf("%064x", 1)
	if e = store.Import(context.Background(), []meme.SourceCategory{{Slug: "cats", Title: "猫"}}, []meme.SourceImage{{Src: "media/" + id + ".png", Thumb: "thumbs/" + id + ".webp", Category: "cats"}}); e != nil {
		t.Fatal(e)
	}
	api := &Server{cfg: config.Config{Security: config.SecurityConfig{MaxRequestBodyBytes: 1 << 20}}, memeService: meme.NewService(store, t.TempDir()), rateLimiter: NewRateLimiter(time.Minute, 2)}
	mux := http.NewServeMux()
	registerMemeRoutes(mux, api)
	for _, path := range []string{"/api/v1/memes/events", "/api/v1/meme-media/missing/original"} {
		method := "GET"
		if strings.HasSuffix(path, "events") {
			method = "POST"
		}
		for i := 0; i < 3; i++ {
			w := httptest.NewRecorder()
			req := httptest.NewRequest(method, path, strings.NewReader(fmt.Sprintf(`{"imageId":%q,"type":"view","eventId":"event-%d","anonymousId":"actor-%d"}`, id, i, i)))
			mux.ServeHTTP(w, req)
			if i < 2 && method == "POST" && w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			if i < 2 && w.Code == 429 {
				t.Fatalf("early rejection %s", path)
			}
			if i == 2 && w.Code != 429 {
				t.Fatalf("unbounded %s: %d", path, w.Code)
			}
		}
	}
}
