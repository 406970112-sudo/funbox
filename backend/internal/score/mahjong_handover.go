package score

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const mahjongHandoverTTL = 5 * time.Minute

var (
	ErrHandoverScoreChanged = errors.New("mahjong seat score changed")
	ErrHandoverClaimed      = errors.New("mahjong seat handover already claimed")
)

type MahjongHandoverInput struct {
	Action        string `json:"action"`
	ParticipantID string `json:"participantId,omitempty"`
	HandoverID    string `json:"handoverId,omitempty"`
}

type MahjongHandoverAcceptance struct {
	Scene            string `json:"scene"`
	ClaimToken       string `json:"claimToken"`
	DisplayName      string `json:"displayName,omitempty"`
	ParticipantToken string `json:"participantToken,omitempty"`
	UserID           string `json:"-"`
	Points           int64  `json:"points"`
}

type MahjongHandover struct {
	ID                string    `json:"id"`
	FromParticipantID string    `json:"fromParticipantId"`
	FromName          string    `json:"fromName"`
	Seat              int       `json:"seat"`
	Points            int64     `json:"points"`
	ExpiresAt         time.Time `json:"expiresAt"`
	Status            string    `json:"status"`
	CandidateName     string    `json:"candidateName,omitempty"`
}

type MahjongHandoverEvent struct {
	ID                string    `json:"id"`
	FromParticipantID string    `json:"fromParticipantId"`
	FromName          string    `json:"fromName"`
	ToParticipantID   string    `json:"toParticipantId"`
	ToName            string    `json:"toName"`
	Seat              int       `json:"seat"`
	Points            int64     `json:"points"`
	CreatedAt         time.Time `json:"createdAt"`
}

type MahjongHandoverPreview struct {
	RoomID              string     `json:"roomId"`
	RoomCode            string     `json:"roomCode"`
	RoomName            string     `json:"roomName"`
	FromName            string     `json:"fromName"`
	Seat                int        `json:"seat"`
	Points              int64      `json:"points"`
	ExpiresAt           time.Time  `json:"expiresAt"`
	CredentialExpiresAt *time.Time `json:"credentialExpiresAt,omitempty"`
	Status              string     `json:"status"`
	ClaimToken          string     `json:"claimToken,omitempty"`
	GuestToken          string     `json:"guestToken,omitempty"`
	ParticipantID       string     `json:"participantId,omitempty"`
}

type mahjongHandoverRecord struct {
	id                    string
	roomID                string
	fromID                string
	status                string
	claimHash             string
	candidateName         string
	candidateUserID       string
	candidateID           sql.NullString
	seat                  int
	expiresAt             int64
	acceptedPoints        int64
	completedTokenVersion sql.NullInt64
}

func findMahjongHandover(ctx context.Context, q queryer, scene string) (mahjongHandoverRecord, error) {
	var record mahjongHandoverRecord
	err := q.QueryRowContext(ctx, `
		SELECT id, room_id, from_participant_id, seat, expires_at, status, claim_hash, candidate_id,
			candidate_name, candidate_user_id, accepted_points, completed_token_version
		FROM score_mahjong_handovers WHERE scene = ?`, scene).Scan(
		&record.id, &record.roomID, &record.fromID, &record.seat, &record.expiresAt, &record.status,
		&record.claimHash, &record.candidateID, &record.candidateName, &record.candidateUserID,
		&record.acceptedPoints, &record.completedTokenVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return record, ErrInviteInvalid
	}
	return record, err
}

