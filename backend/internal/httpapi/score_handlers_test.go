package httpapi

import (
	"bytes"
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
	"my-first-expo-app/backend/internal/realtime"
	"my-first-expo-app/backend/internal/score"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestScoreHTTPFlow(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "funbox.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	scoreStore, err := score.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = scoreStore.Close() })

	cfg := config.Config{
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server:   config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 100, RateLimitWindow: time.Minute},
		Storage:  config.StorageConfig{AvatarDir: filepath.Join(tempDir, "avatars"), MaxAvatarBytes: 1 << 20},
	}
	signingKey := []byte(strings.Repeat("s", 32))
	authService := auth.NewService(userStore, signingKey, time.Hour)
	scoreService := score.NewService(scoreStore, signingKey, 7*24*time.Hour)
	httpServer := NewServer(cfg, nil, nil, authService, socialStore, nil, scoreService)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	registered := scoreRequestJSON[sessionResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register", map[string]any{
		"username": "13800138001", "password": "password-123", "displayName": "Host",
		"securityQuestion": "Question?", "securityAnswer": "Answer",
	}, "", http.StatusCreated)
	guestRegistered := scoreRequestJSON[sessionResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register", map[string]any{
		"username": "13800138009", "password": "password-123", "displayName": "Account Guest",
		"securityQuestion": "Question?", "securityAnswer": "Answer",
	}, "", http.StatusCreated)
	created := scoreRequestJSON[score.CreateRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms", map[string]any{
		"name": "Friday game", "maxPlayers": 4,
	}, registered.AccessToken, http.StatusCreated)
	if created.Room.CentsPerPoint != 100 {
		t.Fatalf("default cents per point = %d, want 100", created.Room.CentsPerPoint)
	}
	preview := scoreRequestJSON[score.InvitePreviewResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/invite-preview", map[string]any{
		"inviteToken": created.InviteToken,
	}, "", http.StatusOK)
	if preview.Room.Code != created.Room.Code || preview.SelfParticipantID != "" {
		t.Fatalf("anonymous invite preview = %+v", preview)
	}
	hostPreview := scoreRequestJSON[score.InvitePreviewResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/invite-preview", map[string]any{
		"inviteToken": created.InviteToken,
	}, registered.AccessToken, http.StatusOK)
	if hostPreview.SelfParticipantID != created.Actor.ParticipantID {
		t.Fatalf("host invite preview self id = %q, want %q", hostPreview.SelfParticipantID, created.Actor.ParticipantID)
	}
	joined := scoreRequestJSON[score.JoinRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/join", map[string]any{
		"code": created.Room.Code, "displayName": "Guest",
	}, guestRegistered.AccessToken, http.StatusCreated)
	if joined.Actor.UserID != guestRegistered.User.ID {
		t.Fatalf("joined participant user id = %q, want %q", joined.Actor.UserID, guestRegistered.User.ID)
	}

	hostTicket := scoreRequestJSON[realtimeTicketResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/realtime-ticket", nil, registered.AccessToken, http.StatusCreated)
	guestTicket := scoreRequestJSON[realtimeTicketResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/realtime-ticket", nil, joined.GuestToken, http.StatusCreated)
	hostSocket := dialScoreSocket(t, testServer.URL, hostTicket.Ticket)
	guestSocket := dialScoreSocket(t, testServer.URL, guestTicket.Ticket)

	room := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/start", map[string]any{
		"clientActionId": "start", "expectedRoomVersion": joined.Room.Version,
	}, registered.AccessToken, http.StatusOK).Room
	assertScoreInvalidation(t, hostSocket, room)
	assertScoreInvalidation(t, guestSocket, room)

	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/gifts", map[string]any{
		"clientActionId": "host-gifts", "expectedRoomVersion": room.Version,
		"allocations": []map[string]any{{"toParticipantId": joined.Actor.ParticipantID, "points": 8}},
	}, registered.AccessToken, http.StatusOK).Room
	if room.CurrentRound != nil || len(room.GiftBatches) != 1 {
		t.Fatalf("direct gift room = %+v", room)
	}
	assertScoreInvalidation(t, hostSocket, room)
	assertScoreInvalidation(t, guestSocket, room)
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/settle", map[string]any{
		"clientActionId": "settle", "expectedRoomVersion": room.Version, "centsPerPoint": 50,
	}, registered.AccessToken, http.StatusOK).Room
	if room.Status != score.RoomSettled || room.CentsPerPoint != 50 || room.Settlement == nil || len(room.Settlement.Transfers) != 1 {
		t.Fatalf("settled room = %+v", room)
	}

	hostSnapshot := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID, nil, registered.AccessToken, http.StatusOK).Room
	guestSnapshot := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID, nil, joined.GuestToken, http.StatusOK).Room
	if hostSnapshot.Version != guestSnapshot.Version || hostSnapshot.Participants[0].TotalPoints != -8 || guestSnapshot.Participants[1].TotalPoints != 8 {
		t.Fatalf("snapshots differ: host=%+v guest=%+v", hostSnapshot, guestSnapshot)
	}
	history := scoreRequestJSON[scoreHistoryResponse](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/score-rooms/history?scope=participated&status=settled&limit=5&offset=0",
		nil, guestRegistered.AccessToken, http.StatusOK)
	if history.Total != 1 || history.Limit != 5 || history.Offset != 0 ||
		len(history.Rooms) != 1 || history.Rooms[0].ID != created.Room.ID ||
		history.Rooms[0].SelfParticipantID != joined.Actor.ParticipantID {
		t.Fatalf("participant history = %+v", history.Rooms)
	}
}

