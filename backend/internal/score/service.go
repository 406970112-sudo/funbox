package score

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var (
	ErrUnauthorized       = errors.New("score authentication required")
	ErrForbidden          = errors.New("score action forbidden")
	ErrInvalidInput       = errors.New("invalid score input")
	ErrRoomFull           = errors.New("score room is full")
	ErrNicknameConflict   = errors.New("score nickname is already in use")
	ErrInvalidState       = errors.New("score room is in an invalid state")
	ErrVersionConflict    = errors.New("score room version conflict")
	ErrActionIDReused     = errors.New("score client action id was reused")
	ErrRoundNotFound      = errors.New("score round not found")
	ErrParticipantMissing = errors.New("score participant not found")
)

type Actor struct {
	ParticipantID string          `json:"participantId"`
	UserID        string          `json:"userId,omitempty"`
	RoomID        string          `json:"roomId"`
	Role          ParticipantRole `json:"role"`
}

type CommandMeta struct {
	ClientActionID      string `json:"clientActionId"`
	ExpectedRoomVersion int64  `json:"expectedRoomVersion"`
}

type CreateRoomInput struct {
	Name          string `json:"name"`
	MaxPlayers    int    `json:"maxPlayers"`
	CentsPerPoint int64  `json:"centsPerPoint"`
}

type CreateRoomResult struct {
	Room        RoomSnapshot `json:"room"`
	Actor       Actor        `json:"actor"`
	InviteToken string       `json:"inviteToken"`
}

type JoinRoomInput struct {
	Code        string `json:"code,omitempty"`
	InviteToken string `json:"inviteToken,omitempty"`
	DisplayName string `json:"displayName"`
}

type JoinRoomResult struct {
	Room       RoomSnapshot `json:"room"`
	Actor      Actor        `json:"actor"`
	GuestToken string       `json:"guestToken"`
}

type StartRoundInput struct {
	ReversesRoundID string `json:"reversesRoundId,omitempty"`
}

type VersionConflictError struct {
	Latest RoomSnapshot
}

func (e *VersionConflictError) Error() string { return ErrVersionConflict.Error() }
func (e *VersionConflictError) Unwrap() error { return ErrVersionConflict }

type Service struct {
	store      *Store
	signingKey []byte
	guestTTL   time.Duration
	now        func() time.Time
}

type tokenClaims struct {
	Type          string `json:"typ"`
	RoomID        string `json:"roomId"`
	Code          string `json:"code,omitempty"`
	ParticipantID string `json:"participantId,omitempty"`
	TokenVersion  int    `json:"tokenVersion,omitempty"`
	jwt.RegisteredClaims
}

func NewService(store *Store, signingKey []byte, guestTTL time.Duration) *Service {
	if guestTTL <= 0 {
		guestTTL = 7 * 24 * time.Hour
	}
	return &Service{
		store:      store,
		signingKey: append([]byte(nil), signingKey...),
		guestTTL:   guestTTL,
		now:        time.Now,
	}
}

func (s *Service) CreateRoom(ctx context.Context, hostUserID, displayName string, input CreateRoomInput) (CreateRoomResult, error) {
	hostUserID = strings.TrimSpace(hostUserID)
	displayName = strings.TrimSpace(displayName)
	input.Name = strings.TrimSpace(input.Name)
	if hostUserID == "" {
		return CreateRoomResult{}, ErrUnauthorized
	}
	if displayName == "" || len([]rune(displayName)) > 48 || input.Name == "" || len([]rune(input.Name)) > 40 {
		return CreateRoomResult{}, fmt.Errorf("room or display name: %w", ErrInvalidInput)
	}
	if input.MaxPlayers < 2 || input.MaxPlayers > 8 || input.CentsPerPoint < 1 || input.CentsPerPoint > 1_000_000 {
		return CreateRoomResult{}, fmt.Errorf("room settings: %w", ErrInvalidInput)
	}

	for attempt := 0; attempt < 12; attempt++ {
		result, retry, err := s.createRoomWithCode(ctx, hostUserID, displayName, input)
		if !retry {
			return result, err
		}
	}
	return CreateRoomResult{}, fmt.Errorf("generate unique room code: %w", ErrInvalidState)
}