func loadMahjongRoom(ctx context.Context, q queryer, room *RoomSnapshot) error {
	var totals [5]int64
	participants := make(map[string]*Participant, len(room.Participants))
	for i := range room.Participants {
		p := &room.Participants[i]
		participants[p.ID] = p
		if p.MahjongSeat != 0 {
			totals[p.MahjongSeat] += p.TotalPoints
		}
	}
	for i := range room.Participants {
		p := &room.Participants[i]
		if p.MahjongSeat == 0 {
			continue
		}
		if p.Status == ParticipantActive {
			p.TotalPoints = totals[p.MahjongSeat]
			p.AmountCents = p.TotalPoints * room.CentsPerPoint
		}
		if p.Status == ParticipantLeft && p.LeftAtPoints != nil {
			p.TotalPoints = *p.LeftAtPoints
			p.AmountCents = 0
		}
	}

	err := q.QueryRowContext(ctx, `SELECT participant_id FROM score_mahjong_host_offers WHERE room_id = ?`,
		room.ID).Scan(&room.PendingHostParticipantID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	rows, err := q.QueryContext(ctx, `
		SELECT id, from_participant_id, COALESCE(candidate_id, ''), seat, expires_at, status,
			candidate_name, accepted_points, completed_at
		FROM score_mahjong_handovers
		WHERE room_id = ? AND status IN ('open', 'accepted', 'reconfirm', 'completed')
		ORDER BY rowid`, room.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, fromID, toID, status, candidateName string
		var seat int
		var expiresAt, acceptedPoints int64
		var completedAt sql.NullInt64
		if err := rows.Scan(&id, &fromID, &toID, &seat, &expiresAt, &status, &candidateName, &acceptedPoints, &completedAt); err != nil {
			return err
		}
		from := participants[fromID]
		if from == nil {
			return fmt.Errorf("load Mahjong handover %s: %w", id, ErrParticipantMissing)
		}
		if status == "completed" {
			room.MahjongHandovers = append(room.MahjongHandovers, MahjongHandoverEvent{
				ID: id, FromParticipantID: fromID, FromName: from.DisplayName, ToParticipantID: toID,
				ToName: candidateName, Seat: seat, Points: acceptedPoints, CreatedAt: time.Unix(completedAt.Int64, 0).UTC(),
			})
			continue
		}
		if status == "accepted" && acceptedPoints != from.TotalPoints {
			status = "reconfirm"
		}
		room.MahjongHandover = &MahjongHandover{
			ID: id, FromParticipantID: fromID, FromName: from.DisplayName, Seat: seat, Points: from.TotalPoints,
			ExpiresAt: time.Unix(expiresAt, 0).UTC(), Status: status, CandidateName: candidateName,
		}
	}
	return rows.Err()
}

func mahjongTableEligible(room RoomSnapshot) bool {
	return room.GameType == GameTypeMahjong && room.Status == RoomActive && room.CurrentRound == nil &&
		room.CurrentZhaJinHuaHand == nil && len(activeParticipants(room.Participants)) == 4
}

func mahjongParticipant(room RoomSnapshot, id string) *Participant {
	for i := range room.Participants {
		if room.Participants[i].ID == id {
			return &room.Participants[i]
		}
	}
	return nil
}

func seedMahjongSeats(ctx context.Context, tx *sql.Tx, roomID string) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO score_mahjong_seats(participant_id, seat)
		SELECT id, ROW_NUMBER() OVER (ORDER BY joined_at, rowid)
		FROM score_participants WHERE room_id = ? AND status = 'active'
		ON CONFLICT(participant_id) DO NOTHING`, roomID)
	return err
}

func (s *Service) ManageMahjongHandover(ctx context.Context, actor Actor, meta CommandMeta, input MahjongHandoverInput) (RoomSnapshot, error) {
	input.Action = strings.TrimSpace(input.Action)
	input.ParticipantID = strings.TrimSpace(input.ParticipantID)
	input.HandoverID = strings.TrimSpace(input.HandoverID)
	if (input.Action == "confirm" || input.Action == "accept_host") && meta.ExpectedRoomVersion <= 0 {
		return RoomSnapshot{}, fmt.Errorf("room version: %w", ErrInvalidInput)
	}
	return s.mutate(ctx, actor, meta, "mahjong.handover."+input.Action, input, func(tx *sql.Tx, room RoomSnapshot) error {
		if !mahjongTableEligible(room) {
			return ErrInvalidState
		}
		if input.Action == "accept_host" {
			return acceptMahjongHostOffer(ctx, tx, actor, room, input.ParticipantID)
		}
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		switch input.Action {
		case "offer_host":
			return offerMahjongHost(ctx, tx, actor, room, input.ParticipantID)
		case "cancel_host":
			return clearMahjongHostOffer(ctx, tx, room.ID)
		case "invite":
			return s.createMahjongHandover(ctx, tx, room, input.ParticipantID)
		case "cancel", "confirm":
			h := room.MahjongHandover
			if h == nil || h.ID != input.HandoverID {
				return ErrInvalidState
			}
			if input.Action == "cancel" {
				_, err := tx.ExecContext(ctx, `UPDATE score_mahjong_handovers SET status = 'cancelled' WHERE id = ?`, h.ID)
				return err
			}
			return s.completeMahjongHandover(ctx, tx, room, h)
		default:
			return ErrInvalidInput
		}
	})
}

func (s *Service) createMahjongHandover(ctx context.Context, tx *sql.Tx, room RoomSnapshot, id string) error {
	from := mahjongParticipant(room, id)
	if from == nil || from.Status != ParticipantActive {
		return ErrParticipantMissing
	}
	if from.Role == ParticipantHost {
		return ErrForbidden
	}
	if room.PendingHostParticipantID == from.ID || room.MahjongHandover != nil {
		return ErrInvalidState
	}
	// Scored players removed from older rooms have no seat in the current four.
	if mentionsUnseatedFormerPlayer(room) {
		return ErrInvalidState
	}
	if from.MahjongSeat == 0 {
		// Active legacy rooms acquire their seat numbers on the first handover.
		if err := seedMahjongSeats(ctx, tx, room.ID); err != nil {
			return err
		}
		var err error
		room, err = s.loadRoomSnapshot(ctx, tx, room.ID)
		if err != nil {
			return err
		}
		from = mahjongParticipant(room, id)
	}
	now := s.now().UTC()
	if _, err := tx.ExecContext(ctx, `UPDATE score_mahjong_handovers SET status = 'expired'
		WHERE room_id = ? AND status IN ('open', 'accepted', 'reconfirm') AND expires_at <= ?`, room.ID, now.Unix()); err != nil {
		return err
	}
	scene, err := randomInviteScene()
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO score_mahjong_handovers (id, room_id, scene, from_participant_id, seat, expires_at, status)
		VALUES (?, ?, ?, ?, ?, ?, 'open')`, uuid.NewString(), room.ID, "h_"+scene, from.ID, from.MahjongSeat, now.Add(mahjongHandoverTTL).Unix())
	return err
}

