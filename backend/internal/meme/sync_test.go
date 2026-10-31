package meme

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestSyncPreservesCatalogOnPartialAndMirrorsValidMedia(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	c, a := fixture(1)
	imageBytes := validPNG(t)
	h := sha256.Sum256(imageBytes)
	id := hex.EncodeToString(h[:])
	a[0].Src = "media/" + id + ".png"
	a[0].Thumb = "thumbs/" + id + ".webp"
	broken := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/catalog/index.json":
			json.NewEncoder(w).Encode(map[string]any{"categories": c})
		case "/catalog/search.json":
			if broken {
				w.Write([]byte("[]"))
			} else {
				json.NewEncoder(w).Encode(a)
			}
		default:
			w.Write(imageBytes)
		}
	}))
	defer server.Close()
	svc := NewService(s, t.TempDir())
	svc.base = server.URL + "/"
	if e := svc.Sync(ctx); e != nil {
		t.Fatal(e)
	}
	broken = true
	if e := svc.Sync(ctx); e == nil {
		t.Fatal("partial accepted")
	}
	p, _ := s.List(ctx, Query{}, "")
	if p.Total != 1 {
		t.Fatal(p)
	}
	file, mime, e := svc.Media(ctx, id, "original")
	if e != nil || mime != "image/png" {
		t.Fatal(file, mime, e)
	}
	if _, e = os.Stat(file); e != nil {
		t.Fatal(e)
	}
	s.AdminUpdate(ctx, id, true, nil)
	if _, _, e = svc.Media(ctx, id, "original"); e != ErrNotFound {
		t.Fatal(e)
	}
	for _, bad := range []string{"https://evil.com/x", "media/../secret", "media/%2e%2e/x", "//localhost/x", "media/a?url=x"} {
		if _, e := svc.fetch(ctx, bad, 100); e == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}
func TestSyncStatusSurvivesServiceRestart(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	c, a := fixture(1)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/catalog/index.json" {
			json.NewEncoder(w).Encode(map[string]any{"categories": c})
		} else {
			json.NewEncoder(w).Encode(a)
		}
	}))
	defer up.Close()
	svc := NewService(s, t.TempDir())
	svc.base = up.URL + "/"
	if e := svc.Sync(ctx); e != nil {
		t.Fatal(e)
	}
	again := NewService(s, t.TempDir())
	if again.Status().LastSuccess == "" || again.Status().Images != 1 {
		t.Fatalf("status lost: %+v", again.Status())
	}
}
func TestMediaRejectsTruncatedImageAndRedirect(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	c, a := fixture(1)
	b := validPNG(t)
	b = b[:33]
	h := sha256.Sum256(b)
	id := hex.EncodeToString(h[:])
	a[0].Src = "media/" + id + ".png"
	s.Import(ctx, c, a)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/catalog/index.json" {
			http.Redirect(w, r, "http://127.0.0.1/private", 302)
			return
		}
		w.Write(b)
	}))
	defer up.Close()
	svc := NewService(s, t.TempDir())
	svc.base = up.URL + "/"
	if _, _, e := svc.Media(ctx, id, "original"); e == nil {
		t.Fatal("truncated PNG cached")
	}
	if _, e := svc.fetch(ctx, "catalog/index.json", 1000); e == nil {
		t.Fatal("redirect accepted")
	}
}

func validPNG(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if e := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 1, 1))); e != nil {
		t.Fatal(e)
	}
	return b.Bytes()
}
func TestWorkerCancellationAndShanghaiSyncSlot(t *testing.T) {
	s := newTestStore(t)
	svc := NewService(s, t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan struct{})
	go func() { svc.Run(ctx); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("worker ignored cancellation")
	}
	for _, v := range []struct {
		utc  string
		want string
	}{{"2026-10-30T19:59:59Z", "2026-10-30"}, {"2026-10-30T20:00:00Z", "2026-10-31"}} {
		now, _ := time.Parse(time.RFC3339, v.utc)
		if got := syncSlot(now); got != v.want {
			t.Fatal(got, v.want)
		}
	}
}
func TestMediaFetchConcurrencyIsBounded(t *testing.T) {
	s := newTestStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	c, a := fixture(7)
	if e := s.Import(ctx, c, a); e != nil {
		t.Fatal(e)
	}
	data := validPNG(t)
	entered := make(chan struct{}, 7)
	release := make(chan struct{})
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entered <- struct{}{}
		select {
		case <-release:
		case <-r.Context().Done():
		}
		w.Write(data)
	}))
	defer up.Close()
	defer close(release)
	svc := NewService(s, t.TempDir())
	svc.base = up.URL + "/"
	done := make(chan error, 7)
	for i := 1; i <= 7; i++ {
		go func(id int) { _, _, e := svc.Media(ctx, fmt.Sprintf("%064x", id), "thumbnail"); done <- e }(i)
	}
	for i := 0; i < 6; i++ {
		select {
		case <-entered:
		case <-ctx.Done():
			t.Fatal("expected six concurrent downloads")
		}
	}
	select {
	case <-entered:
		t.Fatal("exceeded six concurrent downloads")
	case <-time.After(30 * time.Millisecond):
	}
	cancel()
	for i := 0; i < 7; i++ {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("download ignored cancellation")
		}
	}
}