func (s *Service) createRoomWithCode(ctx context.Context, hostUserID, displayName string, input CreateRoomInput) (CreateRoomResult, bool, error) {
	code, err := randomRoomCode()
	if err != nil {
		return CreateRoomResult{}, false, err
	}
	now := s.now().UTC()
	roomID := uuid.NewString()
	participantID := uuid.NewString()
	tx, err := s.store.db.BeginTx(ctx, nil)
	if err != nil {
		return CreateRoomResult{}, false, fmt.Errorf("begin create score room: %w", err)
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO score_rooms (
			id, code, host_user_id, name, mode, status, max_players,
			cents_per_point, version, event_sequence, created_at, expires_at
		) VALUES (?, ?, ?, ?, 'generic', 'waiting', ?, ?, 1, 0, ?, ?)
	`, roomID, code, hostUserID, input.Name, input.MaxPlayers, input.CentsPerPoint, now.Unix(), now.Add(s.guestTTL).Unix())
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return CreateRoomResult{}, true, nil
		}
		return CreateRoomResult{}, false, fmt.Errorf("insert score room: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO score_participants (
			id, room_id, user_id, display_name, normalized_name, role, status,
			token_version, joined_at, last_seen_at
		) VALUES (?, ?, ?, ?, ?, 'host', 'active', 1, ?, ?)
	`, participantID, roomID, hostUserID, displayName, normalizeDisplayName(displayName), now.Unix(), now.Unix())
	if err != nil {
		return CreateRoomResult{}, false, fmt.Errorf("insert score host: %w", err)
	}
	room, err := s.store.loadRoomSnapshot(ctx, tx, roomID)
	if err != nil {
		return CreateRoomResult{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return CreateRoomResult{}, false, fmt.Errorf("commit score room: %w", err)
	}
	actor := Actor{ParticipantID: participantID, UserID: hostUserID, RoomID: roomID, Role: ParticipantHost}
	inviteToken, err := s.signToken(tokenClaims{Type: "score_invite", RoomID: roomID, Code: code}, s.guestTTL)
	if err != nil {
		return CreateRoomResult{}, false, err
	}
	room.SelfParticipantID = participantID
	room.InviteToken = inviteToken
	return CreateRoomResult{Room: room, Actor: actor, InviteToken: inviteToken}, false, nil
}

func (s *Service) JoinRoom(ctx context.Context, input JoinRoomInput) (JoinRoomResult, error) {
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" || len([]rune(displayName)) > 48 {
		return JoinRoomResult{}, fmt.Errorf("display name: %w", ErrInvalidInput)
	}
	code := strings.TrimSpace(input.Code)
	if strings.TrimSpace(input.InviteToken) != "" {
		claims, err := s.parseToken(input.InviteToken, "score_invite")
		if err != nil {
			return JoinRoomResult{}, err
		}
		code = claims.Code
	}
	if len(code) != 6 {
		return JoinRoomResult{}, fmt.Errorf("room code: %w", ErrInvalidInput)
	}

	now := s.now().UTC()
	tx, err := s.store.db.BeginTx(ctx, nil)
	if err != nil {
		return JoinRoomResult{}, fmt.Errorf("begin join score room: %w", err)
	}
	defer tx.Rollback()
	var roomID, status string
	var maxPlayers, activePlayers int
	err = tx.QueryRowContext(ctx, `
		SELECT r.id, r.status, r.max_players,
			(SELECT COUNT(*) FROM score_participants p WHERE p.room_id = r.id AND p.status = 'active')
		FROM score_rooms r WHERE r.code = ? AND r.status IN ('waiting', 'active')
	`, code).Scan(&roomID, &status, &maxPlayers, &activePlayers)
	if errors.Is(err, sql.ErrNoRows) {
		return JoinRoomResult{}, ErrRoomNotFound
	}
	if err != nil {
		return JoinRoomResult{}, fmt.Errorf("find score room: %w", err)
	}
	if status != string(RoomWaiting) {
		return JoinRoomResult{}, fmt.Errorf("joining started room: %w", ErrInvalidState)
	}
	if activePlayers >= maxPlayers {
		return JoinRoomResult{}, ErrRoomFull
	}
	participantID := uuid.NewString()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO score_participants (
			id, room_id, user_id, display_name, normalized_name, role, status,
			token_version, joined_at, last_seen_at
		) VALUES (?, ?, NULL, ?, ?, 'guest', 'active', 1, ?, ?)
	`, participantID, roomID, displayName, normalizeDisplayName(displayName), now.Unix(), now.Unix())
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			return JoinRoomResult{}, ErrNicknameConflict
		}
		return JoinRoomResult{}, fmt.Errorf("insert score guest: %w", err)
	}
	if _, err := bumpRoomAndAppendEvent(ctx, tx, roomID, participantID, "participant.joined", map[string]any{"participantId": participantID}, now); err != nil {
		return JoinRoomResult{}, err
	}
	room, err := s.store.loadRoomSnapshot(ctx, tx, roomID)
	if err != nil {
		return JoinRoomResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return JoinRoomResult{}, fmt.Errorf("commit score room join: %w", err)
	}
	actor := Actor{ParticipantID: participantID, RoomID: roomID, Role: ParticipantGuest}
	guestToken, err := s.signToken(tokenClaims{
		Type: "score_guest", RoomID: roomID, ParticipantID: participantID, TokenVersion: 1,
	}, s.guestTTL)
	if err != nil {
		return JoinRoomResult{}, err
	}
	room.SelfParticipantID = participantID
	return JoinRoomResult{Room: room, Actor: actor, GuestToken: guestToken}, nil
}

func (s *Service) StartRoom(ctx context.Context, actor Actor, meta CommandMeta) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "room.start", nil, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		if room.Status != RoomWaiting || len(activeParticipants(room.Participants)) < 2 {
			return ErrInvalidState
		}
		_, err := tx.ExecContext(ctx, `UPDATE score_rooms SET status = 'active', started_at = ? WHERE id = ?`, s.now().UTC().Unix(), room.ID)
		return err
	})
}

func (s *Service) StartRound(ctx context.Context, actor Actor, meta CommandMeta, input StartRoundInput) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "round.start", input, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		if room.Status != RoomActive || room.CurrentRound != nil {
			return ErrInvalidState
		}
		now := s.now().UTC().Unix()
		var number int
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(number), 0) + 1 FROM score_rounds WHERE room_id = ?`, room.ID).Scan(&number); err != nil {
			return fmt.Errorf("find next score round: %w", err)
		}
		roundID := uuid.NewString()
		kind := RoundNormal
		status := RoundCollecting
		roster := participantIDs(activeParticipants(room.Participants))
		if len(roster) < 2 {
			return ErrInvalidState
		}
		if input.ReversesRoundID != "" {
			kind = RoundReversal
			status = RoundReview
			var sourceRosterJSON string
			if err := tx.QueryRowContext(ctx, `
				SELECT roster_json FROM score_rounds
				WHERE id = ? AND room_id = ? AND status = 'confirmed'
			`, input.ReversesRoundID, room.ID).Scan(&sourceRosterJSON); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return ErrRoundNotFound
				}
				return err
			}
			if err := json.Unmarshal([]byte(sourceRosterJSON), &roster); err != nil {
				return err
			}
			active := make(map[string]bool)
			for _, participant := range activeParticipants(room.Participants) {
				active[participant.ID] = true
			}
			for _, participantID := range roster {
				if !active[participantID] {
					return ErrInvalidState
				}
			}
		}
		rosterJSON, _ := json.Marshal(roster)
		_, err := tx.ExecContext(ctx, `
			INSERT INTO score_rounds (
				id, room_id, number, kind, reverses_round_id, status,
				roster_json, created_by, created_at
			) VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?)
		`, roundID, room.ID, number, kind, input.ReversesRoundID, status, string(rosterJSON), actor.ParticipantID, now)
		if err != nil {
			return fmt.Errorf("insert score round: %w", err)
		}
		if kind == RoundReversal {
			_, err = tx.ExecContext(ctx, `
				INSERT INTO score_entries (
					round_id, participant_id, delta_points, revision, submitted_at, updated_at
				)
				SELECT ?, participant_id, -delta_points, 1, ?, ?
				FROM score_entries WHERE round_id = ?
			`, roundID, now, now, input.ReversesRoundID)
			if err != nil {
				return fmt.Errorf("insert reversal score entries: %w", err)
			}
		}
		return nil
	})
}