func mentionsUnseatedFormerPlayer(room RoomSnapshot) bool {
	unseated := make(map[string]bool)
	for _, p := range room.Participants {
		if p.Status != ParticipantActive && p.MahjongSeat == 0 {
			unseated[p.ID] = true
		}
	}
	if len(unseated) == 0 {
		return false
	}
	for _, batch := range room.GiftBatches {
		for _, gift := range batch.Gifts {
			if unseated[gift.FromParticipantID] || unseated[gift.ToParticipantID] {
				return true
			}
		}
	}
	for _, round := range room.Rounds {
		for _, entry := range round.Entries {
			if unseated[entry.ParticipantID] {
				return true
			}
		}
	}
	return false
}

func (s *Service) completeMahjongHandover(ctx context.Context, tx *sql.Tx, room RoomSnapshot, h *MahjongHandover) error {
	from := mahjongParticipant(room, h.FromParticipantID)
	if from == nil || from.Status != ParticipantActive || from.MahjongSeat != h.Seat {
		return ErrInvalidState
	}
	if from.Role == ParticipantHost {
		return ErrForbidden
	}
	if h.Status == "reconfirm" {
		return ErrHandoverScoreChanged
	}
	if h.Status != "accepted" {
		return ErrInvalidState
	}
	var candidateID sql.NullString
	var name, userID string
	var acceptedPoints int64
	if err := tx.QueryRowContext(ctx, `SELECT candidate_id, candidate_name, candidate_user_id, accepted_points
		FROM score_mahjong_handovers WHERE id = ?`, h.ID).Scan(&candidateID, &name, &userID, &acceptedPoints); err != nil {
		return err
	}
	if from.TotalPoints != acceptedPoints {
		return ErrHandoverScoreChanged
	}
	now := s.now().UTC().Unix()
	if now >= h.ExpiresAt.Unix() {
		return ErrInvalidState
	}

	if _, err := tx.ExecContext(ctx, `UPDATE score_participants SET status = 'left', last_seen_at = ? WHERE id = ?`, now, from.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE score_mahjong_seats SET left_at_points = ? WHERE participant_id = ?`, acceptedPoints, from.ID); err != nil {
		return err
	}
	id, tokenVersion, err := activateMahjongCandidate(ctx, tx, room, h.Seat, candidateID.String, name, userID, now)
	if err != nil {
		return err
	}
	if room.PendingHostParticipantID == from.ID {
		if err := clearMahjongHostOffer(ctx, tx, room.ID); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE score_mahjong_handovers
		SET status = 'completed', candidate_id = ?, completed_at = ?, completed_token_version = ? WHERE id = ?`,
		id, now, tokenVersion, h.ID)
	return err
}

