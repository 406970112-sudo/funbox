package wechatminiprogram

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCode2Session(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		ok         bool
	}{
		{"valid", `{"openid":"open-1","unionid":"union-1","session_key":"private-session"}`, 200, true},
		{"invalid code", `{"errcode":40029,"errmsg":"invalid code"}`, 200, false},
		{"missing identity", `{"session_key":"private-session"}`, 200, false},
		{"invalid json", `not json`, 200, false},
		{"http error", `{"openid":"open-1"}`, 500, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				q := r.URL.Query()
				if r.Method != "GET" || r.URL.Path != "/sns/jscode2session" || q.Get("appid") != "test-app" || q.Get("secret") != "private-secret" || q.Get("js_code") != "login-code" || q.Get("grant_type") != "authorization_code" {
					t.Errorf("unexpected exchange request")
				}
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			client, err := NewClient(Config{AppID: "test-app", AppSecret: "private-secret", BaseURL: server.URL, Page: "pages/score/room/index"})
			if err != nil {
				t.Fatal(err)
			}
			identity, err := client.Code2Session(context.Background(), "login-code")
			if tc.ok {
				if err != nil || identity.AppID != "test-app" || identity.OpenID != "open-1" || identity.UnionID != "union-1" {
					t.Fatalf("identity=%+v err=%v", identity, err)
				}
			} else if err == nil {
				t.Fatal("accepted failed exchange")
			}
			if err != nil && (strings.Contains(err.Error(), "private-secret") || strings.Contains(err.Error(), "private-session")) {
				t.Fatal("error leaks credentials")
			}
		})
	}
}

func TestCode2SessionRejectsEmptyCodeBeforeNetwork(t *testing.T) {
	client, _ := NewClient(Config{AppID: "test-app", AppSecret: "secret", BaseURL: "http://127.0.0.1:1", Page: "page"})
	if _, err := client.Code2Session(context.Background(), " "); err == nil {
		t.Fatal("accepted empty code")
	}
}