func TestScoreHTTPAnonymousHostCreationAndAccountBinding(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "funbox.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	scoreStore, err := score.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = scoreStore.Close() })

	cfg := config.Config{
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server:   config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 100, RateLimitWindow: time.Minute},
		Storage:  config.StorageConfig{AvatarDir: filepath.Join(tempDir, "avatars"), MaxAvatarBytes: 1 << 20},
	}
	signingKey := []byte(strings.Repeat("s", 32))
	authService := auth.NewService(userStore, signingKey, time.Hour)
	scoreService := score.NewService(scoreStore, signingKey, 7*24*time.Hour)
	httpServer := NewServer(cfg, nil, nil, authService, socialStore, nil, scoreService)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	hostAccount := scoreRequestJSON[sessionResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register", map[string]any{
		"username": "13800138021", "password": "password-123", "displayName": "游客转登录",
		"securityQuestion": "Question?", "securityAnswer": "Answer",
	}, "", http.StatusCreated)
	guestAccount := scoreRequestJSON[sessionResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register", map[string]any{
		"username": "13800138022", "password": "password-123", "displayName": "登录牌友",
		"securityQuestion": "Question?", "securityAnswer": "Answer",
	}, "", http.StatusCreated)

	scoreRequestJSON[map[string]any](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms", map[string]any{
		"name": "未命名游客局", "maxPlayers": 4,
	}, "", http.StatusBadRequest)
	created := scoreRequestJSON[score.CreateRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms", map[string]any{
		"name": "游客房主牌局", "displayName": "游客房主", "maxPlayers": 4,
	}, "", http.StatusCreated)
	if created.GuestToken == "" || created.Room.HostUserID != "" || created.Actor.Role != score.ParticipantHost || created.Actor.UserID != "" {
		t.Fatalf("anonymous create response = %+v", created)
	}

	bound := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/bind-account",
		map[string]any{"participantToken": created.GuestToken}, hostAccount.AccessToken, http.StatusOK).Room
	if bound.HostUserID != hostAccount.User.ID || bound.SelfParticipantID != created.Actor.ParticipantID {
		t.Fatalf("bound anonymous room = %+v", bound)
	}
	hostSnapshot := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/score-rooms/"+created.Room.ID, nil, hostAccount.AccessToken, http.StatusOK).Room
	if hostSnapshot.SelfParticipantID != created.Actor.ParticipantID {
		t.Fatalf("account token room access after binding = %+v", hostSnapshot)
	}
	scoreRequestJSON[map[string]any](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/bind-account",
		map[string]any{"participantToken": created.GuestToken}, guestAccount.AccessToken, http.StatusConflict)

	joined := scoreRequestJSON[score.JoinRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/join", map[string]any{
		"code": created.Room.Code, "displayName": "登录牌友",
	}, guestAccount.AccessToken, http.StatusCreated)
	room := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/start",
		map[string]any{"clientActionId": "anonymous-start", "expectedRoomVersion": joined.Room.Version},
		created.GuestToken, http.StatusOK).Room
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/gifts",
		map[string]any{
			"clientActionId": "anonymous-gifts", "expectedRoomVersion": room.Version,
			"allocations": []map[string]any{{"toParticipantId": joined.Actor.ParticipantID, "points": 8}},
		}, created.GuestToken, http.StatusOK).Room
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/settle",
		map[string]any{
			"clientActionId": "anonymous-settle", "expectedRoomVersion": room.Version,
			"centsPerPoint": 100, "useSettlementRate": true,
		}, created.GuestToken, http.StatusOK).Room
	if room.Status != score.RoomSettled {
		t.Fatalf("anonymous room settlement = %+v", room)
	}

	for _, account := range []sessionResponse{hostAccount, guestAccount} {
		history := scoreRequestJSON[scoreHistoryResponse](t, testServer.Client(), http.MethodGet,
			testServer.URL+"/api/v1/score-rooms/history?scope=participated&status=settled&limit=10",
			nil, account.AccessToken, http.StatusOK)
		if len(history.Rooms) != 1 || history.Rooms[0].ID != created.Room.ID {
			t.Fatalf("account history after anonymous room = %+v", history.Rooms)
		}
	}
	scoreRequestJSON[map[string]any](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/score-rooms/history?scope=participated&status=settled&limit=10",
		nil, "", http.StatusUnauthorized)
}

