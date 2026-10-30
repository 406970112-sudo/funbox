package score

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

func TestV2CreationSupportsTwelveAndAnte(t *testing.T) {
	s := newTestService(t)
	var in CreateRoomInput
	if err := json.Unmarshal([]byte(`{"name":"Poker","gameType":"zhajinhua","maxPlayers":12,"centsPerPoint":25,"zhaJinHuaSettings":{"rulesVersion":2,"antePoints":1,"maxBetPoints":20,"compareThreshold":3,"baoziBonusPoints":20,"shunjinBonusPoints":10}}`), &in); err != nil {
		t.Fatal(err)
	}
	r, err := s.CreateRoom(context.Background(), "host", "Host", in)
	if err != nil {
		t.Fatal(err)
	}
	if r.Room.MaxPlayers != 12 {
		t.Fatalf("max players = %d", r.Room.MaxPlayers)
	}
	j, err := s.JoinRoom(context.Background(), JoinRoomInput{Code: r.Room.Code, DisplayName: "Guest"})
	if err != nil {
		t.Fatal(err)
	}
	_ = j
	room, err := s.StartRoom(context.Background(), r.Actor, CommandMeta{})
	if err != nil {
		t.Fatal(err)
	}
	room, err = s.StartZhaJinHuaHand(context.Background(), r.Actor, CommandMeta{})
	if err != nil {
		t.Fatal(err)
	}
	if room.CurrentZhaJinHuaHand.PotPoints != 2 || room.CurrentZhaJinHuaHand.CurrentBetPoints != 1 {
		t.Fatalf("hand = %+v", room.CurrentZhaJinHuaHand)
	}
}

