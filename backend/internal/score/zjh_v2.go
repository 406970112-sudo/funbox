package score

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
)

const (
	ZhaJinHuaActionFollow        ZhaJinHuaActionType   = "follow"
	ZhaJinHuaActionLook          ZhaJinHuaActionType   = "look"
	ZhaJinHuaActionComparePay    ZhaJinHuaActionType   = "compare_pay"
	ZhaJinHuaActionCompareResult ZhaJinHuaActionType   = "compare_result"
	ZhaJinHuaActionShowdown      ZhaJinHuaActionType   = "showdown"
	ZhaJinHuaPlayerEliminated    ZhaJinHuaPlayerStatus = "eliminated"
)

type ZhaJinHuaBonusEntry struct {
	ParticipantID string `json:"participantId"`
	Kind          string `json:"kind"`
}
type ZhaJinHuaBonusInput struct {
	Bonuses []ZhaJinHuaBonusEntry `json:"bonuses"`
}
type ZhaJinHuaMemberInput struct {
	Action string `json:"action"`
}

func validateV2Settings(v ZhaJinHuaSettings) error {
	validPlayers := v.MaxPlayers == 0 || (v.MaxPlayers >= 2 && v.MaxPlayers <= 12)
	validThreshold := v.CompareThreshold >= 2 && (v.MaxPlayers == 0 || v.CompareThreshold <= v.MaxPlayers)
	if v.RulesVersion != 2 || !validPlayers || v.AntePoints < 1 || v.AntePoints > 1_000_000_000 || v.MaxBetPoints < v.AntePoints || v.MaxBetPoints > 1_000_000_000 || !validThreshold || v.BaoziBonusPoints < 0 || v.BaoziBonusPoints > 1_000_000_000 || v.ShunjinBonusPoints < 0 || v.ShunjinBonusPoints > 1_000_000_000 {
		return ErrInvalidInput
	}
	return nil
}
func saveV2Settings(ctx context.Context, tx *sql.Tx, id string, v ZhaJinHuaSettings) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO score_zjh_v2_settings(room_id,settings_json) VALUES (?,?) ON CONFLICT(room_id) DO UPDATE SET settings_json=excluded.settings_json`, id, string(data))
	return err
}
func loadV2Room(ctx context.Context, q queryer, r *RoomSnapshot) error {
	var data string
	err := q.QueryRowContext(ctx, `SELECT settings_json,pending_host_id FROM score_zjh_v2_settings WHERE room_id=?`, r.ID).Scan(&data, &r.PendingHostParticipantID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = json.Unmarshal([]byte(data), &r.ZhaJinHuaSettings); err != nil {
		return err
	}
	r.MaxPlayers = r.ZhaJinHuaSettings.MaxPlayers
	for i := range r.Participants {
		r.Participants[i].SeatStatus = "seated"
		err = q.QueryRowContext(ctx, `SELECT seat_status FROM score_zjh_seats WHERE participant_id=?`, r.Participants[i].ID).Scan(&r.Participants[i].SeatStatus)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
	}
	return nil
}
func seatedV2(ps []Participant) []Participant {
	out := []Participant{}
	for _, p := range ps {
		if p.Status == ParticipantActive && (p.SeatStatus == "seated" || p.SeatStatus == "") {
			out = append(out, p)
		}
	}
	return out
}
func (s *Service) updateV2Settings(ctx context.Context, tx *sql.Tx, r RoomSnapshot, a Actor, in UpdateZhaJinHuaSettingsInput) error {
	if a.Role != ParticipantHost {
		return ErrForbidden
	}
	if r.CurrentZhaJinHuaHand != nil || in.Settings == nil {
		return ErrInvalidState
	}
	v := *in.Settings
	v.MaxPlayers = r.MaxPlayers
	v.ForceOpenThreshold = v.CompareThreshold
	if err := validateV2Settings(v); err != nil {
		return err
	}
	return saveV2Settings(ctx, tx, r.ID, v)
}
func saveV2Hand(ctx context.Context, tx *sql.Tx, h *ZhaJinHuaHand) error {
	data, err := json.Marshal(h)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO score_zjh_v2_hands(hand_id,hand_json) VALUES (?,?) ON CONFLICT(hand_id) DO UPDATE SET hand_json=excluded.hand_json`, h.ID, string(data))
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE score_zjh_hands SET status=?,pot_points=?,current_turn_participant_id=NULLIF(?,''),winner_participant_id=NULLIF(?,''),finished_at=?,cancelled_at=? WHERE id=?`, h.Status, h.PotPoints, h.CurrentTurnParticipantID, h.WinnerParticipantID, v2Unix(h.FinishedAt), v2Unix(h.CancelledAt), h.ID)
	return err
}
func activeV2(h *ZhaJinHuaHand) []string {
	out := []string{}
	for _, p := range h.Players {
		if p.Status == ZhaJinHuaPlayerActive {
			out = append(out, p.ParticipantID)
		}
	}
	return out
}
func (s *Service) startV2Hand(ctx context.Context, tx *sql.Tx, r RoomSnapshot, a Actor) error {
	if a.Role != ParticipantHost {
		return ErrForbidden
	}
	if r.Status != RoomActive || r.CurrentRound != nil || r.CurrentZhaJinHuaHand != nil {
		return ErrInvalidState
	}
	ps := seatedV2(r.Participants)
	if len(ps) < 2 {
		return ErrInvalidState
	}
	h := ZhaJinHuaHand{ID: uuid.NewString(), RoomID: r.ID, RulesVersion: 2, Phase: "betting", Settings: r.ZhaJinHuaSettings, Status: ZhaJinHuaHandActive, CreatedBy: a.ParticipantID, CreatedAt: s.now().UTC(), CurrentBetPoints: r.ZhaJinHuaSettings.AntePoints, CircleNumber: 1, ForceOpenThreshold: r.ZhaJinHuaSettings.CompareThreshold, Actions: []ZhaJinHuaAction{}}
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(number),0)+1 FROM score_zjh_hands WHERE room_id=?`, r.ID).Scan(&h.Number); err != nil {
		return err
	}
	for i, p := range ps {
		h.Players = append(h.Players, ZhaJinHuaPlayer{ParticipantID: p.ID, Position: i + 1, Status: ZhaJinHuaPlayerActive, ContributionPoints: h.Settings.AntePoints})
		h.PotPoints += h.Settings.AntePoints
	}
	h.CurrentTurnParticipantID = ps[0].ID
	for _, last := range r.ZhaJinHuaHands {
		if last.Status != ZhaJinHuaHandFinished {
			continue
		}
		if p := findZhaJinHuaPlayer(h.Players, last.WinnerParticipantID); p != nil {
			h.CurrentTurnParticipantID = p.ParticipantID
		}
		break
	}
	h.CirclePending = activeV2(&h)
	if h.CurrentBetPoints == h.Settings.MaxBetPoints {
		h.CapStarted = true
		h.CapCirclesRemaining = 3
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO score_zjh_hands(id,room_id,number,status,pot_points,current_turn_participant_id,force_open_threshold,force_open_fee_points,created_by,created_at) VALUES (?,?,?,'active',?,?,?,?,?,?)`, h.ID, h.RoomID, h.Number, h.PotPoints, h.CurrentTurnParticipantID, min(h.ForceOpenThreshold, 8), 1, h.CreatedBy, h.CreatedAt.Unix())
	if err != nil {
		return err
	}
	return saveV2Hand(ctx, tx, &h)
}
func bonusV2(h *ZhaJinHuaHand, winner string) {
	h.WinnerParticipantID = winner
	h.Phase = "bonus"
	h.CurrentTurnParticipantID = ""
	h.PendingComparison = nil
	for i := range h.Players {
		p := &h.Players[i]
		p.IsWinner = p.ParticipantID == winner
		p.GamePoints = -p.ContributionPoints
		if p.IsWinner {
			p.GamePoints += h.PotPoints
		}
		p.DeltaPoints = p.GamePoints
	}
}
func advanceV2(h *ZhaJinHuaHand, actor string, trigger bool) {
	active := activeV2(h)
	if len(active) == 1 {
		bonusV2(h, active[0])
		return
	}
	pos := 0
	for i, p := range h.Players {
		if p.ParticipantID == actor {
			pos = i
			break
		}
	}
	for n := 1; n <= len(h.Players); n++ {
		p := h.Players[(pos+n)%len(h.Players)]
		if p.Status == ZhaJinHuaPlayerActive {
			h.CurrentTurnParticipantID = p.ParticipantID
			break
		}
	}
	if trigger {
		h.CapStarted = true
		h.CapCirclesRemaining = 3
		h.CirclePending = active
		return
	}
	pending := []string{}
	for _, id := range h.CirclePending {
		if id != actor && containsString(active, id) {
			pending = append(pending, id)
		}
	}
	h.CirclePending = pending
	if len(pending) == 0 {
		h.CircleNumber++
		h.CirclePending = active
		if h.CapStarted {
			h.CapCirclesRemaining--
			if h.CapCirclesRemaining == 0 {
				h.Phase = "showdown"
				h.CurrentTurnParticipantID = ""
			}
		}
	}
}
func (s *Service) actionV2(ctx context.Context, tx *sql.Tx, r RoomSnapshot, a Actor, id string, in ZhaJinHuaActionInput) error {
	h := r.CurrentZhaJinHuaHand
	if h == nil || h.ID != id || r.Status != RoomActive {
		return ErrInvalidZJHHand
	}
	recordedPoints := in.Points
	p := findZhaJinHuaPlayer(h.Players, a.ParticipantID)
	if in.ActionType == ZhaJinHuaActionShowdown {
		if a.Role != ParticipantHost {
			return ErrForbidden
		}
		if h.Phase != "showdown" {
			return ErrInvalidState
		}
		w := findZhaJinHuaPlayer(h.Players, in.WinnerParticipantID)
		if w == nil || w.Status != ZhaJinHuaPlayerActive {
			return ErrInvalidInput
		}
		bonusV2(h, w.ParticipantID)
	} else {
		if p == nil || p.Status != ZhaJinHuaPlayerActive {
			return ErrForbidden
		}
		if in.ActionType == ZhaJinHuaActionLook {
			if h.Phase != "betting" || p.Seen {
				return ErrInvalidState
			}
			p.Seen = true
		} else {
			if h.CurrentTurnParticipantID != a.ParticipantID {
				return ErrNotYourTurn
			}
			if h.Phase == "comparing" {
				if in.ActionType != ZhaJinHuaActionCompareResult || h.PendingComparison == nil || h.PendingComparison.ActorParticipantID != a.ParticipantID {
					return ErrInvalidState
				}
				target := findZhaJinHuaPlayer(h.Players, in.TargetParticipantID)
				if target == nil || target.ParticipantID == a.ParticipantID || target.Status != ZhaJinHuaPlayerActive {
					return ErrInvalidInput
				}
				loser := p
				switch in.Outcome {
				case "win":
					loser = target
				case "lose", "tie":
				default:
					return ErrInvalidInput
				}
				loser.Status = ZhaJinHuaPlayerEliminated
				loser.ExitReason = "compare"
				h.PendingComparison = nil
				h.Phase = "betting"
				advanceV2(h, a.ParticipantID, false)
			} else {
				if h.Phase != "betting" {
					return ErrInvalidState
				}
				trigger := false
				switch in.ActionType {
				case ZhaJinHuaActionFold:
					p.Status = ZhaJinHuaPlayerFolded
					p.ExitReason = "fold"
				case ZhaJinHuaActionFollow, ZhaJinHuaActionRaise, ZhaJinHuaActionComparePay:
					if in.ActionType == ZhaJinHuaActionRaise {
						if in.Points <= h.CurrentBetPoints || in.Points > h.Settings.MaxBetPoints {
							return ErrInvalidInput
						}
						h.CurrentBetPoints = in.Points
						trigger = in.Points == h.Settings.MaxBetPoints && !h.CapStarted
					}
					if in.ActionType == ZhaJinHuaActionComparePay && len(activeV2(h)) > h.Settings.CompareThreshold {
						return ErrForceOpenLocked
					}
					cost := h.CurrentBetPoints
					if p.Seen {
						cost *= 2
					}
					if h.PotPoints > 1_000_000_000_000-cost {
						return ErrCapExceeded
					}
					if in.ActionType != ZhaJinHuaActionRaise {
						recordedPoints = cost
					}
					p.ContributionPoints += cost
					h.PotPoints += cost
					if in.ActionType == ZhaJinHuaActionComparePay {
						h.PendingComparison = &ZhaJinHuaComparison{ActorParticipantID: a.ParticipantID, Points: cost}
						h.Phase = "comparing"
					}
				default:
					return ErrInvalidInput
				}
				if h.Phase != "comparing" {
					advanceV2(h, a.ParticipantID, trigger)
				}
			}
		}
	}
	h.Actions = append(h.Actions, ZhaJinHuaAction{Sequence: len(h.Actions) + 1, ActionType: in.ActionType, ActorParticipantID: a.ParticipantID, TargetParticipantID: in.TargetParticipantID, WinnerParticipantID: in.WinnerParticipantID, Points: recordedPoints, Outcome: in.Outcome, CreatedAt: s.now().UTC()})
	return saveV2Hand(ctx, tx, h)
}
func (s *Service) cancelV2(ctx context.Context, tx *sql.Tx, r RoomSnapshot, a Actor, id string) error {
	if a.Role != ParticipantHost {
		return ErrForbidden
	}
	h := r.CurrentZhaJinHuaHand
	if h == nil || h.ID != id {
		return ErrInvalidZJHHand
	}
	h.Status = ZhaJinHuaHandCancelled
	h.Phase = "cancelled"
	h.CurrentTurnParticipantID = ""
	now := s.now().UTC()
	h.CancelledAt = &now
	return saveV2Hand(ctx, tx, h)
}
func (s *Service) ConfirmZhaJinHuaBonuses(ctx context.Context, a Actor, m CommandMeta, id string, in ZhaJinHuaBonusInput) (RoomSnapshot, error) {
	payload := struct {
		HandID string `json:"handId"`
		ZhaJinHuaBonusInput
	}{id, in}
	return s.mutate(ctx, a, m, "zjh.bonus.confirm", payload, func(tx *sql.Tx, r RoomSnapshot) error {
		if a.Role != ParticipantHost {
			return ErrForbidden
		}
		h := r.CurrentZhaJinHuaHand
		if h == nil || h.ID != id || h.RulesVersion != 2 || h.Phase != "bonus" {
			return ErrInvalidState
		}
		if in.Bonuses == nil {
			return ErrInvalidInput
		}
		seen := map[string]bool{}
		for _, b := range in.Bonuses {
			p := findZhaJinHuaPlayer(h.Players, b.ParticipantID)
			if p == nil || seen[b.ParticipantID] {
				return ErrInvalidInput
			}
			seen[b.ParticipantID] = true
			var points int64
			switch b.Kind {
			case "baozi":
				points = h.Settings.BaoziBonusPoints
			case "shunjin":
				points = h.Settings.ShunjinBonusPoints
			default:
				return ErrInvalidInput
			}
			p.BonusKind = b.Kind
			for i := range h.Players {
				other := &h.Players[i]
				if other.ParticipantID != p.ParticipantID {
					other.BonusPoints -= points
					p.BonusPoints += points
				}
			}
		}
		for i := range h.Players {
			p := &h.Players[i]
			p.DeltaPoints = p.GamePoints + p.BonusPoints
			var total int64
			for _, member := range r.Participants {
				if member.ID == p.ParticipantID {
					total = member.TotalPoints
					break
				}
			}
			limit := int64(math.MaxInt64) / r.CentsPerPoint / 24
			if total > limit-p.DeltaPoints || total < -limit-p.DeltaPoints {
				return ErrCapExceeded
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO score_zjh_ledger(hand_id,participant_id,delta_points) VALUES (?,?,?)`, id, p.ParticipantID, p.DeltaPoints); err != nil {
				return err
			}
		}
		now := s.now().UTC()
		h.FinishedAt = &now
		h.Status = ZhaJinHuaHandFinished
		h.Phase = "finished"
		return saveV2Hand(ctx, tx, h)
	})
}
func (s *Service) ManageZhaJinHuaMember(ctx context.Context, a Actor, m CommandMeta, id string, in ZhaJinHuaMemberInput) (RoomSnapshot, error) {
	payload := struct {
		ParticipantID string `json:"participantId"`
		ZhaJinHuaMemberInput
	}{id, in}
	return s.mutate(ctx, a, m, "zjh.member", payload, func(tx *sql.Tx, r RoomSnapshot) error {
		if r.ZhaJinHuaSettings.RulesVersion != 2 || r.CurrentZhaJinHuaHand != nil {
			return ErrInvalidState
		}
		var target *Participant
		for i := range r.Participants {
			if r.Participants[i].ID == id {
				target = &r.Participants[i]
				break
			}
		}
		if target == nil {
			return ErrParticipantMissing
		}
		status := ""
		switch in.Action {
		case "leave":
			if id != a.ParticipantID || a.Role == ParticipantHost {
				return ErrForbidden
			}
			if target.SeatStatus != "seated" {
				return ErrInvalidState
			}
			status = "left"
		case "rejoin":
			if id != a.ParticipantID {
				return ErrForbidden
			}
			if target.SeatStatus != "left" {
				return ErrInvalidState
			}
			status = "pending"
		case "admit":
			if a.Role != ParticipantHost {
				return ErrForbidden
			}
			if target.SeatStatus != "pending" {
				return ErrInvalidState
			}
			if r.MaxPlayers > 0 && len(seatedV2(r.Participants)) >= r.MaxPlayers {
				return ErrRoomFull
			}
			status = "seated"
		case "offer_host":
			if a.Role != ParticipantHost || id == a.ParticipantID {
				return ErrForbidden
			}
			if target.SeatStatus != "seated" {
				return ErrInvalidState
			}
			_, err := tx.ExecContext(ctx, `UPDATE score_zjh_v2_settings SET pending_host_id=? WHERE room_id=?`, id, r.ID)
			return err
		case "accept_host":
			if id != a.ParticipantID || r.PendingHostParticipantID != id || target.SeatStatus != "seated" {
				return ErrForbidden
			}
			if _, err := tx.ExecContext(ctx, `UPDATE score_participants SET role=CASE WHEN id=? THEN 'host' ELSE 'guest' END WHERE room_id=?`, id, r.ID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE score_rooms SET host_user_id=? WHERE id=?`, target.UserID, r.ID); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, `UPDATE score_zjh_v2_settings SET pending_host_id='' WHERE room_id=?`, r.ID)
			return err
		default:
			return ErrInvalidInput
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO score_zjh_seats(participant_id,seat_status) VALUES (?,?) ON CONFLICT(participant_id) DO UPDATE SET seat_status=excluded.seat_status`, id, status)
		if err != nil {
			return err
		}
		if r.PendingHostParticipantID == id {
			_, err = tx.ExecContext(ctx, `UPDATE score_zjh_v2_settings SET pending_host_id='' WHERE room_id=?`, r.ID)
		}
		return err
	})
}

func v2Unix(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.Unix()
}

// Legacy rooms accept invites only while waiting; V2 rooms accept pending
// members throughout active play. Admission remains a separate host operation.
const scoreInviteOpenPredicate = "(status = 'waiting' OR (status = 'active' AND EXISTS (SELECT 1 FROM score_zjh_v2_settings v2 WHERE v2.room_id = score_rooms.id)))"