func TestScoreHTTPMahjongInvitePasswordHintAndNearbyFlow(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "funbox.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	scoreStore, err := score.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = scoreStore.Close() })

	cfg := config.Config{
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server:   config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 100, RateLimitWindow: time.Minute},
		Storage:  config.StorageConfig{AvatarDir: filepath.Join(tempDir, "avatars"), MaxAvatarBytes: 1 << 20},
	}
	signingKey := []byte(strings.Repeat("s", 32))
	authService := auth.NewService(userStore, signingKey, time.Hour)
	scoreService := score.NewService(scoreStore, signingKey, 7*24*time.Hour)
	httpServer := NewServer(cfg, nil, nil, authService, socialStore, nil, scoreService)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	registered := scoreRequestJSON[sessionResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register", map[string]any{
		"username": "13800138003", "password": "password-123", "displayName": "Host",
		"securityQuestion": "Question?", "securityAnswer": "Answer",
	}, "", http.StatusCreated)
	created := scoreRequestJSON[score.CreateRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms", map[string]any{
		"name": "Nearby Mahjong", "maxPlayers": 4, "centsPerPoint": 100,
		"capPoints": 8, "password": "2468", "scene": "generic", "gameType": "mahjong",
		"latitude": 30.5728, "longitude": 104.0668,
	}, registered.AccessToken, http.StatusCreated)

	nearby := scoreRequestJSON[score.NearbyRoomsResult](t, testServer.Client(), http.MethodGet,
		testServer.URL+"/api/v1/score-rooms/nearby?latitude=30.5728&longitude=104.0668&radiusMeters=3000&gameType=mahjong",
		nil, "", http.StatusOK)
	if len(nearby.Rooms) != 1 || nearby.Rooms[0].Code != created.Room.Code || !nearby.Rooms[0].RequiresPassword {
		t.Fatalf("nearby response = %+v", nearby)
	}
	scoreRequestJSON[map[string]any](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/join", map[string]any{
		"code": created.Room.Code, "displayName": "Guest", "password": "0000",
	}, "", http.StatusForbidden)
	joined := scoreRequestJSON[score.JoinRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/join", map[string]any{
		"code": created.Room.Code, "displayName": "Guest", "password": "2468",
	}, "", http.StatusCreated)
	if joined.Room.ID != created.Room.ID || joined.Room.GameType != score.GameTypeMahjong {
		t.Fatalf("joined room = %+v", joined.Room)
	}
	invited := scoreRequestJSON[score.JoinRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/join", map[string]any{
		"inviteToken": created.InviteToken, "displayName": "Invited Guest",
	}, "", http.StatusCreated)
	if invited.Room.ID != created.Room.ID || invited.GuestToken == "" {
		t.Fatalf("invite join = %+v", invited)
	}
	room := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/start",
		map[string]any{"clientActionId": "start-nearby", "expectedRoomVersion": invited.Room.Version},
		registered.AccessToken, http.StatusOK).Room
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/gifts",
		map[string]any{
			"clientActionId": "over-cap", "expectedRoomVersion": room.Version,
			"allocations": []map[string]any{{"toParticipantId": joined.Actor.ParticipantID, "points": 9}},
		}, registered.AccessToken, http.StatusOK).Room
	if len(room.GiftBatches) != 1 || len(room.GiftBatches[0].Gifts) != 1 || room.GiftBatches[0].Gifts[0].Points != 9 {
		t.Fatalf("over-cap gift response = %+v", room.GiftBatches)
	}
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/gifts",
		map[string]any{
			"clientActionId": "guest-gift", "expectedRoomVersion": room.Version,
			"allocations": []map[string]any{{"toParticipantId": invited.Actor.ParticipantID, "points": 2}},
		}, joined.GuestToken, http.StatusOK).Room
	if len(room.GiftBatches) != 2 || room.GiftBatches[0].CreatedBy != joined.Actor.ParticipantID {
		t.Fatalf("guest gift response = %+v", room.GiftBatches)
	}
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost,
		testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/settle",
		map[string]any{
			"clientActionId": "settle-nearby", "expectedRoomVersion": room.Version,
			"centsPerPoint": 300, "useSettlementRate": true,
		}, registered.AccessToken, http.StatusOK).Room
	if room.Status != score.RoomSettled || room.CentsPerPoint != 300 || room.Settlement == nil {
		t.Fatalf("settled mahjong room = %+v", room)
	}
	balances := make(map[string]int64, len(room.Settlement.Balances))
	for _, balance := range room.Settlement.Balances {
		balances[balance.ParticipantID] = balance.AmountCents
	}
	if balances[created.Actor.ParticipantID] != -2700 ||
		balances[joined.Actor.ParticipantID] != 2100 ||
		balances[invited.Actor.ParticipantID] != 600 {
		t.Fatalf("settlement balances = %+v", room.Settlement.Balances)
	}
}

