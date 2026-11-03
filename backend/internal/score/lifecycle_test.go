package score

import (
	"context"
	"errors"
	"testing"
)

func TestCancelRoomAllowsOnlyHostOfEmptyWaitingOrActiveScoringRoom(t *testing.T) {
	for _, game := range []GameType{GameTypeGeneric, GameTypeMahjong, GameTypeZhaJinHua} {
		for _, active := range []bool{false, true} {
			t.Run(string(game)+map[bool]string{false: "/waiting", true: "/active"}[active], func(t *testing.T) {
				s := newTestService(t)
				ctx := context.Background()
				input := CreateRoomInput{Name: "Empty", GameType: game, MaxPlayers: 4, CentsPerPoint: 100}
				if game == GameTypeMahjong {
					input.Password = "1234"
				}
				created, err := s.CreateRoom(ctx, "host", "Host", input)
				if err != nil {
					t.Fatal(err)
				}
				guest, err := s.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, Password: input.Password, DisplayName: "Guest"})
				if err != nil {
					t.Fatal(err)
				}
				room := guest.Room
				if active {
					room, err = s.StartRoom(ctx, created.Actor, commandMeta("start", room))
					if err != nil {
						t.Fatal(err)
					}
				}
				if _, err := s.CancelRoom(ctx, guest.Actor, commandMeta("guest-cancel", room)); !errors.Is(err, ErrForbidden) {
					t.Fatalf("guest cancel = %v", err)
				}
				cancelled, err := s.CancelRoom(ctx, created.Actor, commandMeta("host-cancel", room))
				if active && game == GameTypeZhaJinHua {
					if !errors.Is(err, ErrInvalidState) {
						t.Fatalf("active poker cancel = %v", err)
					}
					return
				}
				if err != nil {
					t.Fatalf("empty room cancel = %v", err)
				}
				if cancelled.Status != RoomCancelled || cancelled.CancelledAt == nil || cancelled.Version != room.Version+1 {
					t.Fatalf("cancelled snapshot = %+v", cancelled)
				}
			})
		}
	}
}

func TestCancelRoomRejectsAccountingHistoryAndTerminalStatus(t *testing.T) {
	for _, history := range []string{"gift", "reversed-gift", "current-round", "cancelled-round", "current-poker", "cancelled-poker", "settled"} {
		t.Run(history, func(t *testing.T) {
			s := newTestService(t)
			ctx := context.Background()
			var created CreateRoomResult
			var guest JoinRoomResult
			var room RoomSnapshot
			var err error
			if history == "current-poker" || history == "cancelled-poker" {
				created, err = s.CreateRoom(ctx, "host", "Host", CreateRoomInput{Name: "Poker", Scene: SceneZhaJinHua, MaxPlayers: 4, CentsPerPoint: 100})
				if err != nil {
					t.Fatal(err)
				}
				guest, err = s.JoinRoom(ctx, JoinRoomInput{Code: created.Room.Code, DisplayName: "Guest"})
				if err != nil {
					t.Fatal(err)
				}
				room, err = s.StartRoom(ctx, created.Actor, commandMeta("start", guest.Room))
				if err != nil {
					t.Fatal(err)
				}
				room, err = s.StartZhaJinHuaHand(ctx, created.Actor, commandMeta("hand", room))
				if err != nil {
					t.Fatal(err)
				}
				if history == "cancelled-poker" {
					room, err = s.CancelZhaJinHuaHand(ctx, created.Actor, commandMeta("cancel-hand", room), room.CurrentZhaJinHuaHand.ID)
				}
			} else {
				created, guest, room = startTwoPlayerRoom(t, s)
				switch history {
				case "gift", "reversed-gift":
					room, err = s.SubmitGifts(ctx, created.Actor, commandMeta("gift", room), SubmitGiftsInput{Allocations: []GiftAllocationInput{{ToParticipantID: guest.Actor.ParticipantID, Points: 4}}})
					if err != nil {
						t.Fatal(err)
					}
					if history == "reversed-gift" {
						room, err = s.ReverseGiftBatch(ctx, created.Actor, commandMeta("reverse", room), room.GiftBatches[0].ID)
					}
				case "current-round", "cancelled-round":
					room, err = s.StartRound(ctx, created.Actor, commandMeta("round", room), StartRoundInput{})
					if err != nil {
						t.Fatal(err)
					}
					if history == "cancelled-round" {
						room, err = s.CancelRound(ctx, created.Actor, commandMeta("cancel-round", room), room.CurrentRound.ID)
					}
				case "settled":
					room, err = s.SubmitGifts(ctx, created.Actor, commandMeta("gift", room), SubmitGiftsInput{Allocations: []GiftAllocationInput{{ToParticipantID: guest.Actor.ParticipantID, Points: 4}}})
					if err != nil {
						t.Fatal(err)
					}
					room, err = s.SettleRoom(ctx, created.Actor, commandMeta("settle", room), SettleRoomInput{})
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.CancelRoom(ctx, created.Actor, commandMeta("cancel", room)); !errors.Is(err, ErrInvalidState) {
				t.Fatalf("cancel with %s = %v", history, err)
			}
		})
	}
}