func TestV2RoomSupportsUnlimitedSeats(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	settings := v2Settings()
	settings.MaxPlayers = 0
	created, err := s.CreateRoom(ctx, "host", "Host", CreateRoomInput{Name: "Poker", GameType: GameTypeZhaJinHua, MaxPlayers: 0, CentsPerPoint: 100, ZhaJinHuaSettings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	if created.Room.MaxPlayers != 0 {
		t.Fatalf("max players = %d, want unlimited", created.Room.MaxPlayers)
	}
	var physicalMax, unlimited int
	if err := s.store.db.QueryRow(`SELECT max_players, unlimited_players FROM score_rooms WHERE id=?`, created.Room.ID).Scan(&physicalMax, &unlimited); err != nil {
		t.Fatal(err)
	}
	if physicalMax != 8 || unlimited != 1 {
		t.Fatalf("stored capacity max=%d unlimited=%d", physicalMax, unlimited)
	}
	seatStatus := func(room RoomSnapshot, participantID string) string {
		for _, participant := range room.Participants {
			if participant.ID == participantID {
				return participant.SeatStatus
			}
		}
		return ""
	}

	updatedSettings := v2Settings()
	updatedSettings.MaxPlayers = 0
	updatedSettings.AntePoints = 2
	updatedSettings.MaxBetPoints = 10
	room, err := s.UpdateZhaJinHuaSettings(ctx, created.Actor, CommandMeta{}, UpdateZhaJinHuaSettingsInput{Settings: &updatedSettings})
	if err != nil {
		t.Fatalf("update unlimited-room settings: %v", err)
	}
	if room.MaxPlayers != 0 || room.ZhaJinHuaSettings.AntePoints != 2 || room.ZhaJinHuaSettings.MaxBetPoints != 10 {
		t.Fatalf("updated settings lost unlimited capacity: %+v", room.ZhaJinHuaSettings)
	}
	for i := 1; i < 13; i++ {
		joined, err := s.JoinRoom(ctx, JoinRoomInput{Code: room.Code, DisplayName: fmt.Sprintf("P%d", i)})
		if err != nil {
			t.Fatalf("join %d: %v", i, err)
		}
		if seatStatus(joined.Room, joined.Room.SelfParticipantID) == "pending" {
			t.Fatalf("waiting-room join %d was pending", i)
		}
		room = joined.Room
	}
	if len(room.Participants) != 13 {
		t.Fatalf("participants=%d, want 13", len(room.Participants))
	}
	room, err = s.StartRoom(ctx, created.Actor, CommandMeta{})
	if err != nil {
		t.Fatal(err)
	}
	late, err := s.JoinRoom(ctx, JoinRoomInput{Code: room.Code, DisplayName: "Late"})
	if err != nil {
		t.Fatal(err)
	}
	if seatStatus(late.Room, late.Room.SelfParticipantID) != "pending" {
		t.Fatal("active-room join should remain pending")
	}
	room, err = s.ManageZhaJinHuaMember(ctx, created.Actor, CommandMeta{}, late.Actor.ParticipantID, ZhaJinHuaMemberInput{Action: "admit"})
	if err != nil {
		t.Fatalf("admit unlimited player: %v", err)
	}
	room, err = s.StartZhaJinHuaHand(ctx, created.Actor, CommandMeta{})
	if err != nil {
		t.Fatal(err)
	}
	if len(room.CurrentZhaJinHuaHand.Players) != 14 {
		t.Fatalf("hand players=%d, want 14", len(room.CurrentZhaJinHuaHand.Players))
	}
}

func v2Room(t *testing.T, count int, settings ZhaJinHuaSettings) (*Service, RoomSnapshot, []Actor) {
	t.Helper()
	s := newTestService(t)
	ctx := context.Background()
	created, err := s.CreateRoom(ctx, "host", "Host", CreateRoomInput{Name: "Poker", GameType: GameTypeZhaJinHua, MaxPlayers: 12, CentsPerPoint: 25, ZhaJinHuaSettings: &settings})
	if err != nil {
		t.Fatal(err)
	}
	actors := []Actor{created.Actor}
	room := created.Room
	for i := 1; i < count; i++ {
		j, err := s.JoinRoom(ctx, JoinRoomInput{Code: room.Code, DisplayName: fmt.Sprintf("P%d", i)})
		if err != nil {
			t.Fatal(err)
		}
		actors = append(actors, j.Actor)
		room = j.Room
	}
	return s, room, actors
}
func v2Settings() ZhaJinHuaSettings {
	return ZhaJinHuaSettings{RulesVersion: 2, AntePoints: 1, MaxBetPoints: 5, CompareThreshold: 3, BaoziBonusPoints: 20, ShunjinBonusPoints: 10}
}
func v2Start(t *testing.T, s *Service, actors []Actor) RoomSnapshot {
	t.Helper()
	r, err := s.StartRoom(context.Background(), actors[0], CommandMeta{})
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.StartZhaJinHuaHand(context.Background(), actors[0], CommandMeta{})
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func v2Act(t *testing.T, s *Service, r RoomSnapshot, a Actor, in ZhaJinHuaActionInput) RoomSnapshot {
	t.Helper()
	next, err := s.SubmitZhaJinHuaAction(context.Background(), a, CommandMeta{}, r.CurrentZhaJinHuaHand.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	return next
}

func TestV2TwelveThresholdUsesAdditiveLegacyStorage(t *testing.T) {
	settings := v2Settings()
	settings.CompareThreshold = 12
	s, r, actors := v2Room(t, 12, settings)
	if len(r.Participants) != 12 {
		t.Fatalf("players=%d", len(r.Participants))
	}
	r = v2Start(t, s, actors)
	if r.CurrentZhaJinHuaHand.Settings.CompareThreshold != 12 {
		t.Fatal("threshold truncated")
	}
	var physical int
	if err := s.store.db.QueryRow(`SELECT max_players FROM score_rooms WHERE id=?`, r.ID).Scan(&physical); err != nil {
		t.Fatal(err)
	}
	if physical != 8 {
		t.Fatalf("legacy capacity=%d", physical)
	}
}
func TestV2StartRequiresSeatedPlayers(t *testing.T) {
	s, r, a := v2Room(t, 2, v2Settings())
	ctx := context.Background()
	if _, err := s.ManageZhaJinHuaMember(ctx, a[1], CommandMeta{}, a[1].ParticipantID, ZhaJinHuaMemberInput{Action: "leave"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartRoom(ctx, a[0], CommandMeta{}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("start one seated=%v room=%s", err, r.ID)
	}
}
func TestV2FollowHistoryRecordsActualSeenCost(t *testing.T) {
	s, _, a := v2Room(t, 2, v2Settings())
	r := v2Start(t, s, a)
	r = v2Act(t, s, r, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionLook})
	r = v2Act(t, s, r, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionFollow})
	h := r.CurrentZhaJinHuaHand
	if h.PotPoints != 4 || h.Actions[1].Points != 2 {
		t.Fatalf("pot=%d actions=%+v", h.PotPoints, h.Actions)
	}
}
func TestV2CapCountsThreeSubsequentFullCircles(t *testing.T) {
	s, _, a := v2Room(t, 3, v2Settings())
	r := v2Start(t, s, a)
	r = v2Act(t, s, r, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionFollow})
	r = v2Act(t, s, r, a[1], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionRaise, Points: 5})
	order := []int{2, 0, 1, 2, 0, 1, 2, 0, 1}
	for i, index := range order {
		if r.CurrentZhaJinHuaHand.Phase != "betting" {
			t.Fatalf("early showdown at %d", i)
		}
		r = v2Act(t, s, r, a[index], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionFollow})
		want := 3 - (i+1)/3
		if r.CurrentZhaJinHuaHand.CapCirclesRemaining != want {
			t.Fatalf("action %d cap=%d want%d", i, r.CurrentZhaJinHuaHand.CapCirclesRemaining, want)
		}
	}
	if r.CurrentZhaJinHuaHand.Phase != "showdown" {
		t.Fatal("missing showdown")
	}
	if _, err := s.SubmitZhaJinHuaAction(context.Background(), a[1], CommandMeta{}, r.CurrentZhaJinHuaHand.ID, ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionShowdown, WinnerParticipantID: a[1].ParticipantID}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest showdown=%v", err)
	}
	r = v2Act(t, s, r, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionShowdown, WinnerParticipantID: a[2].ParticipantID})
	if r.CurrentZhaJinHuaHand.Phase != "bonus" {
		t.Fatal("missing bonus")
	}
}

