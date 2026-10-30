package httpapi

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/score"
	"my-first-expo-app/backend/internal/social"
	"my-first-expo-app/backend/internal/user"
)

// Exercise the public HTTP contract with independent guest credentials and a real
// SQLite database; the extra V2 fields are read as JSON so legacy builds fail on
// behavior rather than on missing Go types.
func TestScoreHTTPZJHV2RepeatedHandsAndMembership(t *testing.T) {
	srv := newZJHV2HTTPServer(t)
	client, base := srv.Client(), srv.URL+"/api/v1/score-rooms"
	settings := map[string]any{"rulesVersion": 2, "antePoints": 10, "maxBetPoints": 20, "compareThreshold": 3, "baoziBonusPoints": 50, "shunjinBonusPoints": 20}
	created := scoreRequestJSON[map[string]any](t, client, http.MethodPost, base, map[string]any{
		"name": "好友炸金花", "displayName": "房主", "maxPlayers": 12, "centsPerPoint": 25,
		"scene": "zhajinhua", "gameType": "zhajinhua", "zhaJinHuaSettings": settings,
	}, "", http.StatusCreated)
	room := object(t, created, "room")
	hostID, hostToken := object(t, created, "actor")["participantId"].(string), created["guestToken"].(string)
	roomURL := base + "/" + room["id"].(string)
	if room["maxPlayers"] != float64(12) || room["centsPerPoint"] != float64(25) {
		t.Fatalf("V2 creation lost capacity or fixed rate: %v", room)
	}
	join := func(name string) (string, string) {
		t.Helper()
		result := scoreRequestJSON[map[string]any](t, client, http.MethodPost, base+"/join", map[string]any{"code": room["code"], "displayName": name}, "", http.StatusCreated)
		room = object(t, result, "room")
		return object(t, result, "actor")["participantId"].(string), result["guestToken"].(string)
	}
	guestID, guestToken := join("牌友甲")
	otherID, otherToken := join("牌友乙")
	mutate := func(method, path, id, token string, extra map[string]any, status int) map[string]any {
		t.Helper()
		body := map[string]any{"clientActionId": id, "expectedRoomVersion": room["version"]}
		for k, v := range extra {
			body[k] = v
		}
		result := scoreRequestJSON[map[string]any](t, client, method, roomURL+path, body, token, status)
		if next, ok := result["room"].(map[string]any); ok && status < 300 {
			room = next
		}
		return result
	}
	mutate(http.MethodPatch, "/zha-jin-hua/settings", "settings", hostToken, map[string]any{"settings": settings}, http.StatusOK)
	mutate(http.MethodPost, "/start", "start-room", hostToken, nil, http.StatusOK)
	mutate(http.MethodPost, "/zha-jin-hua/hands", "start-hand", hostToken, nil, http.StatusCreated)
	hand := object(t, room, "currentZhaJinHuaHand")
	if hand["potPoints"] != float64(30) || hand["currentTurnParticipantId"] != hostID {
		t.Fatalf("initial ante/turn = %v", hand)
	}
	path := "/zha-jin-hua/hands/" + hand["id"].(string)
	action := func(id, token, kind string, extra map[string]any, status int) {
		t.Helper()
		if extra == nil {
			extra = map[string]any{}
		}
		extra["actionType"] = kind
		mutate(http.MethodPost, path+"/actions", id, token, extra, status)
	}
	action("out-of-turn", guestToken, "follow", nil, http.StatusConflict)
	action("look", hostToken, "look", nil, http.StatusOK)
	if h := object(t, room, "currentZhaJinHuaHand"); h["potPoints"] != float64(30) || h["currentTurnParticipantId"] != hostID {
		t.Fatalf("looking charged or consumed turn: %v", h)
	}
	payVersion := room["version"]
	action("pay-compare", hostToken, "compare_pay", nil, http.StatusOK)
	paidVersion := room["version"]
	// Replaying the original command after a lost response must not pay twice.
	scoreRequestJSON[map[string]any](t, client, http.MethodPost, roomURL+path+"/actions", map[string]any{"clientActionId": "pay-compare", "expectedRoomVersion": payVersion, "actionType": "compare_pay"}, hostToken, http.StatusOK)
	room = object(t, scoreRequestJSON[map[string]any](t, client, http.MethodGet, roomURL, nil, hostToken, http.StatusOK), "room")
	if h := object(t, room, "currentZhaJinHuaHand"); room["version"] != paidVersion || h["potPoints"] != float64(50) {
		t.Fatalf("compare payment repeated: %v", h)
	}
	action("compare-tie", hostToken, "compare_result", map[string]any{"targetParticipantId": guestID, "outcome": "tie"}, http.StatusOK)
	if h := object(t, room, "currentZhaJinHuaHand"); h["currentTurnParticipantId"] != guestID {
		t.Fatalf("compare must advance from initiator: %v", h)
	}
	action("follow", guestToken, "follow", nil, http.StatusOK)
	action("fold", otherToken, "fold", nil, http.StatusOK)
	if h := object(t, room, "currentZhaJinHuaHand"); h["phase"] != "bonus" || h["winnerParticipantId"] != guestID || h["potPoints"] != float64(60) {
		t.Fatalf("one survivor should await bonus: %v", h)
	}
	mutate(http.MethodPost, "/zha-jin-hua/hands", "premature-next", hostToken, nil, http.StatusConflict)
	mutate(http.MethodPost, "/settle", "premature-settle", hostToken, nil, http.StatusConflict)
	bonus := map[string]any{"bonuses": []map[string]any{{"participantId": hostID, "kind": "baozi"}, {"participantId": otherID, "kind": "shunjin"}}}
	mutate(http.MethodPost, path+"/bonus", "unauthorized-bonus", "", bonus, http.StatusUnauthorized)
	mutate(http.MethodPost, path+"/bonus", "guest-bonus", guestToken, bonus, http.StatusForbidden)
	bonusVersion := room["version"]
	mutate(http.MethodPost, path+"/bonus", "confirm-bonus", hostToken, bonus, http.StatusOK)
	finishedVersion := room["version"]
	if room["currentZhaJinHuaHand"] != nil {
		t.Fatalf("hand remained current after bonus: %v", room)
	}
	bonus["clientActionId"], bonus["expectedRoomVersion"] = "confirm-bonus", bonusVersion
	replayed := scoreRequestJSON[map[string]any](t, client, http.MethodPost, roomURL+path+"/bonus", bonus, hostToken, http.StatusOK)
	if object(t, replayed, "room")["version"] != finishedVersion {
		t.Fatal("bonus replay changed version")
	}
	assertZJHBalance(t, room, hostID, 50)
	assertZJHBalance(t, room, guestID, -30)
	assertZJHBalance(t, room, otherID, -20)
	seat := func(id, token, participant, kind string, status int) {
		t.Helper()
		mutate(http.MethodPost, "/participants/"+participant+"/seat", id, token, map[string]any{"action": kind}, status)
	}
	seat("leave", otherToken, otherID, "leave", http.StatusOK)
	assertZJHBalance(t, room, otherID, -20)
	newID, _ := join("新牌友")
	seat("admit", hostToken, newID, "admit", http.StatusOK)
	seat("offer", hostToken, guestID, "offer_host", http.StatusOK)
	seat("accept", guestToken, guestID, "accept_host", http.StatusOK)
	mutate(http.MethodPost, "/zha-jin-hua/hands", "old-host", hostToken, nil, http.StatusForbidden)
	mutate(http.MethodPost, "/zha-jin-hua/hands", "next-hand", guestToken, nil, http.StatusCreated)
	if h := object(t, room, "currentZhaJinHuaHand"); h["potPoints"] != float64(30) {
		t.Fatalf("next roster includes departed player: %v", h)
	}
	newHand := object(t, room, "currentZhaJinHuaHand")["id"].(string)
	mutate(http.MethodPost, "/zha-jin-hua/hands/"+newHand+"/cancel", "cancel", guestToken, nil, http.StatusOK)
	assertZJHBalance(t, room, hostID, 50)
	mutate(http.MethodPost, "/settle", "change-fixed-rate", guestToken, map[string]any{"useSettlementRate": true, "centsPerPoint": 100}, http.StatusBadRequest)
	mutate(http.MethodPost, "/settle", "settle", guestToken, nil, http.StatusOK)
	if room["status"] != "settled" || room["centsPerPoint"] != float64(25) {
		t.Fatalf("fixed-rate settlement=%v", room)
	}
	settlement := object(t, room, "settlement")
	balances, ok := settlement["balances"].([]any)
	if !ok || len(balances) != 4 {
		t.Fatalf("settlement lost historical participants: %v", settlement)
	}
}

