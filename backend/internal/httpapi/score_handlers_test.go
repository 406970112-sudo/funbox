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
	created := scoreRequestJSON[score.CreateRoomResult](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms", map[string]any{
		"name": "Friday game", "maxPlayers": 4, "centsPerPoint": 50,
	}, registered.AccessToken, http.StatusCreated)
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
	}, "", http.StatusCreated)

	hostTicket := scoreRequestJSON[realtimeTicketResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/realtime-ticket", nil, registered.AccessToken, http.StatusCreated)
	guestTicket := scoreRequestJSON[realtimeTicketResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/realtime-ticket", nil, joined.GuestToken, http.StatusCreated)
	hostSocket := dialScoreSocket(t, testServer.URL, hostTicket.Ticket)
	guestSocket := dialScoreSocket(t, testServer.URL, guestTicket.Ticket)

	room := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/start", map[string]any{
		"clientActionId": "start", "expectedRoomVersion": joined.Room.Version,
	}, registered.AccessToken, http.StatusOK).Room
	assertScoreInvalidation(t, hostSocket, room)
	assertScoreInvalidation(t, guestSocket, room)

	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/rounds", map[string]any{
		"clientActionId": "round", "expectedRoomVersion": room.Version,
	}, registered.AccessToken, http.StatusCreated).Room
	roundID := room.CurrentRound.ID
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPut, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/rounds/"+roundID+"/entry", map[string]any{
		"clientActionId": "host-entry", "expectedRoomVersion": room.Version, "deltaPoints": 8,
	}, registered.AccessToken, http.StatusOK).Room
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPut, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/rounds/"+roundID+"/entry", map[string]any{
		"clientActionId": "guest-entry", "expectedRoomVersion": room.Version, "deltaPoints": -8,
	}, joined.GuestToken, http.StatusOK).Room
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/rounds/"+roundID+"/confirm", map[string]any{
		"clientActionId": "host-confirm", "expectedRoomVersion": room.Version,
	}, registered.AccessToken, http.StatusOK).Room
	room = scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodPost, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID+"/rounds/"+roundID+"/confirm", map[string]any{
		"clientActionId": "guest-confirm", "expectedRoomVersion": room.Version,
	}, joined.GuestToken, http.StatusOK).Room

	hostSnapshot := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID, nil, registered.AccessToken, http.StatusOK).Room
	guestSnapshot := scoreRequestJSON[scoreRoomResponse](t, testServer.Client(), http.MethodGet, testServer.URL+"/api/v1/score-rooms/"+created.Room.ID, nil, joined.GuestToken, http.StatusOK).Room
	if hostSnapshot.Version != guestSnapshot.Version || hostSnapshot.Participants[0].TotalPoints != 8 || guestSnapshot.Participants[1].TotalPoints != -8 {
		t.Fatalf("snapshots differ: host=%+v guest=%+v", hostSnapshot, guestSnapshot)
	}
}

type scoreRoomResponse struct {
	Room score.RoomSnapshot `json:"room"`
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