func TestV2BonusPersistsZeroSumAndIsIdempotent(t *testing.T) {
	s, _, a := v2Room(t, 3, v2Settings())
	r := v2Start(t, s, a)
	ctx := context.Background()
	id := r.CurrentZhaJinHuaHand.ID
	r = v2Act(t, s, r, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionLook})
	meta := CommandMeta{ClientActionID: "pay", ExpectedRoomVersion: r.Version}
	input := ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionComparePay}
	paid, err := s.SubmitZhaJinHuaAction(ctx, a[0], meta, id, input)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := s.SubmitZhaJinHuaAction(ctx, a[0], meta, id, input)
	if err != nil || repeated.Version != paid.Version || repeated.CurrentZhaJinHuaHand.PotPoints != 5 {
		t.Fatalf("payment repeated %+v %v", repeated, err)
	}
	if _, err = s.SubmitZhaJinHuaAction(ctx, a[0], CommandMeta{}, id, input); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("pay again=%v", err)
	}
	r = v2Act(t, s, paid, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionCompareResult, TargetParticipantID: a[1].ParticipantID, Outcome: "tie"})
	if r.CurrentZhaJinHuaHand.CurrentTurnParticipantID != a[1].ParticipantID {
		t.Fatal("turn not advanced from initiator")
	}
	r = v2Act(t, s, r, a[1], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionFold})
	if r.CurrentZhaJinHuaHand.Phase != "bonus" {
		t.Fatal("missing bonus")
	}
	for _, p := range r.Participants {
		if p.TotalPoints != 0 {
			t.Fatal("premature ledger")
		}
	}
	bonus := ZhaJinHuaBonusInput{Bonuses: []ZhaJinHuaBonusEntry{{ParticipantID: a[0].ParticipantID, Kind: "baozi"}, {ParticipantID: a[1].ParticipantID, Kind: "shunjin"}}}
	meta = CommandMeta{ClientActionID: "bonus", ExpectedRoomVersion: r.Version}
	r, err = s.ConfirmZhaJinHuaBonuses(ctx, a[0], meta, id, bonus)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err = s.ConfirmZhaJinHuaBonuses(ctx, a[0], meta, id, bonus)
	if err != nil || repeated.Version != r.Version {
		t.Fatalf("bonus retry=%v", err)
	}
	want := map[string]int64{a[0].ParticipantID: 27, a[1].ParticipantID: -1, a[2].ParticipantID: -26}
	var sum int64
	for _, p := range r.Participants {
		if p.TotalPoints != want[p.ID] {
			t.Fatalf("%s=%d want%d", p.ID, p.TotalPoints, want[p.ID])
		}
		sum += p.TotalPoints
	}
	if sum != 0 {
		t.Fatal("non-zero ledger")
	}
	if r.Status != RoomActive || r.CurrentZhaJinHuaHand != nil || r.ZhaJinHuaHands[0].Phase != "finished" {
		t.Fatalf("finished state=%+v", r)
	}
	r, err = s.GetRoom(ctx, a[0])
	if err != nil || r.ZhaJinHuaHands[0].Players[0].BonusKind != "baozi" {
		t.Fatalf("persisted state=%v", err)
	}
}
func TestV2CancellationNeverWritesLedger(t *testing.T) {
	s, _, a := v2Room(t, 2, v2Settings())
	r := v2Start(t, s, a)
	id := r.CurrentZhaJinHuaHand.ID
	r = v2Act(t, s, r, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionFold})
	r, err := s.CancelZhaJinHuaHand(context.Background(), a[0], CommandMeta{}, id)
	if err != nil {
		t.Fatal(err)
	}
	if r.CurrentZhaJinHuaHand != nil {
		t.Fatal("cancelled hand active")
	}
	for _, p := range r.Participants {
		if p.TotalPoints != 0 {
			t.Fatal("cancel wrote ledger")
		}
	}
}