func TestScoreHTTPZJHV2CapShowdownAndExplicitNoBonus(t *testing.T) {
	srv := newZJHV2HTTPServer(t)
	client, base := srv.Client(), srv.URL+"/api/v1/score-rooms"
	host := scoreRequestJSON[score.CreateRoomResult](t, client, http.MethodPost, base, map[string]any{
		"name": "封顶开牌", "displayName": "房主", "maxPlayers": 2, "centsPerPoint": 50, "gameType": "zhajinhua",
		"zhaJinHuaSettings": map[string]any{"rulesVersion": 2, "antePoints": 10, "maxBetPoints": 20, "compareThreshold": 2},
	}, "", http.StatusCreated)
	guest := scoreRequestJSON[score.JoinRoomResult](t, client, http.MethodPost, base+"/join", map[string]any{
		"code": host.Room.Code, "displayName": "牌友",
	}, "", http.StatusCreated)
	room, url := guest.Room, base+"/"+host.Room.ID
	sequence := 0
	command := func(path, token string, extra map[string]any, status int) {
		t.Helper()
		sequence++
		body := map[string]any{"clientActionId": "cap-http-" + strconv.Itoa(sequence), "expectedRoomVersion": room.Version}
		for key, value := range extra {
			body[key] = value
		}
		response := scoreRequestJSON[scoreRoomResponse](t, client, http.MethodPost, url+path, body, token, status)
		if status < 300 {
			room = response.Room
		}
	}
	command("/start", host.GuestToken, nil, http.StatusOK)
	command("/zha-jin-hua/hands", host.GuestToken, nil, http.StatusCreated)
	path := "/zha-jin-hua/hands/" + room.CurrentZhaJinHuaHand.ID
	command(path+"/actions", host.GuestToken, map[string]any{"actionType": "showdown", "winnerParticipantId": host.Actor.ParticipantID}, http.StatusConflict)
	command(path+"/actions", host.GuestToken, map[string]any{"actionType": "raise", "points": 20}, http.StatusOK)
	if hand := room.CurrentZhaJinHuaHand; hand.PotPoints != 40 || hand.CapCirclesRemaining != 3 {
		t.Fatalf("cap trigger = %+v", hand)
	}
	for i := 0; i < 6; i++ {
		token := host.GuestToken
		if room.CurrentZhaJinHuaHand.CurrentTurnParticipantID == guest.Actor.ParticipantID {
			token = guest.GuestToken
		}
		command(path+"/actions", token, map[string]any{"actionType": "follow"}, http.StatusOK)
		if hand := room.CurrentZhaJinHuaHand; hand.CapCirclesRemaining != 3-(i+1)/2 || (i < 5 && hand.Phase != "betting") {
			t.Fatalf("additional turn %d: %+v", i+1, hand)
		}
	}
	if hand := room.CurrentZhaJinHuaHand; hand.Phase != "showdown" || hand.PotPoints != 160 {
		t.Fatalf("forced showdown = %+v", hand)
	}
	command(path+"/actions", guest.GuestToken, map[string]any{"actionType": "showdown", "winnerParticipantId": host.Actor.ParticipantID}, http.StatusForbidden)
	command(path+"/actions", host.GuestToken, map[string]any{"actionType": "showdown", "winnerParticipantId": host.Actor.ParticipantID}, http.StatusOK)
	command(path+"/bonus", host.GuestToken, nil, http.StatusBadRequest)
	command(path+"/bonus", host.GuestToken, map[string]any{"bonuses": nil}, http.StatusBadRequest)
	command(path+"/bonus", host.GuestToken, map[string]any{"bonuses": []any{}}, http.StatusOK)
	if room.CurrentZhaJinHuaHand != nil || len(room.ZhaJinHuaHands) != 1 {
		t.Fatalf("explicit no-bonus did not finish: %+v", room)
	}
	for _, p := range room.Participants {
		want := int64(-70)
		if p.ID == host.Actor.ParticipantID {
			want = 70
		}
		if p.TotalPoints != want {
			t.Fatalf("no-bonus points=%d want%d", p.TotalPoints, want)
		}
	}
}