func activateMahjongCandidate(ctx context.Context, tx *sql.Tx, room RoomSnapshot, seat int, id, name, userID string, now int64) (string, int, error) {
	if id != "" {
		p := mahjongParticipant(room, id)
		if p == nil || p.Status != ParticipantLeft || p.MahjongSeat != seat {
			return "", 0, ErrInvalidState
		}
		var version int
		if err := tx.QueryRowContext(ctx, `UPDATE score_participants
			SET status = 'active', token_version = token_version + 1, last_seen_at = ? WHERE id = ?
			RETURNING token_version`, now, id).Scan(&version); err != nil {
			return "", 0, err
		}
		_, err := tx.ExecContext(ctx, `UPDATE score_mahjong_seats SET left_at_points = NULL WHERE participant_id = ?`, id)
		return id, version, err
	}
	for _, p := range room.Participants {
		if userID != "" && p.UserID == userID {
			return "", 0, ErrAccountAlreadyBound
		}
	}
	id = uuid.NewString()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO score_participants (id, room_id, user_id, display_name, normalized_name, role, status, joined_at, last_seen_at)
		VALUES (?, ?, NULLIF(?, ''), ?, ?, 'guest', 'active', ?, ?)`,
		id, room.ID, userID, name, normalizeDisplayName(name), now, now); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return "", 0, ErrNicknameConflict
		}
		return "", 0, err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO score_mahjong_seats(participant_id, seat) VALUES (?, ?)`, id, seat)
	return id, 1, err
}

func offerMahjongHost(ctx context.Context, tx *sql.Tx, actor Actor, room RoomSnapshot, id string) error {
	if id == actor.ParticipantID {
		return ErrForbidden
	}
	if h := room.MahjongHandover; h != nil && h.FromParticipantID == id {
		return ErrInvalidState
	}
	target := mahjongParticipant(room, id)
	if target == nil || target.Status != ParticipantActive {
		return ErrParticipantMissing
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO score_mahjong_host_offers (room_id, participant_id) VALUES (?, ?)
		ON CONFLICT(room_id) DO UPDATE SET participant_id = excluded.participant_id`, room.ID, id)
	return err
}

func acceptMahjongHostOffer(ctx context.Context, tx *sql.Tx, actor Actor, room RoomSnapshot, id string) error {
	if (id != "" && id != actor.ParticipantID) || room.PendingHostParticipantID != actor.ParticipantID {
		return ErrForbidden
	}
	if err := seedMahjongSeats(ctx, tx, room.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE score_participants
		SET role = CASE WHEN id = ? THEN 'host' ELSE 'guest' END WHERE room_id = ? AND (id = ? OR role = 'host')`,
		actor.ParticipantID, room.ID, actor.ParticipantID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE score_rooms SET host_user_id = ? WHERE id = ?`, actor.UserID, room.ID); err != nil {
		return err
	}
	return clearMahjongHostOffer(ctx, tx, room.ID)
}

func clearMahjongHostOffer(ctx context.Context, tx *sql.Tx, roomID string) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM score_mahjong_host_offers WHERE room_id = ?`, roomID)
	return err
}

func (s *Service) clearMahjongRoomInvitations(ctx context.Context, tx *sql.Tx, roomID string) error {
	if _, err := tx.ExecContext(ctx, `UPDATE score_mahjong_handovers
		SET status = CASE WHEN expires_at <= ? THEN 'expired' ELSE 'cancelled' END
		WHERE room_id = ? AND status IN ('open', 'accepted', 'reconfirm')`, s.now().Unix(), roomID); err != nil {
		return err
	}
	return clearMahjongHostOffer(ctx, tx, roomID)
}
