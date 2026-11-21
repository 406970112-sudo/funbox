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
	"my-first-expo-app/backend/internal/score"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

func TestMahjongHandoverHTTPFlow(t *testing.T) {
	database := filepath.Join(t.TempDir(), "funbox.db")
	users, err := user.OpenStore(database)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = users.Close() })
	socialStore, err := social.OpenStore(database)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socialStore.Close() })
	scores, err := score.OpenStore(database)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = scores.Close() })

	cfg := config.Config{
		Auth:     config.AuthConfig{TokenTTL: time.Hour},
		Server:   config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second},
		Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 30, RateLimitWindow: time.Minute},
	}
	key := []byte(strings.Repeat("s", 32))
	server := NewServer(cfg, nil, nil, auth.NewService(users, key, time.Hour), socialStore, nil,
		score.NewService(scores, key, 24*time.Hour))
	api := httptest.NewServer(server.Handler)
	t.Cleanup(api.Close)
	client := api.Client()
	base := api.URL + "/api/v1/score-rooms"
	created := scoreRequestJSON[score.CreateRoomResult](t, client, http.MethodPost, base, map[string]any{
		"name": "Old friends", "displayName": "B", "maxPlayers": 4, "password": "2468", "gameType": "mahjong",
	}, "", http.StatusCreated)
	var leaving score.JoinRoomResult
	room := created.Room
	for _, name := range []string{"A", "C", "D"} {
		joined := scoreRequestJSON[score.JoinRoomResult](t, client, http.MethodPost, base+"/join", map[string]any{
			"inviteToken": created.InviteToken, "displayName": name,
		}, "", http.StatusCreated)
		room = joined.Room
		if name == "A" {
			leaving = joined
		}
	}
	roomURL := base + "/" + room.ID
	hostToken := created.GuestToken
	post := func(path, token string, body map[string]any) score.RoomSnapshot {
		t.Helper()
		return scoreRequestJSON[scoreRoomResponse](t, client, http.MethodPost, roomURL+path, body, token, http.StatusOK).Room
	}
	room = post("/start", hostToken, map[string]any{"expectedRoomVersion": room.Version})
	room = post("/gifts", leaving.GuestToken, map[string]any{
		"expectedRoomVersion": room.Version,
		"allocations":         []map[string]any{{"toParticipantId": created.Actor.ParticipantID, "points": 30}},
	})
	command := "/mahjong-handover"
	invite := map[string]any{"action": "invite", "participantId": leaving.Actor.ParticipantID, "expectedRoomVersion": room.Version}
	scoreRequestJSON[map[string]string](t, client, http.MethodPost, roomURL+command, invite, leaving.GuestToken, http.StatusForbidden)
	var started = scoreRequestJSON[struct {
		Room struct {
			Handover map[string]any `json:"mahjongHandover"`
		} `json:"room"`
	}](t, client, http.MethodPost, roomURL+command, invite, hostToken, http.StatusOK)
	id, _ := started.Room.Handover["id"].(string)
	if id == "" || started.Room.Handover["scene"] != nil || started.Room.Handover["claimToken"] != nil {
		t.Fatalf("unexpected invitation projection: %+v", started.Room.Handover)
	}

	code := scoreRequestJSON[score.InviteCodeResult](t, client, http.MethodPost, roomURL+command+"/"+id+"/code",
		map[string]any{}, hostToken, http.StatusOK)
	if !strings.HasPrefix(code.InviteScene, "h_") {
		t.Fatal("missing WeChat handover scene")
	}
	type candidateResponse struct {
		Handover struct {
			Status        string `json:"status"`
			ClaimToken    string `json:"claimToken"`
			GuestToken    string `json:"guestToken"`
			ParticipantID string `json:"participantId"`
			Points        int64  `json:"points"`
		} `json:"handover"`
	}
	preview := func(claim string) candidateResponse {
		t.Helper()
		return scoreRequestJSON[candidateResponse](t, client, http.MethodPost, base+command+"/preview", map[string]any{
			"scene": code.InviteScene, "claimToken": claim,
		}, "", http.StatusOK)
	}
	first := preview("").Handover
	if first.Status != "open" || first.Points != -30 || first.ClaimToken == "" || first.GuestToken != "" {
		t.Fatalf("unexpected initial candidate status: %s, %d", first.Status, first.Points)
	}
	accept := map[string]any{"scene": code.InviteScene, "claimToken": first.ClaimToken, "displayName": "E"}
	scoreRequestJSON[map[string]string](t, client, http.MethodPost, base+command+"/accept", accept, "", http.StatusBadRequest)
	accept["points"] = -30
	badLogin := scoreRequestJSON[map[string]string](t, client, http.MethodPost, base+command+"/accept", accept, "expired-account", http.StatusUnauthorized)
	if badLogin["error"] != "score_handover_login_expired" {
		t.Fatalf("expected account rejection before participant proof check, got %+v", badLogin)
	}
	ticket := scoreRequestJSON[realtimeTicketResponse](t, client, http.MethodPost, roomURL+"/realtime-ticket", nil, hostToken, http.StatusCreated)
	socket := dialScoreSocket(t, api.URL, ticket.Ticket)
	accepted := scoreRequestJSON[candidateResponse](t, client, http.MethodPost, base+command+"/accept", accept, "", http.StatusOK).Handover
	if accepted.Status != "accepted" || accepted.GuestToken != "" {
		t.Fatalf("unexpected candidate status before host approval: %s", accepted.Status)
	}
	for range 35 {
		if pending := preview(first.ClaimToken).Handover; pending.Status != "accepted" || pending.GuestToken != "" {
			t.Fatalf("unexpected pending candidate status: %s", pending.Status)
		}
	}
	room = scoreRequestJSON[scoreRoomResponse](t, client, http.MethodGet, roomURL, nil, hostToken, http.StatusOK).Room
	assertScoreInvalidation(t, socket, room)
	room = post(command, hostToken, map[string]any{"action": "confirm", "handoverId": id, "expectedRoomVersion": room.Version})
	assertScoreInvalidation(t, socket, room)
	complete := preview(first.ClaimToken).Handover
	if complete.Status != "completed" || complete.GuestToken == "" || complete.ParticipantID == "" || complete.ParticipantID == leaving.Actor.ParticipantID {
		t.Fatalf("unexpected final candidate status: %s", complete.Status)
	}
	if anonymous := preview("").Handover; anonymous.GuestToken != "" {
		t.Fatal("a second scanner received the replacement player's session")
	}
	scoreRequestJSON[scoreRoomResponse](t, client, http.MethodGet, roomURL, nil, complete.GuestToken, http.StatusOK)
	scoreRequestJSON[scoreRoomResponse](t, client, http.MethodGet, roomURL, nil, leaving.GuestToken, http.StatusOK)
	scoreRequestJSON[map[string]string](t, client, http.MethodPost, roomURL+"/gifts", map[string]any{
		"expectedRoomVersion": room.Version,
		"allocations":         []map[string]any{{"toParticipantId": created.Actor.ParticipantID, "points": 1}},
	}, leaving.GuestToken, http.StatusForbidden)
}
