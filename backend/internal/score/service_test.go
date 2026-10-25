package score

import (
	"context"
	"errors"
	"path/filepath"
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
