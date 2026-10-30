package score

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

// Catches both the old create-time limit and join/preview capacity checks.
func TestGeneralScoreFlexibleRoomAndHostSettlement(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	created, err := s.CreateRoom(ctx, "host", "小林", CreateRoomInput{
		Name: "通用记分", GameType: GameTypeGeneric, MaxPlayers: 0, Password: "666666",
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Room.MaxPlayers != 0 {
		t.Fatalf("capacity = %d, want flexible", created.Room.MaxPlayers)
	}
	if _, err := s.StartRoom(ctx, created.Actor, commandMeta("alone", created.Room)); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("one-person start: %v", err)
	}
	var guest JoinRoomResult
	for i := 1; i <= 12; i++ {
		guest, err = s.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, Password: "666666", DisplayName: fmt.Sprintf("成员%d", i)})
		if err != nil {
			t.Fatalf("join %d: %v", i, err)
		}
	}
	invite, err := s.IssueInviteToken(ctx, created.Actor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreviewInvite(ctx, "", InvitePreviewInput{InviteToken: invite}); err != nil {
		t.Fatalf("preview after 13 joins: %v", err)
	}
	loaded, err := s.GetRoom(ctx, created.Actor)
	if err != nil || loaded.MaxPlayers != 0 || len(loaded.Participants) != 13 {
		t.Fatalf("reload flexible room: %+v, %v", loaded, err)
	}
	room, err := s.StartRoom(ctx, created.Actor, commandMeta("start", guest.Room))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.JoinRoom(ctx, JoinRoomInput{Code: room.Code, Password: "666666", DisplayName: "迟到成员"}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("joining active room: %v", err)
	}
	room, err = s.SubmitGifts(ctx, created.Actor, commandMeta("gift", room), SubmitGiftsInput{Allocations: []GiftAllocationInput{{ToParticipantID: guest.Actor.ParticipantID, Points: 12}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SettleRoom(ctx, guest.Actor, commandMeta("guest-settle", room), SettleRoomInput{CentsPerPoint: 50, UseSettlementRate: true}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest settlement: %v", err)
	}
	settled, err := s.SettleRoom(ctx, created.Actor, commandMeta("settle", room), SettleRoomInput{CentsPerPoint: 50, UseSettlementRate: true})
	if err != nil {
		t.Fatal(err)
	}
	if settled.CentsPerPoint != 50 || settled.Status != RoomSettled || settled.MaxPlayers != 0 {
		t.Fatalf("settled: %+v", settled)
	}
	if len(settled.Settlement.Transfers) != 1 || settled.Settlement.Transfers[0].AmountCents != 600 {
		t.Fatalf("transfers: %+v", settled.Settlement.Transfers)
	}
}

func TestGeneralScoreFixedCapacityRemainsEnforced(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	created, err := s.CreateRoom(ctx, "host", "房主", CreateRoomInput{Name: "旧通用局", GameType: GameTypeGeneric, MaxPlayers: 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "成员"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "超额"}); !errors.Is(err, ErrRoomFull) {
		t.Fatalf("full: %v", err)
	}
}