func (s *Service) SubmitEntry(ctx context.Context, actor Actor, meta CommandMeta, roundID string, deltaPoints int64) (RoomSnapshot, error) {
	payload := struct {
		RoundID     string `json:"roundId"`
		DeltaPoints int64  `json:"deltaPoints"`
	}{roundID, deltaPoints}
	return s.mutate(ctx, actor, meta, "entry.submit", payload, func(tx *sql.Tx, room RoomSnapshot) error {
		if deltaPoints < -2_147_483_648 || deltaPoints > 2_147_483_647 {
			return ErrInvalidInput
		}
		if room.Status != RoomActive || room.CurrentRound == nil || room.CurrentRound.ID != roundID || room.CurrentRound.Kind != RoundNormal {
			return ErrInvalidState
		}
		if !containsString(room.CurrentRound.Roster, actor.ParticipantID) {
			return ErrForbidden
		}
		now := s.now().UTC().Unix()
		_, err := tx.ExecContext(ctx, `
			INSERT INTO score_entries (
				round_id, participant_id, delta_points, revision, submitted_at, updated_at
			) VALUES (?, ?, ?, 1, ?, ?)
			ON CONFLICT(round_id, participant_id) DO UPDATE SET
				delta_points = excluded.delta_points,
				revision = score_entries.revision + 1,
				updated_at = excluded.updated_at
		`, roundID, actor.ParticipantID, deltaPoints, now, now)
		if err != nil {
			return fmt.Errorf("submit score entry: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM score_confirmations WHERE round_id = ?`, roundID); err != nil {
			return fmt.Errorf("clear score confirmations: %w", err)
		}
		return recomputeRoundStatus(ctx, tx, roundID, len(room.CurrentRound.Roster))
	})
}

func (s *Service) ConfirmRound(ctx context.Context, actor Actor, meta CommandMeta, roundID string) (RoomSnapshot, error) {
	payload := map[string]string{"roundId": roundID}
	return s.mutate(ctx, actor, meta, "round.confirm", payload, func(tx *sql.Tx, room RoomSnapshot) error {
		if room.Status != RoomActive || room.CurrentRound == nil || room.CurrentRound.ID != roundID || room.CurrentRound.Status != RoundReview {
			return ErrInvalidState
		}
		if !containsString(room.CurrentRound.Roster, actor.ParticipantID) {
			return ErrForbidden
		}
		var revision int
		if err := tx.QueryRowContext(ctx, `
			SELECT revision FROM score_entries WHERE round_id = ? AND participant_id = ?
		`, roundID, actor.ParticipantID).Scan(&revision); err != nil {
			return ErrInvalidState
		}
		now := s.now().UTC().Unix()
		_, err := tx.ExecContext(ctx, `
			INSERT INTO score_confirmations (round_id, participant_id, entry_revision, confirmed_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(round_id, participant_id) DO UPDATE SET
				entry_revision = excluded.entry_revision,
				confirmed_at = excluded.confirmed_at
		`, roundID, actor.ParticipantID, revision, now)
		if err != nil {
			return fmt.Errorf("confirm score round: %w", err)
		}
		var confirmations int
		if err := tx.QueryRowContext(ctx, `
			SELECT COUNT(*)
			FROM score_confirmations c
			JOIN score_entries e
				ON e.round_id = c.round_id AND e.participant_id = c.participant_id
			WHERE c.round_id = ? AND c.entry_revision = e.revision
		`, roundID).Scan(&confirmations); err != nil {
			return err
		}
		if confirmations == len(room.CurrentRound.Roster) {
			if _, err := tx.ExecContext(ctx, `
				UPDATE score_rounds SET status = 'confirmed', confirmed_at = ? WHERE id = ?
			`, now, roundID); err != nil {
				return fmt.Errorf("complete score round: %w", err)
			}
		}
		return nil
	})
}

func (s *Service) CancelRound(ctx context.Context, actor Actor, meta CommandMeta, roundID string) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "round.cancel", map[string]string{"roundId": roundID}, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		if room.Status != RoomActive || room.CurrentRound == nil || room.CurrentRound.ID != roundID {
			return ErrInvalidState
		}
		_, err := tx.ExecContext(ctx, `UPDATE score_rounds SET status = 'cancelled', cancelled_at = ? WHERE id = ?`, s.now().UTC().Unix(), roundID)
		return err
	})
}

