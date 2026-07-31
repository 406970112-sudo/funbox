package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestSocialHTTPFlow(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "social.db")
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

	cfg := config.Config{
		Auth: config.AuthConfig{TokenTTL: time.Hour},
		Server: config.ServerConfig{
			Host:         "127.0.0.1",
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 5 * time.Second,
		},
		Security: config.SecurityConfig{
			MaxRequestBodyBytes: 64 << 10,
			RateLimitMax:        100,
			RateLimitWindow:     time.Minute,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("s", 32)), time.Hour)
	httpServer := NewServer(cfg, nil, nil, authService, socialStore, nil, nil)
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

	search := requestJSON[map[string][]socialUserResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/users/search?q=bob",
		"",
		alice.AccessToken,
		http.StatusOK,
	)
	if len(search["users"]) != 1 || search["users"][0].ID != bob.User.ID {
		t.Fatalf("search users = %+v", search["users"])
	}

	createdRequest := requestJSON[map[string]friendRequestResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/friend-requests",
		`{"userId":"`+bob.User.ID+`"}`,
		alice.AccessToken,
		http.StatusCreated,
	)["request"]
	if createdRequest.Status != "pending" || createdRequest.Sender.ID != alice.User.ID {
		t.Fatalf("created friend request = %+v", createdRequest)
	}

	requests := requestJSON[struct {
		Incoming []friendRequestResponse `json:"incoming"`
		Outgoing []friendRequestResponse `json:"outgoing"`
	}](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/friend-requests",
		"",
		bob.AccessToken,
		http.StatusOK,
	)
	if len(requests.Incoming) != 1 || requests.Incoming[0].ID != createdRequest.ID {
		t.Fatalf("incoming friend requests = %+v", requests.Incoming)
	}

	accepted := requestJSON[struct {
		Conversation conversationResponse  `json:"conversation"`
		Request      friendRequestResponse `json:"request"`
	}](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/friend-requests/"+createdRequest.ID+"/accept",
		"{}",
		bob.AccessToken,
		http.StatusOK,
	)
	if accepted.Request.Status != "accepted" || accepted.Conversation.Peer.ID != alice.User.ID {
		t.Fatalf("accepted friend request = %+v", accepted)
	}

	connectRealtime(t, testServer.URL, alice.AccessToken)
	bobSocket := connectRealtime(t, testServer.URL, bob.AccessToken)

	friends := requestJSON[map[string][]friendResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/friends",
		"",
		alice.AccessToken,
		http.StatusOK,
	)
	if len(friends["friends"]) != 1 || friends["friends"][0].User.ID != bob.User.ID || !friends["friends"][0].User.Online {
		t.Fatalf("friends = %+v", friends["friends"])
	}

	createdMessage := requestJSON[map[string]messageResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/conversations/"+accepted.Conversation.ID+"/messages",
		`{"clientMessageId":"alice-message-1","body":"下班后一起开一局？"}`,
		alice.AccessToken,
		http.StatusCreated,
	)["message"]
	if createdMessage.Body != "下班后一起开一局？" || createdMessage.SenderID != alice.User.ID {
		t.Fatalf("created message = %+v", createdMessage)
	}

	_ = bobSocket.SetReadDeadline(time.Now().Add(2 * time.Second))
	var liveEvent struct {
		Data json.RawMessage `json:"data"`
		Type string          `json:"type"`
	}
	if err := bobSocket.ReadJSON(&liveEvent); err != nil {
		t.Fatalf("read realtime message: %v", err)
	}
	if liveEvent.Type != "message.created" {
		t.Fatalf("realtime event type = %q", liveEvent.Type)
	}
	var liveMessage messageResponse
	if err := json.Unmarshal(liveEvent.Data, &liveMessage); err != nil {
		t.Fatalf("decode realtime message: %v", err)
	}
	if liveMessage.ID != createdMessage.ID {
		t.Fatalf("realtime message = %+v", liveMessage)
	}

	conversations := requestJSON[map[string][]conversationResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/conversations",
		"",
		bob.AccessToken,
		http.StatusOK,
	)
	if len(conversations["conversations"]) != 1 || conversations["conversations"][0].UnreadCount != 1 {
		t.Fatalf("bob conversations = %+v", conversations["conversations"])
	}

	messages := requestJSON[map[string][]messageResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/conversations/"+accepted.Conversation.ID+"/messages?limit=20",
		"",
		bob.AccessToken,
		http.StatusOK,
	)
	if len(messages["messages"]) != 1 || messages["messages"][0].ID != createdMessage.ID {
		t.Fatalf("messages = %+v", messages["messages"])
	}

	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/conversations/"+accepted.Conversation.ID+"/read",
		"{}",
		bob.AccessToken,
		http.StatusOK,
	)
	aliceConversations := requestJSON[map[string][]conversationResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/conversations",
		"",
		alice.AccessToken,
		http.StatusOK,
	)
	if aliceConversations["conversations"][0].LastMessage == nil || !aliceConversations["conversations"][0].LastMessage.Read {
		t.Fatalf("alice last message was not marked read: %+v", aliceConversations["conversations"])
	}
}

func connectRealtime(t *testing.T, serverURL string, accessToken string) *websocket.Conn {
	t.Helper()
	ticketResponse := requestJSON[struct {
		Ticket string `json:"ticket"`
	}](
		t,
		http.DefaultClient,
		http.MethodPost,
		serverURL+"/api/v1/realtime/ticket",
		"{}",
		accessToken,
		http.StatusCreated,
	)

	websocketURL := "ws" + strings.TrimPrefix(serverURL, "http") +
		"/api/v1/realtime/ws?ticket=" + ticketResponse.Ticket
	connection, response, err := websocket.DefaultDialer.Dial(websocketURL, nil)
	if err != nil {
		if response != nil {
			t.Fatalf("connect realtime: %v (status %d)", err, response.StatusCode)
		}
		t.Fatalf("connect realtime: %v", err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	return connection
}