func TestScoreHTTPZhaJinHuaFlow(t *testing.T) {
	tempDir := t.TempDir()
	databasePath := filepath.Join(tempDir, "funbox.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	socialStore, err := social.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	scoreStore, err := score.OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = scoreStore.Close() })

	cfg := config.Config{
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server:   config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 100, RateLimitWindow: time.Minute},
		Storage:  config.StorageConfig{AvatarDir: filepath.Join(tempDir, "avatars"), MaxAvatarBytes: 1 << 20},
	}
	signingKey := []byte(strings.Repeat("z", 32))
	authService := auth.NewService(userStore, signingKey, time.Hour)
	scoreService := score.NewService(scoreStore, signingKey, 7*24*time.Hour)
	httpServer := NewServer(cfg, nil, nil, authService, socialStore, nil, scoreService)
	testServer := httptest.NewServer(httpServer.Handler)
	t.Cleanup(testServer.Close)

	registered := scoreRequestJSON[sessionResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/auth/register", map[string]any{
		"username": "13800138002", "password": "password-123", "displayName": "Host",
		"securityQuestion": "Question?", "securityAnswer": "Answer",
	}, "", http.StatusCreated)
	created := scoreRequestJSON[score.CreateRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms", map[string]any{
		"name": "炸金花局", "maxPlayers": 2, "scene": "zhajinhua",
		"forceOpenThreshold": 2,
	}, registered.AccessToken, http.StatusCreated)
	if created.Room.Scene != score.SceneZhaJinHua || created.Room.ZhaJinHuaSettings.ForceOpenThreshold != 2 {
		t.Fatalf("created room = %+v", created.Room)
	}
	joined := scoreRequestJSON[score.JoinRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/join", map[string]any{
		"code": created.Room.Code, "displayName": "Guest",
	}, "", http.StatusCreated)
	room := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/start", map[string]any{
		"clientActionId": "zjh-start-room", "expectedRoomVersion": joined.Room.Version,
	}, registered.AccessToken, http.StatusOK).Room
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/zha-jin-hua/hands", map[string]any{
		"clientActionId": "zjh-start-hand", "expectedRoomVersion": room.Version,
	}, registered.AccessToken, http.StatusCreated).Room
	handID := room.CurrentZhaJinHuaHand.ID

	scoreRequestJSON[map[string]any](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/zha-jin-hua/hands/"+handID+"/actions", map[string]any{
		"clientActionId": "zjh-guest-out-of-turn", "expectedRoomVersion": room.Version,
		"actionType": "raise", "points": 1,
	}, joined.GuestToken, http.StatusConflict)

	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/zha-jin-hua/hands/"+handID+"/actions", map[string]any{
		"clientActionId": "zjh-host-raise", "expectedRoomVersion": room.Version,
		"actionType": "raise", "points": 10,
	}, registered.AccessToken, http.StatusOK).Room
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/zha-jin-hua/hands/"+handID+"/actions", map[string]any{
		"clientActionId": "zjh-guest-raise", "expectedRoomVersion": room.Version,
		"actionType": "raise", "points": 10,
	}, joined.GuestToken, http.StatusOK).Room
	if room.CurrentZhaJinHuaHand.CurrentBetPoints != 10 || room.CurrentZhaJinHuaHand.PotPoints != 20 {
		t.Fatalf("zha jin hua bet/pot = %+v", room.CurrentZhaJinHuaHand)
	}
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/zha-jin-hua/hands/"+handID+"/actions", map[string]any{
		"clientActionId": "zjh-host-open", "expectedRoomVersion": room.Version,
		"actionType": "force_open", "targetParticipantId": joined.Actor.ParticipantID,
		"winnerParticipantId": created.Actor.ParticipantID,
	}, registered.AccessToken, http.StatusOK).Room
	if room.CurrentZhaJinHuaHand != nil || len(room.ZhaJinHuaHands) != 1 || room.ZhaJinHuaHands[0].PotPoints != 30 ||
		room.ZhaJinHuaHands[0].CurrentBetPoints != 10 {
		t.Fatalf("finished zha jin hua room = %+v", room)
	}
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPatch, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/zha-jin-hua/settings", map[string]any{
		"clientActionId": "zjh-update-settings", "expectedRoomVersion": room.Version,
		"forceOpenThreshold": 2,
	}, registered.AccessToken, http.StatusOK).Room
	if room.ZhaJinHuaSettings.ForceOpenThreshold != 2 {
		t.Fatalf("updated zha jin hua settings = %+v", room.ZhaJinHuaSettings)
	}
}

