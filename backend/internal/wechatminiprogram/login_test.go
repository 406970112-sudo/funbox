package wechatminiprogram

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type loginTestTransport func(*http.Request) (*http.Response, error)

func (transport loginTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestCode2SessionLogsTransportTimeoutWithoutCredentials(t *testing.T) {
	client, err := NewClient(Config{AppID: "test-app", AppSecret: "private-secret", Page: "page"})
	if err != nil {
		t.Fatal(err)
	}
	client.httpClient.Transport = loginTestTransport(func(*http.Request) (*http.Response, error) {
		return nil, context.DeadlineExceeded
	})
	var output bytes.Buffer
	originalOutput := log.Writer()
	log.SetOutput(&output)
	t.Cleanup(func() { log.SetOutput(originalOutput) })

	if _, err := client.Code2Session(context.Background(), "private-login-code"); err == nil {
		t.Fatal("accepted timed-out exchange")
	}
	entry := output.String()
	if !strings.Contains(entry, "reason=transport_error timeout=true") {
		t.Fatalf("missing transport timeout diagnosis: %q", entry)
	}
	if strings.Contains(entry, "private-secret") || strings.Contains(entry, "private-login-code") {
		t.Fatal("diagnostic leaks credentials")
	}
}

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