func (s *Service) CancelRoom(ctx context.Context, actor Actor, meta CommandMeta) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "room.cancel", nil, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		if room.Status != RoomWaiting || len(room.Rounds) != 0 {
			return ErrInvalidState
		}
		_, err := tx.ExecContext(ctx, `UPDATE score_rooms SET status = 'cancelled', cancelled_at = ? WHERE id = ?`, s.now().UTC().Unix(), room.ID)
		return err
	})
}

func (s *Service) RemoveParticipant(ctx context.Context, actor Actor, meta CommandMeta, participantID string) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "participant.remove", map[string]string{"participantId": participantID}, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost || participantID == actor.ParticipantID {
			return ErrForbidden
		}
		if room.Status != RoomWaiting && room.Status != RoomActive {
			return ErrInvalidState
		}
		if room.CurrentRound != nil {
			return ErrInvalidState
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE score_participants
			SET status = 'removed', token_version = token_version + 1, last_seen_at = ?
			WHERE id = ? AND room_id = ? AND status = 'active' AND role = 'guest'
		`, s.now().UTC().Unix(), participantID, room.ID)
		if err != nil {
			return err
		}
		changed, _ := result.RowsAffected()
		if changed != 1 {
			return ErrParticipantMissing
		}
		return nil
	})
}

func (s *Service) SettleRoom(ctx context.Context, actor Actor, meta CommandMeta) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "room.settle", nil, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		if room.Status != RoomActive || room.CurrentRound != nil || len(room.Rounds) == 0 {
			return ErrInvalidState
		}
		balances := make(map[string]int64, len(room.Participants))
		order := make([]string, 0, len(room.Participants))
		settlementBalances := make([]SettlementBalance, 0, len(room.Participants))
		for _, participant := range room.Participants {
			amount := participant.TotalPoints * room.CentsPerPoint
			balances[participant.ID] = amount
			order = append(order, participant.ID)
			settlementBalances = append(settlementBalances, SettlementBalance{
				ParticipantID: participant.ID,
				TotalPoints:   participant.TotalPoints,
				AmountCents:   amount,
			})
		}
		transfers, err := MinimumTransfers(balances, order)
		if err != nil {
			return err
		}
		balancesJSON, _ := json.Marshal(settlementBalances)
		transfersJSON, _ := json.Marshal(transfers)
		now := s.now().UTC().Unix()
		_, err = tx.ExecContext(ctx, `
			INSERT INTO score_settlements (
				room_id, room_version, balances_json, transfers_json, created_at
			) VALUES (?, ?, ?, ?, ?)
		`, room.ID, room.Version+1, string(balancesJSON), string(transfersJSON), now)
		if err != nil {
			return fmt.Errorf("store score settlement: %w", err)
		}
		_, err = tx.ExecContext(ctx, `UPDATE score_rooms SET status = 'settled', settled_at = ? WHERE id = ?`, now, room.ID)
		return err
	})
}

func (s *Service) GetRoom(ctx context.Context, actor Actor) (RoomSnapshot, error) {
	if err := s.validateActor(ctx, s.store.db, actor, false); err != nil {
		return RoomSnapshot{}, err
	}
	room, err := s.store.loadRoomSnapshot(ctx, s.store.db, actor.RoomID)
	if err != nil {
		return RoomSnapshot{}, err
	}
	room.SelfParticipantID = actor.ParticipantID
	return room, nil
}

func (s *Service) ListHistory(ctx context.Context, userID string) ([]RoomSnapshot, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, ErrUnauthorized
	}
	rows, err := s.store.db.QueryContext(ctx, `
		SELECT id FROM score_rooms WHERE host_user_id = ? ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	roomIDs := make([]string, 0)
	for rows.Next() {
		var roomID string
		if err := rows.Scan(&roomID); err != nil {
			_ = rows.Close()
			return nil, err
		}
		roomIDs = append(roomIDs, roomID)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()
	history := make([]RoomSnapshot, 0, len(roomIDs))
	for _, roomID := range roomIDs {
		room, err := s.store.loadRoomSnapshot(ctx, s.store.db, roomID)
		if err != nil {
			return nil, err
		}
		history = append(history, room)
	}
	return history, nil
}

func (s *Service) ActorForUser(ctx context.Context, roomID, userID string) (Actor, error) {
	var actor Actor
	var role string
	err := s.store.db.QueryRowContext(ctx, `
		SELECT id, room_id, user_id, role
		FROM score_participants
		WHERE room_id = ? AND user_id = ? AND status = 'active'
	`, roomID, userID).Scan(&actor.ParticipantID, &actor.RoomID, &actor.UserID, &role)
	if errors.Is(err, sql.ErrNoRows) {
		return Actor{}, ErrUnauthorized
	}
	if err != nil {
		return Actor{}, err
	}
	actor.Role = ParticipantRole(role)
	return actor, nil
}

func (s *Service) IssueInviteToken(ctx context.Context, actor Actor) (string, error) {
	if actor.Role != ParticipantHost {
		return "", ErrForbidden
	}
	if err := s.validateActor(ctx, s.store.db, actor, false); err != nil {
		return "", err
	}
	var code string
	if err := s.store.db.QueryRowContext(ctx, `SELECT code FROM score_rooms WHERE id = ? AND status = 'waiting'`, actor.RoomID).Scan(&code); err != nil {
		return "", ErrInvalidState
	}
	return s.signToken(tokenClaims{Type: "score_invite", RoomID: actor.RoomID, Code: code}, s.guestTTL)
}

func (s *Service) IssueGuestToken(ctx context.Context, participantID string) (string, error) {
	var roomID, role, status string
	var tokenVersion int
	err := s.store.db.QueryRowContext(ctx, `
		SELECT room_id, role, status, token_version FROM score_participants WHERE id = ?
	`, participantID).Scan(&roomID, &role, &status, &tokenVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrParticipantMissing
	}
	if err != nil {
		return "", err
	}
	if role != string(ParticipantGuest) || status != string(ParticipantActive) {
		return "", ErrForbidden
	}
	return s.signToken(tokenClaims{
		Type: "score_guest", RoomID: roomID, ParticipantID: participantID, TokenVersion: tokenVersion,
	}, s.guestTTL)
}

func (s *Service) AuthenticateGuestToken(ctx context.Context, rawToken string) (Actor, error) {
	claims, err := s.parseToken(rawToken, "score_guest")
	if err != nil {
		return Actor{}, err
	}
	var roomID, role, participantStatus, roomStatus string
	var tokenVersion int
	var settledAt sql.NullInt64
	err = s.store.db.QueryRowContext(ctx, `
		SELECT p.room_id, p.role, p.status, p.token_version, r.status, r.settled_at
		FROM score_participants p
		JOIN score_rooms r ON r.id = p.room_id
		WHERE p.id = ? AND p.room_id = ?
	`, claims.ParticipantID, claims.RoomID).Scan(
		&roomID, &role, &participantStatus, &tokenVersion, &roomStatus, &settledAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Actor{}, ErrUnauthorized
	}
	if err != nil {
		return Actor{}, err
	}
	if role != string(ParticipantGuest) || participantStatus != string(ParticipantActive) || tokenVersion != claims.TokenVersion {
		return Actor{}, ErrUnauthorized
	}
	if roomStatus == string(RoomCancelled) {
		return Actor{}, ErrUnauthorized
	}
	if roomStatus == string(RoomSettled) && (!settledAt.Valid || s.now().UTC().After(time.Unix(settledAt.Int64, 0).UTC().Add(24*time.Hour))) {
		return Actor{}, ErrUnauthorized
	}
	return Actor{ParticipantID: claims.ParticipantID, RoomID: roomID, Role: ParticipantGuest}, nil
}

func (s *Service) mutate(
	ctx context.Context,
	actor Actor,
	meta CommandMeta,
	commandType string,
	payload any,
	apply func(*sql.Tx, RoomSnapshot) error,
) (RoomSnapshot, error) {
	if actor.ParticipantID == "" || actor.RoomID == "" {
		return RoomSnapshot{}, ErrUnauthorized
	}
	if strings.TrimSpace(meta.ClientActionID) == "" {
		meta.ClientActionID = uuid.NewString()
	}
	requestHash, err := hashCommand(commandType, payload)
	if err != nil {
		return RoomSnapshot{}, err
	}
	tx, err := s.store.db.BeginTx(ctx, nil)
	if err != nil {
		return RoomSnapshot{}, fmt.Errorf("begin score command: %w", err)
	}
	defer tx.Rollback()

	var savedHash, savedJSON string
	err = tx.QueryRowContext(ctx, `
		SELECT request_hash, result_json FROM score_command_receipts
		WHERE actor_participant_id = ? AND client_action_id = ?
	`, actor.ParticipantID, meta.ClientActionID).Scan(&savedHash, &savedJSON)
	if err == nil {
		if savedHash != requestHash {
			return RoomSnapshot{}, ErrActionIDReused
		}
		var room RoomSnapshot
		if err := json.Unmarshal([]byte(savedJSON), &room); err != nil {
			return RoomSnapshot{}, fmt.Errorf("decode score command receipt: %w", err)
		}
		return room, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return RoomSnapshot{}, fmt.Errorf("load score command receipt: %w", err)
	}
	if err := s.validateActor(ctx, tx, actor, true); err != nil {
		return RoomSnapshot{}, err
	}
	room, err := s.store.loadRoomSnapshot(ctx, tx, actor.RoomID)
	if err != nil {
		return RoomSnapshot{}, err
	}
	if meta.ExpectedRoomVersion > 0 && meta.ExpectedRoomVersion != room.Version {
		room.SelfParticipantID = actor.ParticipantID
		return RoomSnapshot{}, &VersionConflictError{Latest: room}
	}
	if err := apply(tx, room); err != nil {
		return RoomSnapshot{}, err
	}
	now := s.now().UTC()
	if _, err := bumpRoomAndAppendEvent(ctx, tx, room.ID, actor.ParticipantID, commandType, payload, now); err != nil {
		return RoomSnapshot{}, err
	}
	result, err := s.store.loadRoomSnapshot(ctx, tx, room.ID)
	if err != nil {
		return RoomSnapshot{}, err
	}
	result.SelfParticipantID = actor.ParticipantID
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return RoomSnapshot{}, err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO score_command_receipts (
			actor_participant_id, client_action_id, command_type, request_hash,
			result_room_version, result_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`, actor.ParticipantID, meta.ClientActionID, commandType, requestHash, result.Version, string(resultJSON), now.Unix())
	if err != nil {
		return RoomSnapshot{}, fmt.Errorf("store score command receipt: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return RoomSnapshot{}, fmt.Errorf("commit score command: %w", err)
	}
	return result, nil
}

func (s *Service) validateActor(ctx context.Context, q queryer, actor Actor, write bool) error {
	var roomID, userID, role, participantStatus, roomStatus string
	var nullableUserID sql.NullString
	err := q.QueryRowContext(ctx, `
		SELECT p.room_id, p.user_id, p.role, p.status, r.status
		FROM score_participants p
		JOIN score_rooms r ON r.id = p.room_id
		WHERE p.id = ?
	`, actor.ParticipantID).Scan(&roomID, &nullableUserID, &role, &participantStatus, &roomStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUnauthorized
	}
	if err != nil {
		return err
	}
	userID = nullableUserID.String
	if roomID != actor.RoomID || role != string(actor.Role) || participantStatus != string(ParticipantActive) {
		return ErrUnauthorized
	}
	if userID != "" && actor.UserID != userID {
		return ErrUnauthorized
	}
	if write && (roomStatus == string(RoomSettled) || roomStatus == string(RoomCancelled)) {
		return ErrInvalidState
	}
	return nil
}

func recomputeRoundStatus(ctx context.Context, tx *sql.Tx, roundID string, rosterCount int) error {
	var submitted int
	var total int64
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*), COALESCE(SUM(delta_points), 0) FROM score_entries WHERE round_id = ?
	`, roundID).Scan(&submitted, &total); err != nil {
		return fmt.Errorf("recompute score round: %w", err)
	}
	status := RoundCollecting
	if submitted == rosterCount && total == 0 {
		status = RoundReview
	}
	_, err := tx.ExecContext(ctx, `UPDATE score_rounds SET status = ? WHERE id = ?`, status, roundID)
	return err
}

func bumpRoomAndAppendEvent(ctx context.Context, tx *sql.Tx, roomID, actorID, eventType string, payload any, now time.Time) (int64, error) {
	result, err := tx.ExecContext(ctx, `
		UPDATE score_rooms
		SET version = version + 1, event_sequence = event_sequence + 1
		WHERE id = ?
	`, roomID)
	if err != nil {
		return 0, fmt.Errorf("advance score room version: %w", err)
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		return 0, ErrRoomNotFound
	}
	var sequence int64
	if err := tx.QueryRowContext(ctx, `SELECT event_sequence FROM score_rooms WHERE id = ?`, roomID).Scan(&sequence); err != nil {
		return 0, err
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	if actorID == "" {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO score_room_events (room_id, sequence, event_type, payload_json, actor_participant_id, created_at)
			VALUES (?, ?, ?, ?, NULL, ?)
		`, roomID, sequence, eventType, string(payloadJSON), now.Unix())
	} else {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO score_room_events (room_id, sequence, event_type, payload_json, actor_participant_id, created_at)
			VALUES (?, ?, ?, ?, ?, ?)
		`, roomID, sequence, eventType, string(payloadJSON), actorID, now.Unix())
	}
	if err != nil {
		return 0, fmt.Errorf("append score room event: %w", err)
	}
	return sequence, nil
}

func (s *Service) signToken(claims tokenClaims, ttl time.Duration) (string, error) {
	if len(s.signingKey) < 16 {
		return "", fmt.Errorf("score signing key is too short: %w", ErrInvalidInput)
	}
	now := s.now().UTC()
	claims.RegisteredClaims = jwt.RegisteredClaims{
		Issuer:    "funbox-score",
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.signingKey)
	if err != nil {
		return "", fmt.Errorf("sign score token: %w", err)
	}
	return signed, nil
}

func (s *Service) parseToken(rawToken, expectedType string) (tokenClaims, error) {
	claims := tokenClaims{}
	token, err := jwt.ParseWithClaims(
		strings.TrimSpace(rawToken),
		&claims,
		func(token *jwt.Token) (any, error) { return s.signingKey, nil },
		jwt.WithIssuer("funbox-score"),
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithTimeFunc(s.now),
	)
	if err != nil || !token.Valid || claims.Type != expectedType {
		return tokenClaims{}, ErrUnauthorized
	}
	return claims, nil
}

func hashCommand(commandType string, payload any) (string, error) {
	encoded, err := json.Marshal(struct {
		CommandType string `json:"commandType"`
		Payload     any    `json:"payload"`
	}{commandType, payload})
	if err != nil {
		return "", fmt.Errorf("encode score command: %w", err)
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func randomRoomCode() (string, error) {
	var buffer [8]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return "", fmt.Errorf("generate score room code: %w", err)
	}
	return fmt.Sprintf("%06d", binary.BigEndian.Uint64(buffer[:])%1_000_000), nil
}

func normalizeDisplayName(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func activeParticipants(participants []Participant) []Participant {
	active := make([]Participant, 0, len(participants))
	for _, participant := range participants {
		if participant.Status == ParticipantActive {
			active = append(active, participant)
		}
	}
	return active
}

func participantIDs(participants []Participant) []string {
	ids := make([]string, 0, len(participants))
	for _, participant := range participants {
		ids = append(ids, participant.ID)
	}
	return ids
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
