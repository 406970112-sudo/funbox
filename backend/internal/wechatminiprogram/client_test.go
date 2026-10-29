package wechatminiprogram

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestClientGeneratesCodeAndCachesAccessToken(t *testing.T) {
	var tokenCalls atomic.Int32
	var codeCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s", r.Method)
		}
		switch r.URL.Path {
		case "/cgi-bin/stable_token":
			tokenCalls.Add(1)
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			if payload["appid"] != "app-id" || payload["secret"] != "app-secret" {
				t.Fatalf("stable token payload = %#v", payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "token-1", "expires_in": 7200})
		case "/wxa/getwxacodeunlimit":
			codeCalls.Add(1)
			if r.URL.Query().Get("access_token") != "token-1" {
				t.Fatalf("access token = %q", r.URL.Query().Get("access_token"))
			}
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			if payload["scene"] != "scene-1" || payload["page"] != "pages/score/room/index" {
				t.Fatalf("code payload = %#v", payload)
			}
			if payload["width"] != float64(430) || payload["env_version"] != "release" {
				t.Fatalf("code options = %#v", payload)
			}
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte{0x89, 0x50, 0x4e, 0x47})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(Config{
		AppID: "app-id", AppSecret: "app-secret", BaseURL: server.URL,
		Page: "pages/score/room/index", EnvVersion: "release", Width: 430,
		CheckPath: true, RequestTimeout: time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		data, mediaType, width, err := client.Generate(context.Background(), "scene-1")
		if err != nil {
			t.Fatal(err)
		}
		if len(data) != 4 || mediaType != "image/png" || width != 430 {
			t.Fatalf("data=%v mediaType=%q width=%d", data, mediaType, width)
		}
	}
	if tokenCalls.Load() != 1 || codeCalls.Load() != 2 {
		t.Fatalf("tokenCalls=%d codeCalls=%d", tokenCalls.Load(), codeCalls.Load())
	}
}

func TestClientReturnsWechatAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cgi-bin/stable_token":
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "token-1", "expires_in": 7200})
		case "/wxa/getwxacodeunlimit":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"errcode": 41030, "errmsg": "invalid page"})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	client, err := NewClient(Config{
		AppID: "app-id", AppSecret: "app-secret", BaseURL: server.URL,
		Page: "pages/score/room/index", EnvVersion: "release", Width: 430,
		CheckPath: true, RequestTimeout: time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, _, err = client.Generate(context.Background(), "scene-1")
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != 41030 {
		t.Fatalf("error = %v", err)
	}
}
