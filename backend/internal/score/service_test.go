package score

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOpenStoreCreatesScoreSchema(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "score.db"))
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	for _, table := range []string{
		"score_rooms",
		"score_participants",
		"score_rounds",
		"score_entries",
		"score_confirmations",
		"score_gift_batches",
		"score_point_gifts",
		"score_room_events",
		"score_command_receipts",
		"score_settlements",
		"score_room_game_configs",
		"score_zjh_hands",
		"score_zjh_hand_players",
		"score_zjh_actions",
		"score_zjh_ledger",
	} {
		var name string
		err := store.db.QueryRowContext(
			context.Background(),
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
			table,
		).Scan(&name)
		if err != nil {
			t.Fatalf("table %s was not created: %v", table, err)
		}
		if name != table {
			t.Fatalf("table lookup = %q, want %q", name, table)
		}
	}
}

func TestOpenStoreMigratesLegacyRoomSchema(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "legacy-score.db")
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
		CREATE TABLE score_rooms (
			id TEXT PRIMARY KEY,
			code TEXT NOT NULL CHECK(length(code) = 6),
			host_user_id TEXT NOT NULL,
			name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
			mode TEXT NOT NULL CHECK(mode IN ('generic')),
			status TEXT NOT NULL CHECK(status IN ('waiting', 'active', 'settled', 'cancelled')),
			max_players INTEGER NOT NULL CHECK(max_players BETWEEN 2 AND 8),
			cents_per_point INTEGER NOT NULL CHECK(cents_per_point BETWEEN 1 AND 1000000),
			version INTEGER NOT NULL CHECK(version >= 1),
			event_sequence INTEGER NOT NULL DEFAULT 0 CHECK(event_sequence >= 0),
			created_at INTEGER NOT NULL,
			started_at INTEGER,
			settled_at INTEGER,
			cancelled_at INTEGER,
			expires_at INTEGER NOT NULL
		);
		INSERT INTO score_rooms (
			id, code, host_user_id, name, mode, status, max_players,
			cents_per_point, version, event_sequence, created_at, expires_at
		) VALUES ('legacy-room', '123456', 'user-1', '旧牌局', 'generic', 'waiting', 4, 50, 1, 0, 1, 2);
	`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	room, err := store.loadRoomSnapshot(context.Background(), store.db, "legacy-room")
	if err != nil {
		t.Fatal(err)
	}
	if room.GameType != GameTypeGeneric || room.CapPoints != 0 || room.RequiresPassword || room.Latitude != nil || room.Longitude != nil {
		t.Fatalf("migrated legacy room = %+v", room)
	}
}

func TestServiceConfirmsZeroSumRoundAndSettles(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()

	created, err := service.CreateRoom(ctx, "host-user", "Host", CreateRoomInput{
		Name: "Friday game", MaxPlayers: 4, CentsPerPoint: 50,
	})
	if err != nil {
		t.Fatal(err)
	}
	guest, err := service.JoinRoom(ctx, JoinRoomInput{
		Code: created.Room.Code, DisplayName: "Chen",
	})
	if err != nil {
		t.Fatal(err)
	}

	room, err := service.StartRoom(ctx, created.Actor, commandMeta("start-room", guest.Room))
	if err != nil {
		t.Fatal(err)
	}
	room, err = service.StartRound(ctx, created.Actor, commandMeta("start-round", room), StartRoundInput{})
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentRound == nil {
		t.Fatal("StartRound() did not create a current round")
	}
	roundID := room.CurrentRound.ID

	room, err = service.SubmitEntry(ctx, created.Actor, commandMeta("host-entry", room), roundID, 10)
	if err != nil {
		t.Fatal(err)
	}
	room, err = service.SubmitEntry(ctx, guest.Actor, commandMeta("guest-entry", room), roundID, -10)
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentRound == nil || room.CurrentRound.Status != RoundReview {
		t.Fatalf("round after entries = %+v", room.CurrentRound)
	}

	room, err = service.ConfirmRound(ctx, created.Actor, commandMeta("host-confirm", room), roundID)
	if err != nil {
		t.Fatal(err)
	}
	final, err := service.ConfirmRound(ctx, guest.Actor, commandMeta("guest-confirm", room), roundID)
	if err != nil {
		t.Fatal(err)
	}
	if final.CurrentRound != nil || len(final.Rounds) != 1 || final.Rounds[0].Status != RoundConfirmed {
		t.Fatalf("room after confirmation = %+v", final)
	}

	settled, err := service.SettleRoom(ctx, created.Actor, commandMeta("settle", final), SettleRoomInput{})
	if err != nil {
		t.Fatal(err)
	}
	if settled.Settlement == nil || len(settled.Settlement.Transfers) != 1 {
		t.Fatalf("settlement = %+v", settled.Settlement)
	}
	transfer := settled.Settlement.Transfers[0]
	if transfer.FromParticipantID != guest.Actor.ParticipantID || transfer.ToParticipantID != created.Actor.ParticipantID || transfer.AmountCents != 500 {
		t.Fatalf("transfer = %+v", transfer)
	}
}

func TestServiceDirectGiftBatchUsesDefaultRateAndSettlesWithOverride(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()

	created, err := service.CreateRoom(ctx, "host-user", "Host", CreateRoomInput{
		Name: "Friday game", MaxPlayers: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Room.CentsPerPoint != 100 {
		t.Fatalf("default cents per point = %d, want 100", created.Room.CentsPerPoint)
	}
	guest, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest"})
	if err != nil {
		t.Fatal(err)
	}
	third, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Third"})
	if err != nil {
		t.Fatal(err)
	}
	room, err := service.StartRoom(ctx, created.Actor, commandMeta("start-room", third.Room))
	if err != nil {
		t.Fatal(err)
	}

	room, err = service.SubmitGifts(ctx, created.Actor, commandMeta("host-gifts", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{
			{ToParticipantID: guest.Actor.ParticipantID, Points: 10},
			{ToParticipantID: third.Actor.ParticipantID, Points: 5},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentRound != nil {
		t.Fatalf("direct gifts unexpectedly created a current round: %+v", room.CurrentRound)
	}
	if len(room.GiftBatches) != 1 || len(room.GiftBatches[0].Gifts) != 2 {
		t.Fatalf("gift batches = %+v", room.GiftBatches)
	}
	assertTotalPoints := func(participantID string, want int64) {
		t.Helper()
		for _, participant := range room.Participants {
			if participant.ID == participantID {
				if participant.TotalPoints != want {
					t.Fatalf("participant %s total = %d, want %d", participantID, participant.TotalPoints, want)
				}
				return
			}
		}
		t.Fatalf("participant %s not found", participantID)
	}
	assertTotalPoints(created.Actor.ParticipantID, -15)
	assertTotalPoints(guest.Actor.ParticipantID, 10)
	assertTotalPoints(third.Actor.ParticipantID, 5)

	if _, err := service.SettleRoom(ctx, guest.Actor, commandMeta("guest-settle", room), SettleRoomInput{CentsPerPoint: 300}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest settlement error = %v, want ErrForbidden", err)
	}
	settled, err := service.SettleRoom(ctx, created.Actor, commandMeta("settle", room), SettleRoomInput{CentsPerPoint: 200})
	if err != nil {
		t.Fatal(err)
	}
	if settled.CentsPerPoint != 200 || settled.Settlement == nil || len(settled.Settlement.Transfers) != 2 {
		t.Fatalf("settled room = %+v", settled)
	}
	transfers := make(map[string]int64)
	for _, transfer := range settled.Settlement.Transfers {
		if transfer.FromParticipantID != created.Actor.ParticipantID {
			t.Fatalf("transfer from = %s, want host", transfer.FromParticipantID)
		}
		transfers[transfer.ToParticipantID] = transfer.AmountCents
	}
	if transfers[guest.Actor.ParticipantID] != 2000 || transfers[third.Actor.ParticipantID] != 1000 {
		t.Fatalf("settlement transfers = %+v", settled.Settlement.Transfers)
	}
	if _, err := service.SettleRoom(ctx, created.Actor, commandMeta("settle-again", settled), SettleRoomInput{CentsPerPoint: 50}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("second settlement error = %v, want ErrInvalidState", err)
	}
}

func TestServiceMahjongInvitePasswordCapHintNearbyAndLockedSettlementRate(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	latitude, longitude := 30.5728, 104.0668
	created, err := service.CreateRoom(ctx, "host-user", "Host", CreateRoomInput{
		Name: "周五麻将", GameType: GameTypeMahjong, Password: "1234",
		MaxPlayers: 4, CentsPerPoint: 200, CapPoints: 5,
		Latitude: &latitude, Longitude: &longitude,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Room.GameType != GameTypeMahjong || !created.Room.RequiresPassword ||
		created.Room.CapPoints != 5 || created.Room.CentsPerPoint != 200 {
		t.Fatalf("mahjong room = %+v", created.Room)
	}
	encodedRoom, err := json.Marshal(created.Room)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encodedRoom), "1234") || strings.Contains(string(encodedRoom), created.Room.PasswordHash) {
		t.Fatal("room response leaked room password material")
	}
	if _, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest"}); !errors.Is(err, ErrPasswordRequired) {
		t.Fatalf("missing password error = %v", err)
	}
	if _, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest", Password: "9999"}); !errors.Is(err, ErrPasswordInvalid) {
		t.Fatalf("invalid password error = %v", err)
	}
	guest, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest", Password: "1234"})
	if err != nil {
		t.Fatal(err)
	}
	invitedGuest, err := service.JoinRoom(ctx, JoinRoomInput{InviteToken: created.InviteToken, DisplayName: "Invited Guest"})
	if err != nil {
		t.Fatalf("join with invite without password: %v", err)
	}
	nearby, err := service.ListNearbyRooms(ctx, NearbyRoomsInput{
		Latitude: latitude + 0.001, Longitude: longitude, RadiusMeters: 3000, GameType: GameTypeMahjong,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(nearby.Rooms) != 1 || nearby.Rooms[0].Code != created.Room.Code || !nearby.Rooms[0].RequiresPassword {
		t.Fatalf("nearby rooms = %+v", nearby.Rooms)
	}
	farAway, err := service.ListNearbyRooms(ctx, NearbyRoomsInput{
		Latitude: latitude + 0.2, Longitude: longitude, RadiusMeters: 1000, GameType: GameTypeMahjong,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(farAway.Rooms) != 0 {
		t.Fatalf("far nearby rooms = %+v", farAway.Rooms)
	}
	defaults, err := service.CreateRoom(ctx, "default-host", "Default Host", CreateRoomInput{
		Name: "默认麻将", GameType: GameTypeMahjong, Password: "5678",
	})
	if err != nil {
		t.Fatal(err)
	}
	if defaults.Room.MaxPlayers != 4 || defaults.Room.CentsPerPoint != 100 || defaults.Room.CapPoints != 10 {
		t.Fatalf("mahjong defaults = %+v", defaults.Room)
	}

	room, err := service.StartRoom(ctx, created.Actor, commandMeta("start-mahjong", invitedGuest.Room))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartRound(ctx, created.Actor, commandMeta("mahjong-round", room), StartRoundInput{}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("mahjong start round error = %v, want ErrInvalidState", err)
	}
	room, err = service.SubmitGifts(ctx, created.Actor, commandMeta("over-cap", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{{ToParticipantID: guest.Actor.ParticipantID, Points: 6}},
	})
	if err != nil {
		t.Fatalf("over-cap gift should be accepted as a hint: %v", err)
	}
	if invitedGuest.Actor.ParticipantID == "" {
		t.Fatal("invited guest participant id is empty")
	}
	settled, err := service.SettleRoom(ctx, created.Actor, commandMeta("settle-mahjong", room), SettleRoomInput{CentsPerPoint: 999})
	if err != nil {
		t.Fatal(err)
	}
	if settled.CentsPerPoint != 200 || settled.Settlement == nil || len(settled.Settlement.Transfers) != 1 ||
		settled.Settlement.Transfers[0].AmountCents != 1200 {
		t.Fatalf("mahjong settlement = %+v", settled)
	}
}

func TestServiceAnyActiveParticipantCanSubmitGifts(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	created, guest, room := startTwoPlayerRoom(t, service)

	room, err := service.SubmitGifts(ctx, guest.Actor, commandMeta("guest-gifts", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{{ToParticipantID: created.Actor.ParticipantID, Points: 3}},
	})
	if err != nil {
		t.Fatalf("guest should be able to submit gifts: %v", err)
	}
	if len(room.GiftBatches) != 1 || room.GiftBatches[0].CreatedBy != guest.Actor.ParticipantID {
		t.Fatalf("guest gift batch = %+v", room.GiftBatches)
	}
}

func TestServiceZhaJinHuaTurnPotForceOpenAndSettlement(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()

	created, err := service.CreateRoom(ctx, "host-user", "Host", CreateRoomInput{
		Name: "炸金花", MaxPlayers: 4, CentsPerPoint: 50, Scene: SceneZhaJinHua,
		ForceOpenThreshold: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Room.Scene != SceneZhaJinHua || created.Room.GameType != GameTypeZhaJinHua || created.Room.ZhaJinHuaSettings.ForceOpenThreshold != 2 {
		t.Fatalf("created zha jin hua room = %+v", created.Room)
	}
	guest, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest"})
	if err != nil {
		t.Fatal(err)
	}
	third, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Third"})
	if err != nil {
		t.Fatal(err)
	}
	room, err := service.StartRoom(ctx, created.Actor, commandMeta("start-room", third.Room))
	if err != nil {
		t.Fatal(err)
	}
	room, err = service.StartZhaJinHuaHand(ctx, created.Actor, commandMeta("start-hand", room))
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentZhaJinHuaHand == nil || len(room.CurrentZhaJinHuaHand.Players) != 3 ||
		room.CurrentZhaJinHuaHand.CurrentTurnParticipantID != created.Actor.ParticipantID {
		t.Fatalf("started zha jin hua hand = %+v", room.CurrentZhaJinHuaHand)
	}
	handID := room.CurrentZhaJinHuaHand.ID
	if _, err := service.SettleRoom(ctx, created.Actor, commandMeta("settle-active-hand", room), SettleRoomInput{}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("settle active zha jin hua hand error = %v, want ErrInvalidState", err)
	}
	if _, err := service.RemoveParticipant(ctx, created.Actor, commandMeta("remove-active-hand", room), guest.Actor.ParticipantID); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("remove during zha jin hua hand error = %v, want ErrInvalidState", err)
	}
	if _, err := service.SubmitGifts(ctx, created.Actor, commandMeta("generic-gift-in-zjh", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{{ToParticipantID: guest.Actor.ParticipantID, Points: 1}},
	}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("generic gift in zha jin hua room error = %v, want ErrInvalidState", err)
	}
	if _, err := service.SubmitZhaJinHuaAction(ctx, created.Actor, commandMeta("open-without-bet", room), handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionForceOpen, TargetParticipantID: guest.Actor.ParticipantID,
		WinnerParticipantID: created.Actor.ParticipantID,
	}); !errors.Is(err, ErrForceOpenLocked) {
		t.Fatalf("force open before any bet error = %v, want ErrForceOpenLocked", err)
	}

	if _, err := service.SubmitZhaJinHuaAction(ctx, guest.Actor, commandMeta("out-of-turn", room), handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionRaise, Points: 1,
	}); !errors.Is(err, ErrNotYourTurn) {
		t.Fatalf("out-of-turn action error = %v, want ErrNotYourTurn", err)
	}
	if _, err := service.SubmitZhaJinHuaAction(ctx, created.Actor, commandMeta("locked-open", room), handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionForceOpen, TargetParticipantID: guest.Actor.ParticipantID,
		WinnerParticipantID: created.Actor.ParticipantID,
	}); !errors.Is(err, ErrForceOpenLocked) {
		t.Fatalf("locked force open error = %v, want ErrForceOpenLocked", err)
	}

	raiseMeta := commandMeta("host-raise", room)
	room, err = service.SubmitZhaJinHuaAction(ctx, created.Actor, raiseMeta, handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionRaise, Points: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentZhaJinHuaHand.CurrentBetPoints != 10 {
		t.Fatalf("current bet after raise = %d, want 10", room.CurrentZhaJinHuaHand.CurrentBetPoints)
	}
	repeated, err := service.SubmitZhaJinHuaAction(ctx, created.Actor, raiseMeta, handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionRaise, Points: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if repeated.Version != room.Version || repeated.CurrentZhaJinHuaHand.PotPoints != 10 {
		t.Fatalf("repeated raise changed pot: first=%+v repeated=%+v", room.CurrentZhaJinHuaHand, repeated.CurrentZhaJinHuaHand)
	}
	room, err = service.SubmitZhaJinHuaAction(ctx, guest.Actor, commandMeta("guest-raise", room), handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionRaise, Points: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	room, err = service.SubmitZhaJinHuaAction(ctx, third.Actor, commandMeta("third-fold", room), handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionFold,
	})
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentZhaJinHuaHand.PotPoints != 20 || room.CurrentZhaJinHuaHand.CurrentTurnParticipantID != created.Actor.ParticipantID {
		t.Fatalf("hand after fold = %+v", room.CurrentZhaJinHuaHand)
	}
	room, err = service.SubmitZhaJinHuaAction(ctx, created.Actor, commandMeta("host-force-open", room), handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionForceOpen, TargetParticipantID: guest.Actor.ParticipantID,
		WinnerParticipantID: created.Actor.ParticipantID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentZhaJinHuaHand != nil || len(room.ZhaJinHuaHands) != 1 ||
		room.ZhaJinHuaHands[0].WinnerParticipantID != created.Actor.ParticipantID ||
		room.ZhaJinHuaHands[0].PotPoints != 30 || room.ZhaJinHuaHands[0].CurrentBetPoints != 10 ||
		len(room.ZhaJinHuaHands[0].Actions) != 4 {
		t.Fatalf("finished zha jin hua hand = current:%+v history:%+v", room.CurrentZhaJinHuaHand, room.ZhaJinHuaHands)
	}
	totals := make(map[string]int64)
	for _, participant := range room.Participants {
		totals[participant.ID] = participant.TotalPoints
	}
	if totals[created.Actor.ParticipantID] != 10 || totals[guest.Actor.ParticipantID] != -10 || totals[third.Actor.ParticipantID] != 0 {
		t.Fatalf("zha jin hua totals = %+v", totals)
	}
	settled, err := service.SettleRoom(ctx, created.Actor, commandMeta("settle", room), SettleRoomInput{CentsPerPoint: 50})
	if err != nil {
		t.Fatal(err)
	}
	if settled.Settlement == nil || len(settled.Settlement.Transfers) != 1 ||
		settled.Settlement.Transfers[0].FromParticipantID != guest.Actor.ParticipantID ||
		settled.Settlement.Transfers[0].ToParticipantID != created.Actor.ParticipantID ||
		settled.Settlement.Transfers[0].AmountCents != 500 {
		t.Fatalf("zha jin hua settlement = %+v", settled.Settlement)
	}
}

func TestServiceZhaJinHuaSettingsApplyToNextHand(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()

	created, err := service.CreateRoom(ctx, "host-user", "Host", CreateRoomInput{
		Name: "炸金花", MaxPlayers: 3, Scene: SceneZhaJinHua,
		ForceOpenThreshold: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	guest, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest"})
	if err != nil {
		t.Fatal(err)
	}
	room, err := service.StartRoom(ctx, created.Actor, commandMeta("start-room", guest.Room))
	if err != nil {
		t.Fatal(err)
	}
	room, err = service.StartZhaJinHuaHand(ctx, created.Actor, commandMeta("start-hand", room))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateZhaJinHuaSettings(ctx, created.Actor, commandMeta("update-during-hand", room), UpdateZhaJinHuaSettingsInput{
		ForceOpenThreshold: 3,
	}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("update during hand error = %v, want ErrInvalidState", err)
	}
	room, err = service.CancelZhaJinHuaHand(ctx, created.Actor, commandMeta("cancel-hand", room), room.CurrentZhaJinHuaHand.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateZhaJinHuaSettings(ctx, guest.Actor, commandMeta("guest-update", room), UpdateZhaJinHuaSettingsInput{
		ForceOpenThreshold: 3,
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest update error = %v, want ErrForbidden", err)
	}
	room, err = service.UpdateZhaJinHuaSettings(ctx, created.Actor, commandMeta("host-update", room), UpdateZhaJinHuaSettingsInput{
		ForceOpenThreshold: 3,
	})
	if err != nil {
		t.Fatal(err)
	}
	room, err = service.StartZhaJinHuaHand(ctx, created.Actor, commandMeta("next-hand", room))
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentZhaJinHuaHand == nil || room.CurrentZhaJinHuaHand.ForceOpenThreshold != 3 {
		t.Fatalf("next hand settings = %+v", room.CurrentZhaJinHuaHand)
	}
	handID := room.CurrentZhaJinHuaHand.ID
	room, err = service.SubmitZhaJinHuaAction(ctx, created.Actor, commandMeta("next-host-five", room), handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionRaise, Points: 5,
	})
	if err != nil {
		t.Fatal(err)
	}
	room, err = service.SubmitZhaJinHuaAction(ctx, guest.Actor, commandMeta("next-guest-five", room), handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionRaise, Points: 5,
	})
	if err != nil {
		t.Fatal(err)
	}
	room, err = service.SubmitZhaJinHuaAction(ctx, created.Actor, commandMeta("next-host-open", room), handID, ZhaJinHuaActionInput{
		ActionType: ZhaJinHuaActionForceOpen, TargetParticipantID: guest.Actor.ParticipantID,
		WinnerParticipantID: created.Actor.ParticipantID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(room.ZhaJinHuaHands) != 1 || room.ZhaJinHuaHands[0].PotPoints != 15 ||
		room.ZhaJinHuaHands[0].CurrentBetPoints != 5 {
		t.Fatalf("five point force open = %+v", room.ZhaJinHuaHands)
	}
}

func TestServiceRejectsInvalidGiftBatchesAndReversesValidBatch(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	created, guest, room := startTwoPlayerRoom(t, service)

	for name, input := range map[string]SubmitGiftsInput{
		"empty": {Allocations: nil},
		"self":  {Allocations: []GiftAllocationInput{{ToParticipantID: created.Actor.ParticipantID, Points: 1}}},
		"zero":  {Allocations: []GiftAllocationInput{{ToParticipantID: guest.Actor.ParticipantID, Points: 0}}},
		"duplicate": {Allocations: []GiftAllocationInput{
			{ToParticipantID: guest.Actor.ParticipantID, Points: 1},
			{ToParticipantID: guest.Actor.ParticipantID, Points: 2},
		}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := service.SubmitGifts(ctx, created.Actor, commandMeta("invalid-"+name, room), input); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("SubmitGifts() error = %v, want ErrInvalidInput", err)
			}
		})
	}

	room, err := service.SubmitGifts(ctx, created.Actor, commandMeta("valid-gift", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{{ToParticipantID: guest.Actor.ParticipantID, Points: 4}},
	})
	if err != nil {
		t.Fatal(err)
	}
	batchID := room.GiftBatches[0].ID
	if _, err := service.ReverseGiftBatch(ctx, guest.Actor, commandMeta("guest-reverse", room), batchID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest reversal error = %v, want ErrForbidden", err)
	}
	room, err = service.ReverseGiftBatch(ctx, created.Actor, commandMeta("host-reverse", room), batchID)
	if err != nil {
		t.Fatal(err)
	}
	if len(room.GiftBatches) != 2 || room.GiftBatches[0].Kind != RoundReversal {
		t.Fatalf("reversed gift batches = %+v", room.GiftBatches)
	}
	for _, participant := range room.Participants {
		if participant.TotalPoints != 0 {
			t.Fatalf("participant %s total after reversal = %d, want 0", participant.ID, participant.TotalPoints)
		}
	}
	if _, err := service.ReverseGiftBatch(ctx, created.Actor, commandMeta("second-reverse", room), batchID); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("second reversal error = %v, want ErrInvalidState", err)
	}
}

func TestServicePreviewInvite(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()

	created, err := service.CreateRoom(ctx, "host-user", "Host", CreateRoomInput{
		Name: "Friday game", MaxPlayers: 2, CentsPerPoint: 50,
	})
	if err != nil {
		t.Fatal(err)
	}

	anonymous, err := service.PreviewInvite(ctx, "", InvitePreviewInput{InviteToken: created.InviteToken})
	if err != nil {
		t.Fatalf("anonymous preview error = %v", err)
	}
	if anonymous.Room.Code != created.Room.Code || anonymous.SelfParticipantID != "" {
		t.Fatalf("anonymous preview = %+v", anonymous)
	}

	hostPreview, err := service.PreviewInvite(ctx, "host-user", InvitePreviewInput{InviteToken: created.InviteToken})
	if err != nil {
		t.Fatalf("host preview error = %v", err)
	}
	if hostPreview.SelfParticipantID != created.Actor.ParticipantID {
		t.Fatalf("host preview self id = %q, want %q", hostPreview.SelfParticipantID, created.Actor.ParticipantID)
	}

	guest, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest"})
	if err != nil {
		t.Fatal(err)
	}
	if guest.Room.Status != RoomWaiting {
		t.Fatalf("room status = %q", guest.Room.Status)
	}
	if _, err := service.PreviewInvite(ctx, "", InvitePreviewInput{InviteToken: created.InviteToken}); !errors.Is(err, ErrRoomFull) {
		t.Fatalf("full room preview error = %v", err)
	}

	if _, err := service.PreviewInvite(ctx, "", InvitePreviewInput{InviteToken: "not-a-real-token"}); !errors.Is(err, ErrInviteInvalid) {
		t.Fatalf("invalid invite error = %v", err)
	}
}

func TestServiceCommandIdempotencyAndVersionConflict(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	created, guest, room := startTwoPlayerRoom(t, service)

	meta := commandMeta("start-round-once", room)
	first, err := service.StartRound(ctx, created.Actor, meta, StartRoundInput{})
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := service.StartRound(ctx, created.Actor, meta, StartRoundInput{})
	if err != nil {
		t.Fatal(err)
	}
	if repeated.Version != first.Version || repeated.CurrentRound == nil || repeated.CurrentRound.ID != first.CurrentRound.ID {
		t.Fatalf("repeated command changed result: first=%+v repeated=%+v", first, repeated)
	}

	entryMeta := commandMeta("entry-action", first)
	entryResult, err := service.SubmitEntry(ctx, created.Actor, entryMeta, first.CurrentRound.ID, 4)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.SubmitEntry(ctx, created.Actor, entryMeta, first.CurrentRound.ID, 5)
	if !errors.Is(err, ErrActionIDReused) {
		t.Fatalf("reused action with new body error = %v", err)
	}
	_, err = service.SubmitEntry(ctx, guest.Actor, CommandMeta{
		ClientActionID: "stale-guest-entry", ExpectedRoomVersion: first.Version,
	}, first.CurrentRound.ID, -4)
	if !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale command error = %v", err)
	}
	var conflict *VersionConflictError
	if !errors.As(err, &conflict) || conflict.Latest.Version != entryResult.Version {
		t.Fatalf("version conflict = %+v", conflict)
	}
}

func TestServiceEditingEntryResetsConfirmations(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	created, guest, room := startTwoPlayerRoom(t, service)

	room, err := service.StartRound(ctx, created.Actor, commandMeta("round", room), StartRoundInput{})
	if err != nil {
		t.Fatal(err)
	}
	roundID := room.CurrentRound.ID
	room, err = service.SubmitEntry(ctx, created.Actor, commandMeta("host-10", room), roundID, 10)
	if err != nil {
		t.Fatal(err)
	}
	room, err = service.SubmitEntry(ctx, guest.Actor, commandMeta("guest-10", room), roundID, -10)
	if err != nil {
		t.Fatal(err)
	}
	room, err = service.ConfirmRound(ctx, created.Actor, commandMeta("host-confirm", room), roundID)
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentRound.ConfirmedCount != 1 {
		t.Fatalf("confirmation count = %d", room.CurrentRound.ConfirmedCount)
	}

	room, err = service.SubmitEntry(ctx, created.Actor, commandMeta("host-edit", room), roundID, 12)
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentRound.Status != RoundCollecting || room.CurrentRound.ConfirmedCount != 0 || room.CurrentRound.TotalDelta != 2 {
		t.Fatalf("round after edit = %+v", room.CurrentRound)
	}
	room, err = service.SubmitEntry(ctx, guest.Actor, commandMeta("guest-edit", room), roundID, -12)
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentRound.Status != RoundReview || room.CurrentRound.ConfirmedCount != 0 {
		t.Fatalf("round after balancing = %+v", room.CurrentRound)
	}
}

func TestServiceReversalPreservesAuditTrail(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	created, guest, room := startTwoPlayerRoom(t, service)

	room, err := service.StartRound(ctx, created.Actor, commandMeta("round-1", room), StartRoundInput{})
	if err != nil {
		t.Fatal(err)
	}
	sourceID := room.CurrentRound.ID
	room, _ = service.SubmitEntry(ctx, created.Actor, commandMeta("host-entry", room), sourceID, 6)
	room, _ = service.SubmitEntry(ctx, guest.Actor, commandMeta("guest-entry", room), sourceID, -6)
	room, _ = service.ConfirmRound(ctx, created.Actor, commandMeta("host-confirm", room), sourceID)
	room, err = service.ConfirmRound(ctx, guest.Actor, commandMeta("guest-confirm", room), sourceID)
	if err != nil {
		t.Fatal(err)
	}

	room, err = service.StartRound(ctx, created.Actor, commandMeta("reverse", room), StartRoundInput{ReversesRoundID: sourceID})
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentRound == nil || room.CurrentRound.Kind != RoundReversal || room.CurrentRound.ReversesRoundID != sourceID || room.CurrentRound.Status != RoundReview {
		t.Fatalf("reversal round = %+v", room.CurrentRound)
	}
	if room.CurrentRound.Entries[0].DeltaPoints != -6 || room.CurrentRound.Entries[1].DeltaPoints != 6 {
		t.Fatalf("reversal entries = %+v", room.CurrentRound.Entries)
	}
	reversalID := room.CurrentRound.ID
	room, _ = service.ConfirmRound(ctx, created.Actor, commandMeta("host-reverse-confirm", room), reversalID)
	room, err = service.ConfirmRound(ctx, guest.Actor, commandMeta("guest-reverse-confirm", room), reversalID)
	if err != nil {
		t.Fatal(err)
	}
	if len(room.Rounds) != 2 || room.Participants[0].TotalPoints != 0 || room.Participants[1].TotalPoints != 0 {
		t.Fatalf("room after reversal = %+v", room)
	}
}

func TestServiceRemovalInvalidatesGuestToken(t *testing.T) {
	service := newTestService(t)
	ctx := context.Background()
	created, err := service.CreateRoom(ctx, "host-user", "Host", CreateRoomInput{Name: "Game", MaxPlayers: 4, CentsPerPoint: 10})
	if err != nil {
		t.Fatal(err)
	}
	guest, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.AuthenticateGuestToken(ctx, guest.GuestToken); err != nil {
		t.Fatalf("fresh token error = %v", err)
	}
	room, err := service.RemoveParticipant(ctx, created.Actor, commandMeta("remove", guest.Room), guest.Actor.ParticipantID)
	if err != nil {
		t.Fatal(err)
	}
	if room.Participants[1].Status != ParticipantRemoved {
		t.Fatalf("removed participant = %+v", room.Participants[1])
	}
	if _, err := service.AuthenticateGuestToken(ctx, guest.GuestToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("removed guest token error = %v", err)
	}
}

func startTwoPlayerRoom(t *testing.T, service *Service) (CreateRoomResult, JoinRoomResult, RoomSnapshot) {
	t.Helper()
	ctx := context.Background()
	created, err := service.CreateRoom(ctx, "host-user", "Host", CreateRoomInput{Name: "Game", MaxPlayers: 4, CentsPerPoint: 50})
	if err != nil {
		t.Fatal(err)
	}
	guest, err := service.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest"})
	if err != nil {
		t.Fatal(err)
	}
	room, err := service.StartRoom(ctx, created.Actor, commandMeta("start-room", guest.Room))
	if err != nil {
		t.Fatal(err)
	}
	return created, guest, room
}

func newTestService(t *testing.T) *Service {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "score.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return NewService(store, []byte("test-score-signing-key-with-enough-bytes"), 7*24*time.Hour)
}

func commandMeta(actionID string, room RoomSnapshot) CommandMeta {
	return CommandMeta{ClientActionID: actionID, ExpectedRoomVersion: room.Version}
}

func TestScoreSchemaRejectsDuplicateRoomNickname(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "score.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ctx := context.Background()
	_, err = store.db.ExecContext(ctx, `
		INSERT INTO score_rooms (
			id, code, host_user_id, name, mode, status, max_players,
			cents_per_point, version, event_sequence, created_at, expires_at
		) VALUES ('room-1', '123456', 'user-1', '牌局', 'generic', 'waiting', 4, 50, 1, 0, 1, 2)
	`)
	if err != nil {
		t.Fatalf("insert room: %v", err)
	}
	_, err = store.db.ExecContext(ctx, `
		INSERT INTO score_participants (
			id, room_id, user_id, display_name, normalized_name, role, status,
			token_version, joined_at, last_seen_at
		) VALUES ('participant-1', 'room-1', 'user-1', '小陈', '小陈', 'host', 'active', 1, 1, 1)
	`)
	if err != nil {
		t.Fatalf("insert first participant: %v", err)
	}
	_, err = store.db.ExecContext(ctx, `
		INSERT INTO score_participants (
			id, room_id, user_id, display_name, normalized_name, role, status,
			token_version, joined_at, last_seen_at
		) VALUES ('participant-2', 'room-1', NULL, '小陈', '小陈', 'guest', 'active', 1, 2, 2)
	`)
	if err == nil {
		t.Fatal("duplicate room nickname was accepted")
	}
}

func TestOpenStoreRequiresDatabasePath(t *testing.T) {
	store, err := OpenStore("  ")
	if store != nil || !errors.Is(err, ErrDatabasePathRequired) {
		t.Fatalf("OpenStore() = (%v, %v), want nil ErrDatabasePathRequired", store, err)
	}
}

func TestLoadRoomSnapshotCountsOnlyConfirmedRounds(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "score.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ctx := context.Background()
	mustExecScoreFixture(t, store, `
		INSERT INTO score_rooms (
			id, code, host_user_id, name, mode, status, max_players,
			cents_per_point, version, event_sequence, created_at, started_at, expires_at
		) VALUES ('room-1', '654321', 'user-1', '周五牌局', 'generic', 'active', 4, 50, 7, 6, 100, 110, 9999)
	`)
	mustExecScoreFixture(t, store, `
		INSERT INTO score_participants (
			id, room_id, user_id, display_name, normalized_name, role, status,
			token_version, joined_at, last_seen_at
		) VALUES
			('host', 'room-1', 'user-1', '房主', '房主', 'host', 'active', 1, 101, 120),
			('guest', 'room-1', NULL, '小陈', '小陈', 'guest', 'active', 1, 102, 121)
	`)
	mustExecScoreFixture(t, store, `
		INSERT INTO score_rounds (
			id, room_id, number, kind, reverses_round_id, status, roster_json,
			created_by, created_at, confirmed_at
		) VALUES ('round-1', 'room-1', 1, 'normal', NULL, 'confirmed', '["host","guest"]', 'host', 130, 140)
	`)
	mustExecScoreFixture(t, store, `
		INSERT INTO score_entries (
			round_id, participant_id, delta_points, revision, submitted_at, updated_at
		) VALUES
			('round-1', 'host', 10, 1, 131, 131),
			('round-1', 'guest', -10, 1, 132, 132)
	`)
	mustExecScoreFixture(t, store, `
		INSERT INTO score_confirmations (round_id, participant_id, entry_revision, confirmed_at)
		VALUES ('round-1', 'host', 1, 139), ('round-1', 'guest', 1, 140)
	`)
	mustExecScoreFixture(t, store, `
		INSERT INTO score_rounds (
			id, room_id, number, kind, reverses_round_id, status, roster_json,
			created_by, created_at
		) VALUES ('round-2', 'room-1', 2, 'normal', NULL, 'collecting', '["host","guest"]', 'host', 150)
	`)
	mustExecScoreFixture(t, store, `
		INSERT INTO score_entries (
			round_id, participant_id, delta_points, revision, submitted_at, updated_at
		) VALUES ('round-2', 'host', 5, 1, 151, 151)
	`)

	snapshot, err := store.loadRoomSnapshot(ctx, store.db, "room-1")
	if err != nil {
		t.Fatalf("loadRoomSnapshot() error = %v", err)
	}
	if snapshot.ID != "room-1" || snapshot.Version != 7 || snapshot.EventSequence != 6 {
		t.Fatalf("snapshot metadata = %+v", snapshot)
	}
	if snapshot.Scene != SceneGeneric {
		t.Fatalf("legacy room scene = %q, want generic", snapshot.Scene)
	}
	if len(snapshot.Participants) != 2 {
		t.Fatalf("participants = %+v", snapshot.Participants)
	}
	if snapshot.Participants[0].ID != "host" || snapshot.Participants[0].TotalPoints != 10 || snapshot.Participants[0].AmountCents != 500 {
		t.Fatalf("host = %+v", snapshot.Participants[0])
	}
	if snapshot.Participants[1].ID != "guest" || snapshot.Participants[1].TotalPoints != -10 || snapshot.Participants[1].AmountCents != -500 {
		t.Fatalf("guest = %+v", snapshot.Participants[1])
	}
	if len(snapshot.Rounds) != 1 || snapshot.Rounds[0].ID != "round-1" || snapshot.Rounds[0].Status != RoundConfirmed {
		t.Fatalf("confirmed rounds = %+v", snapshot.Rounds)
	}
	if snapshot.CurrentRound == nil || snapshot.CurrentRound.ID != "round-2" {
		t.Fatalf("current round = %+v", snapshot.CurrentRound)
	}
	if len(snapshot.CurrentRound.Entries) != 2 {
		t.Fatalf("current entries = %+v", snapshot.CurrentRound.Entries)
	}
	if !snapshot.CurrentRound.Entries[0].Submitted || snapshot.CurrentRound.Entries[0].DeltaPoints != 5 {
		t.Fatalf("host current entry = %+v", snapshot.CurrentRound.Entries[0])
	}
	if snapshot.CurrentRound.Entries[1].Submitted || snapshot.CurrentRound.Entries[1].DeltaPoints != 0 {
		t.Fatalf("guest current entry = %+v", snapshot.CurrentRound.Entries[1])
	}
}

func mustExecScoreFixture(t *testing.T, store *Store, statement string) {
	t.Helper()
	if _, err := store.db.ExecContext(context.Background(), statement); err != nil {
		t.Fatalf("execute fixture: %v", err)
	}
}
