package score

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func startMahjongTable(t *testing.T, s *Service) (RoomSnapshot, Actor, []JoinRoomResult) {
	t.Helper()
	ctx := context.Background()
	created, err := s.CreateRoom(ctx, "host-account", "房主", CreateRoomInput{Name: "麻将", GameType: GameTypeMahjong, Password: "1234"})
	if err != nil {
		t.Fatal(err)
	}
	guests := make([]JoinRoomResult, 0, 3)
	room := created.Room
	for _, name := range []string{"小明", "小丁", "小方"} {
		guest, err := s.JoinRoom(ctx, JoinRoomInput{InviteToken: created.InviteToken, DisplayName: name})
		if err != nil {
			t.Fatal(err)
		}
		guests = append(guests, guest)
		room = guest.Room
	}
	room, err = s.StartRoom(ctx, created.Actor, commandMeta("start", room))
	if err != nil {
		t.Fatal(err)
	}
	return room, created.Actor, guests
}

func manageHandover(t *testing.T, s *Service, actor Actor, room RoomSnapshot, actionID, action, participantID, handoverID string) RoomSnapshot {
	t.Helper()
	room, err := s.ManageMahjongHandover(context.Background(), actor, commandMeta(actionID, room), MahjongHandoverInput{
		Action: action, ParticipantID: participantID, HandoverID: handoverID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return room
}

func previewHandover(t *testing.T, s *Service, host Actor, room RoomSnapshot, proof string) (InviteCodeResult, MahjongHandoverPreview) {
	t.Helper()
	ctx := context.Background()
	code, err := s.IssueMahjongHandoverCode(ctx, host, room.MahjongHandover.ID)
	if err != nil || !strings.HasPrefix(code.InviteScene, "h_") {
		t.Fatalf("handover code = %+v, error = %v", code, err)
	}
	preview, err := s.PreviewMahjongHandover(ctx, code.InviteScene, proof)
	if err != nil {
		t.Fatal(err)
	}
	return code, preview
}

func TestMahjongHandoverPreservesSeatLedgerAndRotatesRejoiningCredential(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	room, host, guests := startMahjongTable(t, s)
	former := guests[0]
	previousMeta := commandMeta("former-scored", room)
	previousGift := SubmitGiftsInput{Allocations: []GiftAllocationInput{{ToParticipantID: host.ParticipantID, Points: 2}}}
	room, err := s.SubmitGifts(ctx, former.Actor, previousMeta, previousGift)
	if err != nil {
		t.Fatal(err)
	}
	room, err = s.ReverseGiftBatch(ctx, host, commandMeta("reverse-former", room), room.GiftBatches[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	room, err = s.SubmitGifts(ctx, host, commandMeta("gift", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{{ToParticipantID: former.Actor.ParticipantID, Points: 7}},
	})
	if err != nil {
		t.Fatal(err)
	}
	giftID := room.GiftBatches[0].ID
	room = manageHandover(t, s, host, room, "invite-a", "invite", former.Actor.ParticipantID, "")
	firstID := room.MahjongHandover.ID
	code, p := previewHandover(t, s, host, room, "")
	if p.Status != "open" || p.Points != 7 || p.Seat != 2 || p.ClaimToken == "" {
		t.Fatalf("open preview = %+v", p)
	}
	_, other := previewHandover(t, s, host, room, "")
	accepted, room, err := s.AcceptMahjongHandover(ctx, MahjongHandoverAcceptance{Scene: code.InviteScene, ClaimToken: p.ClaimToken, DisplayName: "小新", Points: 7})
	if err != nil || accepted.Status != "accepted" || accepted.GuestToken != "" || len(activeParticipants(room.Participants)) != 4 {
		t.Fatalf("accepted = %+v, participants = %+v, error = %v", accepted, room.Participants, err)
	}
	encoded, err := json.Marshal(room)
	if err != nil || strings.Contains(string(encoded), p.ClaimToken) || strings.Contains(string(encoded), code.InviteScene) {
		t.Fatal("room snapshot leaked invitation credentials")
	}
	if _, _, err := s.AcceptMahjongHandover(ctx, MahjongHandoverAcceptance{Scene: code.InviteScene, ClaimToken: other.ClaimToken, DisplayName: "抢座", Points: 7}); !errors.Is(err, ErrHandoverClaimed) {
		t.Fatalf("second accept = %v", err)
	}
	staleActor, err := s.AuthenticateGuestToken(ctx, former.GuestToken)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ManageMahjongHandover(ctx, host, CommandMeta{}, MahjongHandoverInput{
		Action: "confirm", HandoverID: firstID,
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("confirmed a seat handover without a room version: %v", err)
	}
	room = manageHandover(t, s, host, room, "confirm-a", "confirm", "", firstID)
	retired, err := s.AuthenticateGuestToken(ctx, former.GuestToken)
	if err != nil {
		t.Fatalf("retired player authentication = %v", err)
	}
	if read, err := s.GetRoom(ctx, retired); err != nil || read.SelfParticipantID != former.Actor.ParticipantID {
		t.Fatalf("retired room access = %q, error = %v", read.SelfParticipantID, err)
	}
	if _, err := s.SubmitGifts(ctx, retired, commandMeta("retired-gift", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{{ToParticipantID: host.ParticipantID, Points: 3}},
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("retired gift = %v", err)
	}
	if _, err := s.SubmitGifts(ctx, retired, previousMeta, previousGift); !errors.Is(err, ErrForbidden) {
		t.Fatalf("retired player replayed a successful command: %v", err)
	}
	completed, err := s.PreviewMahjongHandover(ctx, code.InviteScene, p.ClaimToken)
	if err != nil || completed.Status != "completed" || completed.GuestToken == "" {
		t.Fatalf("completed preview = %+v, error = %v", completed, err)
	}
	stranger, err := s.PreviewMahjongHandover(ctx, code.InviteScene, other.ClaimToken)
	if err != nil || stranger.Status != "claimed" || stranger.GuestToken != "" {
		t.Fatalf("stranger preview = %+v, error = %v", stranger, err)
	}
	assertMahjongParticipant(t, room, former.Actor.ParticipantID, 7, 0, ParticipantLeft)
	assertMahjongParticipant(t, room, completed.ParticipantID, 7, 700, ParticipantActive)
	if len(room.MahjongHandovers) != 1 || room.MahjongHandovers[0].Points != 7 {
		t.Fatalf("handover ledger = %+v", room.MahjongHandovers)
	}
	if room.GiftBatches[0].Gifts[0].ToParticipantID != former.Actor.ParticipantID {
		t.Fatal("handover rewrote an existing gift")
	}
	room, err = s.ReverseGiftBatch(ctx, host, commandMeta("reverse", room), giftID)
	if err != nil {
		t.Fatal(err)
	}
	assertMahjongParticipant(t, room, former.Actor.ParticipantID, 7, 0, ParticipantLeft)
	assertMahjongParticipant(t, room, completed.ParticipantID, 0, 0, ParticipantActive)
	if room.GiftBatches[0].Gifts[0].FromParticipantID != former.Actor.ParticipantID {
		t.Fatal("reversal lost original recipient")
	}

	room = manageHandover(t, s, host, room, "invite-b", "invite", completed.ParticipantID, "")
	returnID := room.MahjongHandover.ID
	returnCode, p := previewHandover(t, s, host, room, "")
	_, room, err = s.AcceptMahjongHandover(ctx, MahjongHandoverAcceptance{Scene: returnCode.InviteScene, ClaimToken: p.ClaimToken, ParticipantToken: former.GuestToken, Points: 0})
	if err != nil {
		t.Fatal(err)
	}
	room = manageHandover(t, s, host, room, "confirm-b", "confirm", "", returnID)
	returned, err := s.PreviewMahjongHandover(ctx, returnCode.InviteScene, p.ClaimToken)
	if err != nil || returned.ParticipantID != former.Actor.ParticipantID || returned.GuestToken == "" {
		t.Fatalf("returned preview = %+v, error = %v", returned, err)
	}
	oldClaim, err := s.PreviewMahjongHandover(ctx, code.InviteScene, accepted.ClaimToken)
	if err != nil || oldClaim.GuestToken != "" {
		t.Fatalf("old proof resumed retired player = %+v, error = %v", oldClaim, err)
	}
	if _, err := s.AuthenticateGuestToken(ctx, former.GuestToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("old token authenticates after return: %v", err)
	}
	if _, err := s.SubmitGifts(ctx, staleActor, commandMeta("stale-actor", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{{ToParticipantID: host.ParticipantID, Points: 2}},
	}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("stale actor mutated after return: %v", err)
	}
	newActor, err := s.AuthenticateGuestToken(ctx, returned.GuestToken)
	if err != nil {
		t.Fatal(err)
	}
	room, err = s.SubmitGifts(ctx, newActor, commandMeta("new-gift", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{{ToParticipantID: host.ParticipantID, Points: 2}},
	})
	if err != nil {
		t.Fatal(err)
	}
	room, err = s.SettleRoom(ctx, host, commandMeta("settlement", room), SettleRoomInput{})
	if err != nil || room.Settlement == nil || len(room.Settlement.Balances) != 4 || len(room.Settlement.Transfers) != 1 {
		t.Fatalf("settlement = %+v, error = %v", room.Settlement, err)
	}
	transfer := room.Settlement.Transfers[0]
	if transfer.FromParticipantID != former.Actor.ParticipantID || transfer.ToParticipantID != host.ParticipantID || transfer.AmountCents != 200 {
		t.Fatalf("transfer = %+v", transfer)
	}
}

func TestMahjongHandoverKeepsLinkedAccountHistoryInScorelessGame(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	room, host, guests := startMahjongTable(t, s)
	former := guests[0]
	const accountID = "guest-account"
	var err error
	room, err = s.BindParticipantAccount(ctx, accountID, room.ID, former.GuestToken)
	if err != nil {
		t.Fatal(err)
	}
	room = manageHandover(t, s, host, room, "replace", "invite", former.Actor.ParticipantID, "")
	id := room.MahjongHandover.ID
	code, p := previewHandover(t, s, host, room, "")
	_, room, err = s.AcceptMahjongHandover(ctx, MahjongHandoverAcceptance{
		Scene: code.InviteScene, ClaimToken: p.ClaimToken, DisplayName: "小新",
	})
	if err != nil {
		t.Fatal(err)
	}
	room = manageHandover(t, s, host, room, "confirm-replace", "confirm", "", id)
	if _, err := s.CancelRoom(ctx, host, commandMeta("cancel", room)); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("room with completed handover was cancelled: %v", err)
	}

	retired, err := s.ActorForUser(ctx, room.ID, accountID)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot, err := s.GetRoom(ctx, retired); err != nil || snapshot.SelfParticipantID != former.Actor.ParticipantID {
		t.Fatalf("linked retired player room = %+v, error = %v", snapshot, err)
	}
	completed, err := s.PreviewMahjongHandover(ctx, code.InviteScene, p.ClaimToken)
	if err != nil || completed.ParticipantID == "" {
		t.Fatalf("completed preview = %+v, error = %v", completed, err)
	}
	room = manageHandover(t, s, host, room, "return", "invite", completed.ParticipantID, "")
	id = room.MahjongHandover.ID
	code, p = previewHandover(t, s, host, room, "")
	_, room, err = s.AcceptMahjongHandover(ctx, MahjongHandoverAcceptance{
		Scene: code.InviteScene, ClaimToken: p.ClaimToken, UserID: accountID, DisplayName: "改名",
	})
	if err != nil || room.MahjongHandover == nil || room.MahjongHandover.CandidateName != "小明" {
		t.Fatalf("return via linked account = %+v, error = %v", room.MahjongHandover, err)
	}
	room = manageHandover(t, s, host, room, "confirm-return", "confirm", "", id)
	if len(room.MahjongHandovers) != 2 || room.MahjongHandovers[1].ToParticipantID != former.Actor.ParticipantID {
		t.Fatalf("handover history = %+v", room.MahjongHandovers)
	}
	room = manageHandover(t, s, host, room, "invite-before-settle", "invite", guests[1].Actor.ParticipantID, "")
	code, p = previewHandover(t, s, host, room, "")
	room = manageHandover(t, s, host, room, "offer-before-settle", "offer_host", guests[2].Actor.ParticipantID, "")
	room, err = s.SettleRoom(ctx, host, commandMeta("settle", room), SettleRoomInput{})
	if err != nil || room.Status != RoomSettled || room.Settlement == nil || len(room.Settlement.Balances) != 4 || len(room.Settlement.Transfers) != 0 {
		t.Fatalf("zero-point settlement = %+v, error = %v", room.Settlement, err)
	}
	if room.MahjongHandover != nil || room.PendingHostParticipantID != "" {
		t.Fatal("settled room kept a pending invitation")
	}
	cancelled, err := s.PreviewMahjongHandover(ctx, code.InviteScene, p.ClaimToken)
	if err != nil || cancelled.Status != "cancelled" {
		t.Fatalf("settled-room preview = %+v, error = %v", cancelled, err)
	}
}

func TestMahjongHandoverRequiresFreshConsentAfterScoreChange(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	room, host, guests := startMahjongTable(t, s)
	target := guests[0].Actor.ParticipantID
	room = manageHandover(t, s, host, room, "invite", "invite", target, "")
	id := room.MahjongHandover.ID
	code, preview := previewHandover(t, s, host, room, "")
	accept := MahjongHandoverAcceptance{Scene: code.InviteScene, ClaimToken: preview.ClaimToken, DisplayName: "小新"}
	room, err := s.SubmitGifts(ctx, host, commandMeta("gift-first", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{{ToParticipantID: target, Points: 4}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.AcceptMahjongHandover(ctx, accept); !errors.Is(err, ErrHandoverScoreChanged) {
		t.Fatalf("accepting previous amount = %v", err)
	}
	accept.Points = 4
	_, room, err = s.AcceptMahjongHandover(ctx, accept)
	if err != nil {
		t.Fatal(err)
	}
	room, err = s.SubmitGifts(ctx, host, commandMeta("gift-second", room), SubmitGiftsInput{
		Allocations: []GiftAllocationInput{{ToParticipantID: target, Points: 3}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ManageMahjongHandover(ctx, host, commandMeta("confirm", room), MahjongHandoverInput{Action: "confirm", HandoverID: id}); !errors.Is(err, ErrHandoverScoreChanged) {
		t.Fatalf("confirming superseded consent = %v", err)
	}
	room, err = s.ReverseGiftBatch(ctx, host, commandMeta("undo-second", room), room.GiftBatches[0].ID)
	if err != nil || room.MahjongHandover.Status != "reconfirm" {
		t.Fatalf("previous consent revived after reversal: %+v, %v", room.MahjongHandover, err)
	}
	p, err := s.PreviewMahjongHandover(ctx, code.InviteScene, preview.ClaimToken)
	if err != nil || p.Status != "reconfirm" || p.Points != 4 {
		t.Fatalf("changed preview = %+v, error = %v", p, err)
	}
	_, room, err = s.AcceptMahjongHandover(ctx, accept)
	if err != nil {
		t.Fatal(err)
	}
	room = manageHandover(t, s, host, room, "confirm", "confirm", "", id)
	if room.MahjongHandovers[0].Points != 4 {
		t.Fatalf("confirmed handover = %+v", room.MahjongHandovers)
	}
}

func TestMahjongHandoverExpiryCancellationAndSeparateHostOffer(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	s.now = func() time.Time { return now }
	room, host, guests := startMahjongTable(t, s)
	offer := guests[0]
	target := guests[1].Actor.ParticipantID
	inviteMeta := commandMeta("invite", room)
	invite := MahjongHandoverInput{Action: "invite", ParticipantID: target}
	room, err := s.ManageMahjongHandover(ctx, host, inviteMeta, invite)
	if err != nil || room.MahjongHandover == nil {
		t.Fatalf("open invite = %+v, error = %v", room.MahjongHandover, err)
	}
	id := room.MahjongHandover.ID
	code, p := previewHandover(t, s, host, room, "")
	room = manageHandover(t, s, host, room, "offer", "offer_host", offer.Actor.ParticipantID, "")
	if room.PendingHostParticipantID != offer.Actor.ParticipantID || room.MahjongHandover.ID != id {
		t.Fatalf("host offer clobbered the handover: %+v", room)
	}
	if _, err := s.ManageMahjongHandover(ctx, host, commandMeta("overlapping-offer", room), MahjongHandoverInput{
		Action: "offer_host", ParticipantID: target,
	}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("offered host to departing player: %v", err)
	}
	replayed, err := s.ManageMahjongHandover(ctx, host, inviteMeta, invite)
	if err != nil || replayed.MahjongHandover == nil || replayed.MahjongHandover.ID != id || replayed.Version >= room.Version {
		t.Fatalf("retried invitation = %+v, version = %d, error = %v", replayed.MahjongHandover, replayed.Version, err)
	}
	current, err := s.GetRoom(ctx, host)
	if err != nil || current.Version != room.Version || current.PendingHostParticipantID != offer.Actor.ParticipantID {
		t.Fatalf("read after retry = %+v, error = %v", current, err)
	}
	if _, err := s.ManageMahjongHandover(ctx, guests[2].Actor, commandMeta("steal-host", room), MahjongHandoverInput{Action: "accept_host"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("another participant accepted host offer: %v", err)
	}
	room = manageHandover(t, s, host, room, "cancel-offer", "cancel_host", "", "")
	room = manageHandover(t, s, host, room, "offer-again", "offer_host", offer.Actor.ParticipantID, "")
	if _, err := s.ManageMahjongHandover(ctx, offer.Actor, CommandMeta{}, MahjongHandoverInput{
		Action: "accept_host",
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("accepted host offer without a room version: %v", err)
	}
	room = manageHandover(t, s, offer.Actor, room, "accept-host", "accept_host", "", "")
	guestHost, err := s.AuthenticateGuestToken(ctx, offer.GuestToken)
	if err != nil || guestHost.Role != ParticipantHost || room.HostUserID != "" || room.MahjongHandover.ID != id {
		t.Fatalf("guest host = %+v, handover = %+v, error = %v", guestHost, room.MahjongHandover, err)
	}
	room = manageHandover(t, s, guestHost, room, "cancel-seat", "cancel", "", id)
	cancelled, err := s.PreviewMahjongHandover(ctx, code.InviteScene, p.ClaimToken)
	if err != nil || cancelled.Status != "cancelled" || room.MahjongHandover != nil {
		t.Fatalf("cancelled preview = %+v, error = %v", cancelled, err)
	}
	room = manageHandover(t, s, guestHost, room, "new-invite", "invite", target, "")
	code, p = previewHandover(t, s, guestHost, room, "")
	_, room, err = s.AcceptMahjongHandover(ctx, MahjongHandoverAcceptance{Scene: code.InviteScene, ClaimToken: p.ClaimToken, DisplayName: "候选"})
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(5 * time.Minute)
	expired, err := s.PreviewMahjongHandover(ctx, code.InviteScene, p.ClaimToken)
	if err != nil || expired.Status != "expired" {
		t.Fatalf("expired preview = %+v, error = %v", expired, err)
	}
	if _, err := s.ManageMahjongHandover(ctx, guestHost, commandMeta("expired", room), MahjongHandoverInput{Action: "confirm", HandoverID: room.MahjongHandover.ID}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("confirmed expired invite = %v", err)
	}
	if current, err := s.GetRoom(ctx, guestHost); err != nil || current.MahjongHandover != nil || current.Version != room.Version {
		t.Fatalf("read after invite expiry = %+v, error = %v", current, err)
	}
	manageHandover(t, s, guestHost, room, "invite-after-expiry", "invite", target, "")
}

func TestMahjongHandoverPreservesLegacySeatOrderAfterHostTransfer(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	room, host, guests := startMahjongTable(t, s)
	// Simulate an active room restored from before seat membership was stored.
	if _, err := s.store.db.ExecContext(ctx, `DELETE FROM score_mahjong_seats`); err != nil {
		t.Fatal(err)
	}
	newHost := guests[0]
	room = manageHandover(t, s, host, room, "offer", "offer_host", newHost.Actor.ParticipantID, "")
	room = manageHandover(t, s, newHost.Actor, room, "accept", "accept_host", "", "")
	actor, err := s.AuthenticateGuestToken(ctx, newHost.GuestToken)
	if err != nil {
		t.Fatal(err)
	}
	room = manageHandover(t, s, actor, room, "invite", "invite", host.ParticipantID, "")
	if room.MahjongHandover.Seat != 1 {
		t.Fatalf("original host's seat = %d, want 1", room.MahjongHandover.Seat)
	}
	if p := mahjongParticipant(room, newHost.Actor.ParticipantID); p == nil || p.MahjongSeat != 2 {
		t.Fatalf("new host's seat = %+v, want 2", p)
	}
}

func TestMahjongHandoverPrivateRecoveryOutlivesPublicInvite(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	s.now = func() time.Time { return now }
	room, host, guests := startMahjongTable(t, s)
	room = manageHandover(t, s, host, room, "invite", "invite", guests[0].Actor.ParticipantID, "")
	id := room.MahjongHandover.ID
	code, own := previewHandover(t, s, host, room, "")
	wantCredentialExpiry := own.ExpiresAt.Add(7 * 24 * time.Hour)
	if own.CredentialExpiresAt == nil || !own.CredentialExpiresAt.Equal(wantCredentialExpiry) {
		t.Fatalf("open proof recovery deadline = %v, want %v", own.CredentialExpiresAt, wantCredentialExpiry)
	}
	_, another := previewHandover(t, s, host, room, "")
	accepted, room, err := s.AcceptMahjongHandover(ctx, MahjongHandoverAcceptance{
		Scene: code.InviteScene, ClaimToken: own.ClaimToken, DisplayName: "小新",
	})
	if err != nil || accepted.CredentialExpiresAt == nil || !accepted.CredentialExpiresAt.Equal(wantCredentialExpiry) {
		t.Fatalf("accepted proof recovery deadline = %v, error = %v", accepted.CredentialExpiresAt, err)
	}
	room = manageHandover(t, s, host, room, "confirm", "confirm", "", id)

	now = now.Add(6 * time.Minute)
	recovered, err := s.PreviewMahjongHandover(ctx, code.InviteScene, own.ClaimToken)
	if err != nil || recovered.Status != "completed" || recovered.GuestToken == "" || recovered.ParticipantID == "" ||
		!recovered.ExpiresAt.Equal(own.ExpiresAt) {
		t.Fatalf("private recovery after public expiry = %+v, error = %v", recovered, err)
	}
	for _, proof := range []string{"", another.ClaimToken} {
		public, err := s.PreviewMahjongHandover(ctx, code.InviteScene, proof)
		if err != nil || public.Status != "expired" || public.GuestToken != "" || public.ParticipantID != "" ||
			public.CredentialExpiresAt != nil {
			t.Fatalf("public preview after expiry = %+v, error = %v", public, err)
		}
	}
	room, err = s.SettleRoom(ctx, host, commandMeta("settle", room), SettleRoomInput{})
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(24*time.Hour + time.Second)
	expired, err := s.PreviewMahjongHandover(ctx, code.InviteScene, own.ClaimToken)
	if err != nil || expired.Status != "expired" || expired.GuestToken != "" {
		t.Fatalf("private preview after settled-room grace = %+v, error = %v", expired, err)
	}
}

func assertMahjongParticipant(t *testing.T, room RoomSnapshot, id string, points, amount int64, status ParticipantStatus) {
	t.Helper()
	for _, p := range room.Participants {
		if p.ID != id {
			continue
		}
		if p.MahjongSeat != 2 || p.TotalPoints != points || p.AmountCents != amount || p.Status != status ||
			(status == ParticipantLeft && (p.LeftAtPoints == nil || *p.LeftAtPoints != points)) {
			t.Fatalf("participant = %+v, want status %s, points %d, amount %d", p, status, points, amount)
		}
		return
	}
	t.Fatalf("missing participant %s", id)
}
