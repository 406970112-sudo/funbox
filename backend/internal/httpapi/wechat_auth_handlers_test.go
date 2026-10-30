package httpapi

import (
	"context"
	"encoding/json"
	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/user"
	"my-first-expo-app/backend/internal/wechatminiprogram"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWeChatHTTPLoginAndLegacyBinding(t *testing.T) {
	wxServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("js_code")
		switch code {
		case "invalid":
			w.Write([]byte(`{"errcode":40029,"errmsg":"invalid code"}`))
		case "busy":
			w.Write([]byte(`{"errcode":45011}`))
		default:
			json.NewEncoder(w).Encode(map[string]string{"openid": code, "session_key": "private-session", "unionid": "private-union"})
		}
	}))
	defer wxServer.Close()
	client, err := wechatminiprogram.NewClient(wechatminiprogram.Config{AppID: "test-app", AppSecret: "private-secret", BaseURL: wxServer.URL, Page: "page"})
	if err != nil {
		t.Fatal(err)
	}
	store, err := user.OpenStore(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := auth.NewService(store, []byte(strings.Repeat("k", 32)), time.Hour, client)
	cfg := config.Config{Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 100, RateLimitWindow: time.Minute}}
	api := NewServer(cfg, nil, nil, service, nil, nil)
	server := httptest.NewServer(api.Handler)
	defer server.Close()
	loginURL := server.URL + "/api/v1/auth/wechat/login"
	raw := requestJSON[map[string]any](t, server.Client(), "POST", loginURL, `{"code":"new-wechat"}`, "", 200)
	data, _ := json.Marshal(raw)
	for _, private := range []string{"private-session", "private-secret", "private-union", "new-wechat", "wx_"} {
		if strings.Contains(string(data), private) {
			t.Fatalf("private field leaked: %s", data)
		}
	}
	firstUser := raw["user"].(map[string]any)
	if firstUser["accountType"] != "wechat" || firstUser["username"] != "" || firstUser["wechatBound"] != true {
		t.Fatalf("unexpected user %s", data)
	}
	token := raw["accessToken"].(string)
	current := requestJSON[map[string]authUserResponse](t, server.Client(), "GET", server.URL+"/api/v1/auth/me", "", token, 200)
	second := requestJSON[sessionResponse](t, server.Client(), "POST", loginURL, `{"code":"new-wechat"}`, "", 200)
	if second.User.ID != current["user"].ID {
		t.Fatal("repeated login created new account")
	}
	requestJSON[map[string]any](t, server.Client(), "POST", loginURL, `{"code":" "}`, "", 400)
	requestJSON[map[string]any](t, server.Client(), "POST", loginURL, `{"code":"invalid"}`, "", 401)
	requestJSON[map[string]any](t, server.Client(), "POST", loginURL, `{"code":"busy"}`, "", 429)
	requestJSON[map[string]any](t, server.Client(), "POST", server.URL+"/api/v1/users/me/wechat", `{"code":"legacy-wechat"}`, "", 401)
	old, err := service.Register(context.Background(), "13800138000", "1", "原有昵称", "问题", "答案")
	if err != nil {
		t.Fatal(err)
	}
	bound := requestJSON[map[string]authUserResponse](t, server.Client(), "POST", server.URL+"/api/v1/users/me/wechat", `{"code":"legacy-wechat"}`, old.AccessToken, 200)
	if bound["user"].ID != old.User.ID || bound["user"].DisplayName != "原有昵称" || !bound["user"].WeChatBound {
		t.Fatalf("legacy data lost: %+v", bound)
	}
	oldLogin := requestJSON[sessionResponse](t, server.Client(), "POST", loginURL, `{"code":"legacy-wechat"}`, "", 200)
	if oldLogin.User.ID != old.User.ID {
		t.Fatal("wechat did not sign into old account")
	}
	if _, err := service.Login(context.Background(), "13800138000", "1"); err != nil {
		t.Fatal("password login broken", err)
	}
	requestJSON[map[string]any](t, server.Client(), "POST", server.URL+"/api/v1/users/me/wechat", `{"code":"new-wechat"}`, old.AccessToken, 409)
	// An internal handle and an empty password must never permit password login.
	internal, err := store.GetByID(context.Background(), second.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Login(context.Background(), internal.Username, ""); err == nil {
		t.Fatal("wechat account has password access")
	}
	disabled := auth.NewService(store, []byte(strings.Repeat("k", 32)), time.Hour)
	if _, err := disabled.LoginWeChat(context.Background(), "code"); err != auth.ErrWeChatUnavailable {
		t.Fatalf("disabled login=%v", err)
	}
}