func TestV2MembershipPreservesIdentityAndUsesLiveHostRole(t *testing.T) {
	s, _, a := v2Room(t, 3, v2Settings())
	ctx := context.Background()
	r := v2Start(t, s, a)
	id := r.CurrentZhaJinHuaHand.ID
	if _, err := s.ManageZhaJinHuaMember(ctx, a[1], CommandMeta{}, a[1].ParticipantID, ZhaJinHuaMemberInput{Action: "leave"}); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("leave during hand=%v", err)
	}
	joined, err := s.JoinRoom(ctx, JoinRoomInput{Code: r.Code, DisplayName: "Late"})
	if err != nil {
		t.Fatal(err)
	}
	if joined.Room.Participants[3].SeatStatus != "pending" {
		t.Fatal("late join seated")
	}
	if _, err = s.SubmitZhaJinHuaAction(ctx, joined.Actor, CommandMeta{}, id, ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionLook}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("pending look=%v", err)
	}
	if _, err = s.CancelZhaJinHuaHand(ctx, a[0], CommandMeta{}, id); err != nil {
		t.Fatal(err)
	}
	manage := func(actor Actor, target, action string) RoomSnapshot {
		t.Helper()
		r, err := s.ManageZhaJinHuaMember(ctx, actor, CommandMeta{}, target, ZhaJinHuaMemberInput{Action: action})
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	manage(a[0], joined.Actor.ParticipantID, "admit")
	manage(a[1], a[1].ParticipantID, "leave")
	if _, err = s.GetRoom(ctx, a[1]); err != nil {
		t.Fatalf("left lost read access=%v", err)
	}
	manage(a[1], a[1].ParticipantID, "rejoin")
	manage(a[0], a[1].ParticipantID, "admit")
	manage(a[0], a[1].ParticipantID, "offer_host")
	if _, err = s.ManageZhaJinHuaMember(ctx, a[2], CommandMeta{}, a[1].ParticipantID, ZhaJinHuaMemberInput{Action: "accept_host"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("other accepts=%v", err)
	}
	manage(a[1], a[1].ParticipantID, "accept_host")
	if _, err = s.StartZhaJinHuaHand(ctx, a[0], CommandMeta{}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("stale host=%v", err)
	}
	a[0].Role = ParticipantGuest
	a[1].Role = ParticipantHost
	if _, err = s.StartZhaJinHuaHand(ctx, a[0], CommandMeta{}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("old host still host=%v", err)
	}
	r, err = s.StartZhaJinHuaHand(ctx, a[1], CommandMeta{})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.CurrentZhaJinHuaHand.Players) != 4 {
		t.Fatal("roster not updated")
	}
}
func TestV2CapSkipsEliminatedAndFoldedWithoutEarlyShowdown(t *testing.T) {
	s, _, a := v2Room(t, 4, v2Settings())
	r := v2Start(t, s, a)
	r = v2Act(t, s, r, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionRaise, Points: 5})
	r = v2Act(t, s, r, a[1], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionFold})
	r = v2Act(t, s, r, a[2], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionComparePay})
	r = v2Act(t, s, r, a[2], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionCompareResult, TargetParticipantID: a[3].ParticipantID, Outcome: "win"})
	if r.CurrentZhaJinHuaHand.CurrentTurnParticipantID != a[0].ParticipantID {
		t.Fatal("did not skip eliminated target")
	}
	if r.CurrentZhaJinHuaHand.CapCirclesRemaining != 3 {
		t.Fatal("partial circle counted")
	}
	r = v2Act(t, s, r, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionFollow})
	if r.CurrentZhaJinHuaHand.CapCirclesRemaining != 2 {
		t.Fatal("full circle not counted")
	}
	for _, i := range []int{2, 0, 2, 0} {
		r = v2Act(t, s, r, a[i], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionFollow})
	}
	if r.CurrentZhaJinHuaHand.Phase != "showdown" {
		t.Fatal("three complete circles not counted")
	}
}
func TestV2SettingsBoundsAndImmutableSettlementRate(t *testing.T) {
	for _, change := range []func(*ZhaJinHuaSettings){func(v *ZhaJinHuaSettings) { v.RulesVersion = 1 }, func(v *ZhaJinHuaSettings) { v.AntePoints = 0 }, func(v *ZhaJinHuaSettings) { v.MaxBetPoints = 0 }, func(v *ZhaJinHuaSettings) { v.CompareThreshold = 13 }, func(v *ZhaJinHuaSettings) { v.BaoziBonusPoints = -1 }} {
		settings := v2Settings()
		change(&settings)
		s := newTestService(t)
		if _, err := s.CreateRoom(context.Background(), "h", "H", CreateRoomInput{Name: "R", GameType: GameTypeZhaJinHua, MaxPlayers: 12, CentsPerPoint: 25, ZhaJinHuaSettings: &settings}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("settings=%+v err=%v", settings, err)
		}
	}
	s, _, a := v2Room(t, 2, v2Settings())
	r := v2Start(t, s, a)
	id := r.CurrentZhaJinHuaHand.ID
	r = v2Act(t, s, r, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionFold})
	if _, err := s.ConfirmZhaJinHuaBonuses(context.Background(), a[0], CommandMeta{}, id, ZhaJinHuaBonusInput{}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("implicit bonus=%v", err)
	}
	r, err := s.ConfirmZhaJinHuaBonuses(context.Background(), a[0], CommandMeta{}, id, ZhaJinHuaBonusInput{Bonuses: []ZhaJinHuaBonusEntry{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SettleRoom(context.Background(), a[0], CommandMeta{}, SettleRoomInput{CentsPerPoint: 100, UseSettlementRate: true}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("rate changed=%v", err)
	}
	r, err = s.SettleRoom(context.Background(), a[0], CommandMeta{}, SettleRoomInput{})
	if err != nil {
		t.Fatal(err)
	}
	if r.CentsPerPoint != 25 || r.Status != RoomSettled {
		t.Fatal("fixed rate lost")
	}
}

type v2CodeGenerator struct{}

func (v2CodeGenerator) Generate(_ context.Context, _ string) ([]byte, string, int, error) {
	return []byte("png"), "image/png", 200, nil
}
func TestV2ActiveInvitesAndPreviewUseSeats(t *testing.T) {
	s, r, a := v2Room(t, 12, v2Settings())
	ctx := context.Background()
	s.inviteCodeGenerator = v2CodeGenerator{}
	// Persistent departed identities must not consume seats in invite previews.
	if _, err := s.ManageZhaJinHuaMember(ctx, a[11], CommandMeta{}, a[11].ParticipantID, ZhaJinHuaMemberInput{Action: "leave"}); err != nil {
		t.Fatal(err)
	}
	token, err := s.IssueInviteToken(ctx, a[0])
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PreviewInvite(ctx, "", InvitePreviewInput{InviteToken: token}); err != nil {
		t.Fatalf("preview occupied history=%v", err)
	}
	r = v2Start(t, s, a)
	id := r.CurrentZhaJinHuaHand.ID
	token, err = s.IssueInviteToken(ctx, a[0])
	if err != nil {
		t.Fatalf("active token=%v", err)
	}
	qr, err := s.IssueInviteCode(ctx, a[0])
	if err != nil {
		t.Fatalf("active qr=%v", err)
	}
	if _, err = s.PreviewInvite(ctx, "", InvitePreviewInput{InviteScene: qr.InviteScene}); err != nil {
		t.Fatalf("active scene preview=%v", err)
	}
	joined, err := s.JoinRoom(ctx, JoinRoomInput{InviteScene: qr.InviteScene, DisplayName: "LateQR"})
	if err != nil {
		t.Fatal(err)
	}
	if len(joined.Room.CurrentZhaJinHuaHand.Players) != 11 {
		t.Fatal("invite mutated frozen roster")
	}
	var seat string
	for _, p := range joined.Room.Participants {
		if p.ID == joined.Actor.ParticipantID {
			seat = p.SeatStatus
		}
	}
	if seat != "pending" {
		t.Fatalf("late seat=%s", seat)
	}
	if _, err = s.CancelZhaJinHuaHand(ctx, a[0], CommandMeta{}, id); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SettleRoom(ctx, a[0], CommandMeta{}, SettleRoomInput{}); err != nil {
		t.Fatalf("zero ledger settle=%v", err)
	}
	if _, err = s.JoinRoom(ctx, JoinRoomInput{Code: r.Code, DisplayName: "Closed"}); !errors.Is(err, ErrRoomNotFound) {
		t.Fatalf("closed join=%v", err)
	}
	if _, err = s.IssueInviteToken(ctx, a[0]); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("closed token=%v", err)
	}
	if _, err = s.IssueInviteCode(ctx, a[0]); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("closed qr=%v", err)
	}
	if _, err = s.PreviewInvite(ctx, "", InvitePreviewInput{InviteToken: token}); !errors.Is(err, ErrInviteInvalid) {
		t.Fatalf("closed preview=%v", err)
	}
}
func TestV2CancelledOnlyHandCanSettleZeroLedger(t *testing.T) {
	s, _, a := v2Room(t, 2, v2Settings())
	r := v2Start(t, s, a)
	ctx := context.Background()
	if _, err := s.CancelZhaJinHuaHand(ctx, a[0], CommandMeta{}, r.CurrentZhaJinHuaHand.ID); err != nil {
		t.Fatal(err)
	}
	r, err := s.SettleRoom(ctx, a[0], CommandMeta{}, SettleRoomInput{})
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != RoomSettled || len(r.Settlement.Transfers) != 0 {
		t.Fatalf("zero settlement=%+v", r.Settlement)
	}
}

