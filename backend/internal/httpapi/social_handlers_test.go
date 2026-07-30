package httpapi

import (
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
	httpServer := NewServer(cfg, nil, nil, authService, socialStore)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	alice := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"alice_01","password":"password-123","displayName":"Alice"}`,
		"",
		http.StatusCreated,
	)
	bob := requestJSON[sessionResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/auth/register",
		`{"username":"bob_02","password":"password-456","displayName":"Bob"}`,
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

	friends := requestJSON[map[string][]friendResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/friends",
		"",
		alice.AccessToken,
		http.StatusOK,
	)
	if len(friends["friends"]) != 1 || friends["friends"][0].User.ID != bob.User.ID {
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
