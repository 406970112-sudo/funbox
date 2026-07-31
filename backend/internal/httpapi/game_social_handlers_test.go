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

type gameMatchTestResponse struct {
	CurrentTurnUserID string                 `json:"currentTurnUserId"`
	GameID            string                 `json:"gameId"`
	ID                string                 `json:"id"`
	Inviter           socialUserResponse     `json:"inviter"`
	Moves             []gameMoveTestResponse `json:"moves"`
	Opponent          socialUserResponse     `json:"opponent"`
	Status            string                 `json:"status"`
	WinnerUserID      string                 `json:"winnerUserId"`
}

type gameMoveTestResponse struct {
	Col      int    `json:"col"`
	Row      int    `json:"row"`
	Sequence int    `json:"sequence"`
	UserID   string `json:"userId"`
}

type leaderboardEntryTestResponse struct {
	IsCurrentUser bool               `json:"isCurrentUser"`
	Rank          int                `json:"rank"`
	Score         int                `json:"score"`
	User          socialUserResponse `json:"user"`
}

func TestGameSocialHTTPFlow(t *testing.T) {
	testServer, alice, bob, carol := openGameSocialHTTPTestServer(t)
	makeHTTPTestFriends(t, testServer, alice, bob)
	bobSocket := connectRealtime(t, testServer.URL, bob.AccessToken)

	created := requestJSON[map[string]gameMatchTestResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/game-matches",
		`{"gameId":"gomoku","opponentId":"`+bob.User.ID+`"}`,
		alice.AccessToken,
		http.StatusCreated,
	)["match"]
	if created.Status != social.GameMatchPending || created.Inviter.ID != alice.User.ID || created.Opponent.ID != bob.User.ID {
		t.Fatalf("created game match = %+v", created)
	}

	invited := readRealtimeEvent(t, bobSocket, "game.match.invited")
	var invitedMatch gameMatchTestResponse
	if err := json.Unmarshal(invited.Data, &invitedMatch); err != nil {
		t.Fatalf("decode invited match: %v", err)
	}
	if invitedMatch.ID != created.ID {
		t.Fatalf("invited match id = %q, want %q", invitedMatch.ID, created.ID)
	}

	active := requestJSON[map[string]gameMatchTestResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/game-matches/"+created.ID+"/accept",
		"{}",
		bob.AccessToken,
		http.StatusOK,
	)["match"]
	if active.Status != social.GameMatchActive || active.CurrentTurnUserID != alice.User.ID {
		t.Fatalf("accepted game match = %+v", active)
	}

	moves := []struct {
		clientMoveID string
		col          int
		row          int
		token        string
	}{
		{"alice-1", 5, 7, alice.AccessToken},
		{"bob-1", 0, 0, bob.AccessToken},
		{"alice-2", 6, 7, alice.AccessToken},
		{"bob-2", 1, 0, bob.AccessToken},
		{"alice-3", 7, 7, alice.AccessToken},
		{"bob-3", 2, 0, bob.AccessToken},
		{"alice-4", 8, 7, alice.AccessToken},
		{"bob-4", 3, 0, bob.AccessToken},
		{"alice-5", 9, 7, alice.AccessToken},
	}
	var finished gameMatchTestResponse
	for _, move := range moves {
		finished = requestJSON[map[string]gameMatchTestResponse](
			t,
			testServer.Client(),
			http.MethodPost,
			testServer.URL+"/api/v1/game-matches/"+created.ID+"/moves",
			`{"clientMoveId":"`+move.clientMoveID+`","row":`+integerJSON(move.row)+`,"col":`+integerJSON(move.col)+`}`,
			move.token,
			http.StatusOK,
		)["match"]
	}
	if finished.Status != social.GameMatchFinished || finished.WinnerUserID != alice.User.ID || len(finished.Moves) != 9 {
		t.Fatalf("finished game match = %+v", finished)
	}

	listed := requestJSON[map[string][]gameMatchTestResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/game-matches",
		"",
		bob.AccessToken,
		http.StatusOK,
	)["matches"]
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("listed game matches = %+v", listed)
	}

	for _, score := range []struct {
		points int
		token  string
	}{
		{42000, alice.AccessToken},
		{48000, bob.AccessToken},
		{999999, carol.AccessToken},
	} {
		requestJSON[map[string]any](
			t,
			testServer.Client(),
			http.MethodPost,
			testServer.URL+"/api/v1/game-scores",
			`{"gameId":"tetris","score":`+integerJSON(score.points)+`}`,
			score.token,
			http.StatusCreated,
		)
	}

	leaderboard := requestJSON[map[string][]leaderboardEntryTestResponse](
		t,
		testServer.Client(),
		http.MethodGet,
		testServer.URL+"/api/v1/game-leaderboards/tetris?period=weekly",
		"",
		alice.AccessToken,
		http.StatusOK,
	)["entries"]
	if len(leaderboard) != 2 || leaderboard[0].User.ID != bob.User.ID || leaderboard[0].Score != 48000 {
		t.Fatalf("friend leaderboard = %+v", leaderboard)
	}
	if leaderboard[1].User.ID != alice.User.ID || !leaderboard[1].IsCurrentUser {
		t.Fatalf("current user leaderboard entry = %+v", leaderboard[1])
	}

	readRealtimeEvent(t, bobSocket, "game.score.updated")
}

type gameRealtimeEvent struct {
	Data json.RawMessage `json:"data"`
	Type string          `json:"type"`
}

func readRealtimeEvent(t *testing.T, socket *websocket.Conn, eventType string) gameRealtimeEvent {
	t.Helper()
	_ = socket.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		var event gameRealtimeEvent
		if err := socket.ReadJSON(&event); err != nil {
			t.Fatalf("read realtime event %s: %v", eventType, err)
		}
		if event.Type == eventType {
			return event
		}
	}
}

func openGameSocialHTTPTestServer(t *testing.T) (*httptest.Server, sessionResponse, sessionResponse, sessionResponse) {
	t.Helper()
	databasePath := filepath.Join(t.TempDir(), "game-social-http.db")
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
			RateLimitMax:        200,
			RateLimitWindow:     time.Minute,
		},
	}
	authService := auth.NewService(userStore, []byte(strings.Repeat("g", 32)), time.Hour)
	httpServer := NewServer(cfg, nil, nil, authService, socialStore, nil)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	register := func(phone string, displayName string) sessionResponse {
		return requestJSON[sessionResponse](
			t,
			testServer.Client(),
			http.MethodPost,
			testServer.URL+"/api/v1/auth/register",
			`{"username":"`+phone+`","password":"password-123","displayName":"`+displayName+`","securityQuestion":"你小时候最喜欢的书是什么？","securityAnswer":"海底两万里"}`,
			"",
			http.StatusCreated,
		)
	}
	return testServer,
		register("13800138000", "Alice"),
		register("13900139000", "Bob"),
		register("13700137000", "Carol")
}

func makeHTTPTestFriends(t *testing.T, testServer *httptest.Server, sender sessionResponse, recipient sessionResponse) {
	t.Helper()
	created := requestJSON[map[string]friendRequestResponse](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/friend-requests",
		`{"userId":"`+recipient.User.ID+`"}`,
		sender.AccessToken,
		http.StatusCreated,
	)["request"]
	requestJSON[map[string]any](
		t,
		testServer.Client(),
		http.MethodPost,
		testServer.URL+"/api/v1/friend-requests/"+created.ID+"/accept",
		"{}",
		recipient.AccessToken,
		http.StatusOK,
	)
}

func integerJSON(value int) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