type scoreRoomResponse struct {
	Room score.RoomSnapshot `json:"room"`
}

type scoreHistoryResponse struct {
	Rooms  []score.RoomSnapshot `json:"rooms"`
	Total  int                  `json:"total"`
	Limit  int                  `json:"limit"`
	Offset int                  `json:"offset"`
}

type realtimeTicketResponse struct {
	Ticket string `json:"ticket"`
}

func scoreRequestJSON[T any](t *testing.T, client *http.Client, method, url string, body any, token string, wantStatus int) T {
	t.Helper()
	var encoded []byte
	if body != nil {
		var err error
		encoded, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	request, err := http.NewRequest(method, url, bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != wantStatus {
		var payload any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		t.Fatalf("%s %s status = %d, want %d, body=%v", method, url, response.StatusCode, wantStatus, payload)
	}
	var result T
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result
}

func dialScoreSocket(t *testing.T, serverURL, ticket string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(serverURL, "http") + "/api/v1/realtime/ws?ticket=" + ticket
	connection, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	return connection
}

func assertScoreInvalidation(t *testing.T, connection *websocket.Conn, room score.RoomSnapshot) {
	t.Helper()
	_ = connection.SetReadDeadline(time.Now().Add(2 * time.Second))
	var event realtime.Event
	if err := connection.ReadJSON(&event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "score.room.updated" {
		t.Fatalf("event = %+v", event)
	}
	data, _ := json.Marshal(event.Data)
	var update struct {
		RoomID   string `json:"roomId"`
		Version  int64  `json:"roomVersion"`
		Sequence int64  `json:"sequence"`
	}
	if err := json.Unmarshal(data, &update); err != nil {
		t.Fatal(err)
	}
	if update.RoomID != room.ID || update.Version != room.Version || update.Sequence != room.EventSequence {
		t.Fatalf("invalidation = %+v, room = %+v", update, room)
	}
}