func TestScoreHTTPZJHV2CreatesUnlimitedRoom(t *testing.T) {
	srv := newZJHV2HTTPServer(t)
	client, base := srv.Client(), srv.URL+"/api/v1/score-rooms"
	settings := map[string]any{"rulesVersion": 2, "antePoints": 1, "maxBetPoints": 10, "compareThreshold": 3, "baoziBonusPoints": 10, "shunjinBonusPoints": 5}
	created := scoreRequestJSON[map[string]any](t, client, http.MethodPost, base, map[string]any{
		"name": "不限人数金花局", "displayName": "房主", "maxPlayers": 0, "centsPerPoint": 100,
		"scene": "zhajinhua", "gameType": "zhajinhua", "zhaJinHuaSettings": settings,
	}, "", http.StatusCreated)
	room := object(t, created, "room")
	if room["maxPlayers"] != float64(0) || room["centsPerPoint"] != float64(100) {
		t.Fatalf("unlimited room creation lost defaults: %v", room)
	}
}

func newZJHV2HTTPServer(t *testing.T) *httptest.Server {
	t.Helper()
	temp := t.TempDir()
	db := filepath.Join(temp, "funbox.db")
	users, err := user.OpenStore(db)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = users.Close() })
	socials, err := social.OpenStore(db)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socials.Close() })
	scores, err := score.OpenStore(db)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = scores.Close() })
	cfg := config.Config{Auth: config.AuthConfig{TokenTTL: time.Hour}, Server: config.ServerConfig{Host: "127.0.0.1", ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second}, Security: config.SecurityConfig{MaxRequestBodyBytes: 64 << 10, RateLimitMax: 500, RateLimitWindow: time.Minute}, Storage: config.StorageConfig{AvatarDir: filepath.Join(temp, "avatars"), MaxAvatarBytes: 1 << 20}}
	key := []byte(strings.Repeat("v", 32))
	api := NewServer(cfg, nil, nil, auth.NewService(users, key, time.Hour), socials, nil, score.NewService(scores, key, 7*24*time.Hour))
	srv := httptest.NewServer(api.Handler)
	t.Cleanup(srv.Close)
	return srv
}

func object(t *testing.T, parent map[string]any, key string) map[string]any {
	t.Helper()
	v, ok := parent[key].(map[string]any)
	if !ok {
		t.Fatalf("%s is not an object: %v", key, parent)
	}
	return v
}
func assertZJHBalance(t *testing.T, room map[string]any, id string, want float64) {
	t.Helper()
	for _, raw := range room["participants"].([]any) {
		p := raw.(map[string]any)
		if p["id"] == id {
			if p["totalPoints"] != want {
				t.Fatalf("participant %s total=%v want %v", id, p["totalPoints"], want)
			}
			return
		}
	}
	t.Fatalf("participant %s disappeared", id)
}