func TestV2CancelledHistoryPreservesNumbersAndLastFinishedWinner(t *testing.T) {
	s, _, a := v2Room(t, 2, v2Settings())
	ctx := context.Background()
	r := v2Start(t, s, a)
	r, err := s.CancelZhaJinHuaHand(ctx, a[0], CommandMeta{}, r.CurrentZhaJinHuaHand.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.ZhaJinHuaHands) != 1 || r.ZhaJinHuaHands[0].Number != 1 || r.ZhaJinHuaHands[0].Status != ZhaJinHuaHandCancelled || r.ZhaJinHuaHands[0].CancelledAt == nil {
		t.Fatalf("cancelled history=%+v", r.ZhaJinHuaHands)
	}
	r, err = s.StartZhaJinHuaHand(ctx, a[0], CommandMeta{})
	if err != nil {
		t.Fatal(err)
	}
	if r.CurrentZhaJinHuaHand.Number != 2 {
		t.Fatal("cancelled number reused")
	}
	id := r.CurrentZhaJinHuaHand.ID
	r = v2Act(t, s, r, a[0], ZhaJinHuaActionInput{ActionType: ZhaJinHuaActionFold})
	r, err = s.ConfirmZhaJinHuaBonuses(ctx, a[0], CommandMeta{}, id, ZhaJinHuaBonusInput{Bonuses: []ZhaJinHuaBonusEntry{}})
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.StartZhaJinHuaHand(ctx, a[0], CommandMeta{})
	if err != nil {
		t.Fatal(err)
	}
	r, err = s.CancelZhaJinHuaHand(ctx, a[0], CommandMeta{}, r.CurrentZhaJinHuaHand.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.ZhaJinHuaHands) != 3 || r.ZhaJinHuaHands[0].Number != 3 || r.ZhaJinHuaHands[1].Number != 2 {
		t.Fatalf("ordered history=%+v", r.ZhaJinHuaHands)
	}
	r, err = s.StartZhaJinHuaHand(ctx, a[0], CommandMeta{})
	if err != nil {
		t.Fatal(err)
	}
	if r.CurrentZhaJinHuaHand.Number != 4 || r.CurrentZhaJinHuaHand.CurrentTurnParticipantID != a[1].ParticipantID {
		t.Fatalf("cancel reset winner or sequence: %+v", r.CurrentZhaJinHuaHand)
	}
}
