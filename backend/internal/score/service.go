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
	"math"
	"sort"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrUnauthorized       = errors.New("score authentication required")
	ErrForbidden          = errors.New("score action forbidden")
	ErrInviteInvalid      = errors.New("score invite token is invalid")
	ErrInvalidInput       = errors.New("invalid score input")
	ErrRoomFull           = errors.New("score room is full")
	ErrNicknameConflict   = errors.New("score nickname is already in use")
	ErrInvalidState       = errors.New("score room is in an invalid state")
	ErrVersionConflict    = errors.New("score room version conflict")
	ErrActionIDReused     = errors.New("score client action id was reused")
	ErrRoundNotFound      = errors.New("score round not found")
	ErrGiftBatchNotFound  = errors.New("score gift batch not found")
	ErrParticipantMissing = errors.New("score participant not found")
	ErrNotYourTurn        = errors.New("not the current player's turn")
	ErrForceOpenLocked    = errors.New("force open is not available yet")
	ErrInvalidZJHHand     = errors.New("zha jin hua hand not found")
	ErrPasswordRequired   = errors.New("score room password is required")
	ErrPasswordInvalid    = errors.New("score room password is invalid")
	ErrCapExceeded        = errors.New("score gift cap exceeded")
	ErrLocationInvalid    = errors.New("score location is invalid")
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
	Name               string     `json:"name"`
	MaxPlayers         int        `json:"maxPlayers"`
	CentsPerPoint      int64      `json:"centsPerPoint"`
	Scene              ScoreScene `json:"scene,omitempty"`
	GameType           GameType   `json:"gameType,omitempty"`
	Password           string     `json:"password,omitempty"`
	CapPoints          int64      `json:"capPoints,omitempty"`
	Latitude           *float64   `json:"latitude,omitempty"`
	Longitude          *float64   `json:"longitude,omitempty"`
	ForceOpenThreshold int        `json:"forceOpenThreshold,omitempty"`
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
	Password    string `json:"password,omitempty"`
}

type JoinRoomResult struct {
	Room       RoomSnapshot `json:"room"`
	Actor      Actor        `json:"actor"`
	GuestToken string       `json:"guestToken"`
}

type InvitePreviewInput struct {
	InviteToken string `json:"inviteToken"`
}

type InvitePreviewResult struct {
	Room              RoomSnapshot `json:"room"`
	SelfParticipantID string       `json:"selfParticipantId,omitempty"`
}

type NearbyRoomsInput struct {
	Latitude     float64  `json:"latitude"`
	Longitude    float64  `json:"longitude"`
	RadiusMeters int      `json:"radiusMeters"`
	GameType     GameType `json:"gameType,omitempty"`
	Limit        int      `json:"limit,omitempty"`
}

type NearbyRoomSummary struct {
	ID               string   `json:"id"`
	Code             string   `json:"code"`
	Name             string   `json:"name"`
	HostDisplayName  string   `json:"hostDisplayName"`
	GameType         GameType `json:"gameType"`
	ActivePlayers    int      `json:"activePlayers"`
	MaxPlayers       int      `json:"maxPlayers"`
	CentsPerPoint    int64    `json:"centsPerPoint"`
	CapPoints        int64    `json:"capPoints"`
	RequiresPassword bool     `json:"requiresPassword"`
	DistanceMeters   int      `json:"distanceMeters"`
}

type NearbyRoomsResult struct {
	Rooms []NearbyRoomSummary `json:"rooms"`
}

type StartRoundInput struct {
	ReversesRoundID string `json:"reversesRoundId,omitempty"`
}

type GiftAllocationInput struct {
	ToParticipantID string `json:"toParticipantId"`
	Points          int64  `json:"points"`
}

type SubmitGiftsInput struct {
	Allocations []GiftAllocationInput `json:"allocations"`
}

type SettleRoomInput struct {
	CentsPerPoint int64 `json:"centsPerPoint,omitempty"`
}

type UpdateZhaJinHuaSettingsInput struct {
	ForceOpenThreshold int `json:"forceOpenThreshold"`
}

type ZhaJinHuaActionInput struct {
	ActionType          ZhaJinHuaActionType `json:"actionType"`
	Points              int64               `json:"points,omitempty"`
	TargetParticipantID string              `json:"targetParticipantId,omitempty"`
	WinnerParticipantID string              `json:"winnerParticipantId,omitempty"`
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
	input.Scene = ScoreScene(strings.TrimSpace(string(input.Scene)))
	input.GameType = GameType(strings.TrimSpace(string(input.GameType)))
	if input.CentsPerPoint == 0 {
		input.CentsPerPoint = 100
	}
	if hostUserID == "" {
		return CreateRoomResult{}, ErrUnauthorized
	}
	if displayName == "" || len([]rune(displayName)) > 48 || input.Name == "" || len([]rune(input.Name)) > 40 {
		return CreateRoomResult{}, fmt.Errorf("room or display name: %w", ErrInvalidInput)
	}
	if input.GameType == "" {
		if input.Scene == SceneZhaJinHua {
			input.GameType = GameTypeZhaJinHua
		} else {
			input.GameType = GameTypeGeneric
		}
	}
	switch input.GameType {
	case GameTypeMahjong:
		input.Scene = SceneGeneric
		input.ForceOpenThreshold = 0
		if input.MaxPlayers == 0 {
			input.MaxPlayers = 4
		}
		if input.CapPoints == 0 {
			input.CapPoints = 10
		}
		if input.Password == "" {
			return CreateRoomResult{}, ErrPasswordRequired
		}
	case GameTypeZhaJinHua:
		input.Scene = SceneZhaJinHua
	case GameTypeGeneric:
		if input.Scene == "" {
			input.Scene = SceneGeneric
		}
		if input.Scene != SceneGeneric {
			return CreateRoomResult{}, fmt.Errorf("room game type and scene: %w", ErrInvalidInput)
		}
	default:
		return CreateRoomResult{}, fmt.Errorf("room game type: %w", ErrInvalidInput)
	}
	if input.MaxPlayers < 2 || input.MaxPlayers > 8 || input.CentsPerPoint < 1 || input.CentsPerPoint > 1_000_000 {
		return CreateRoomResult{}, fmt.Errorf("room settings: %w", ErrInvalidInput)
	}
	if input.CapPoints < 0 || input.CapPoints > 2_147_483_647 {
		return CreateRoomResult{}, fmt.Errorf("room cap: %w", ErrInvalidInput)
	}
	if input.Password != "" && !validRoomPassword(input.Password) {
		return CreateRoomResult{}, fmt.Errorf("room password: %w", ErrInvalidInput)
	}
	if (input.Latitude == nil) != (input.Longitude == nil) {
		return CreateRoomResult{}, ErrLocationInvalid
	}
	if input.Latitude != nil && (!validLatitude(*input.Latitude) || !validLongitude(*input.Longitude)) {
		return CreateRoomResult{}, ErrLocationInvalid
	}
	switch input.Scene {
	case SceneGeneric:
		input.ForceOpenThreshold = 0
	case SceneZhaJinHua:
		if input.ForceOpenThreshold == 0 {
			input.ForceOpenThreshold = 2
		}
		if input.ForceOpenThreshold < 2 || input.ForceOpenThreshold > input.MaxPlayers {
			return CreateRoomResult{}, fmt.Errorf("zha jin hua settings: %w", ErrInvalidInput)
		}
	default:
		return CreateRoomResult{}, fmt.Errorf("room scene: %w", ErrInvalidInput)
	}

	passwordHash := ""
	if input.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		if err != nil {
			return CreateRoomResult{}, fmt.Errorf("hash room password: %w", err)
		}
		passwordHash = string(hash)
	}

	for attempt := 0; attempt < 12; attempt++ {
		result, retry, err := s.createRoomWithCode(ctx, hostUserID, displayName, input, passwordHash)
		if !retry {
			return result, err
		}
	}
	return CreateRoomResult{}, fmt.Errorf("generate unique room code: %w", ErrInvalidState)
}

func (s *Service) createRoomWithCode(ctx context.Context, hostUserID, displayName string, input CreateRoomInput, passwordHash string) (CreateRoomResult, bool, error) {
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
			cents_per_point, cap_points, game_type, password_hash, latitude, longitude,
			version, event_sequence, created_at, expires_at
		) VALUES (?, ?, ?, ?, 'generic', 'waiting', ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
	`, roomID, code, hostUserID, input.Name, input.MaxPlayers, input.CentsPerPoint,
		input.CapPoints, input.GameType, passwordHash, input.Latitude, input.Longitude,
		now.Unix(), now.Add(s.guestTTL).Unix())
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
	legacyForceOpenFee := int64(0)
	if input.Scene == SceneZhaJinHua {
		legacyForceOpenFee = 1
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO score_room_game_configs (
			room_id, scene, force_open_threshold, force_open_fee_points, updated_at
		) VALUES (?, ?, ?, ?, ?)
	`, roomID, input.Scene, input.ForceOpenThreshold, legacyForceOpenFee, now.Unix())
	if err != nil {
		return CreateRoomResult{}, false, fmt.Errorf("insert score room game config: %w", err)
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
			return JoinRoomResult{}, ErrInviteInvalid
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
	var roomID, status, passwordHash string
	var maxPlayers, activePlayers int
	err = tx.QueryRowContext(ctx, `
		SELECT r.id, r.status, r.max_players, r.password_hash,
			(SELECT COUNT(*) FROM score_participants p WHERE p.room_id = r.id AND p.status = 'active')
		FROM score_rooms r WHERE r.code = ? AND r.status IN ('waiting', 'active')
	`, code).Scan(&roomID, &status, &maxPlayers, &passwordHash, &activePlayers)
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
	if passwordHash != "" {
		if input.Password == "" {
			return JoinRoomResult{}, ErrPasswordRequired
		}
		if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(input.Password)) != nil {
			return JoinRoomResult{}, ErrPasswordInvalid
		}
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

func (s *Service) PreviewInvite(ctx context.Context, userID string, input InvitePreviewInput) (InvitePreviewResult, error) {
	token := strings.TrimSpace(input.InviteToken)
	if token == "" {
		return InvitePreviewResult{}, fmt.Errorf("invite token: %w", ErrInvalidInput)
	}
	claims, err := s.parseToken(token, "score_invite")
	if err != nil {
		return InvitePreviewResult{}, ErrInviteInvalid
	}
	room, err := s.store.loadRoomSnapshot(ctx, s.store.db, claims.RoomID)
	if err != nil {
		return InvitePreviewResult{}, err
	}
	if room.Code != claims.Code {
		return InvitePreviewResult{}, ErrInviteInvalid
	}
	result := InvitePreviewResult{Room: room}
	if userID != "" {
		var participantID string
		err := s.store.db.QueryRowContext(ctx, `
			SELECT id FROM score_participants
			WHERE room_id = ? AND user_id = ? AND status = 'active'
		`, claims.RoomID, userID).Scan(&participantID)
		if err == nil {
			result.SelfParticipantID = participantID
			room.SelfParticipantID = participantID
			result.Room = room
			return result, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return InvitePreviewResult{}, err
		}
	}
	if len(activeParticipants(room.Participants)) >= room.MaxPlayers {
		return InvitePreviewResult{}, ErrRoomFull
	}
	return result, nil
}

func (s *Service) ListNearbyRooms(ctx context.Context, input NearbyRoomsInput) (NearbyRoomsResult, error) {
	if !validLatitude(input.Latitude) || !validLongitude(input.Longitude) {
		return NearbyRoomsResult{}, ErrLocationInvalid
	}
	if input.GameType == "" {
		input.GameType = GameTypeMahjong
	}
	if input.GameType != GameTypeMahjong && input.GameType != GameTypeGeneric {
		return NearbyRoomsResult{}, fmt.Errorf("nearby game type: %w", ErrInvalidInput)
	}
	if input.RadiusMeters == 0 {
		input.RadiusMeters = 3000
	}
	if input.RadiusMeters < 100 || input.RadiusMeters > 20_000 {
		return NearbyRoomsResult{}, fmt.Errorf("nearby radius: %w", ErrInvalidInput)
	}
	if input.Limit == 0 {
		input.Limit = 20
	}
	if input.Limit < 1 || input.Limit > 50 {
		return NearbyRoomsResult{}, fmt.Errorf("nearby limit: %w", ErrInvalidInput)
	}

	latitudeDelta := float64(input.RadiusMeters) / 111_320
	longitudeScale := math.Cos(input.Latitude * math.Pi / 180)
	if math.Abs(longitudeScale) < 0.0001 {
		longitudeScale = 0.0001
	}
	longitudeDelta := float64(input.RadiusMeters) / (111_320 * math.Abs(longitudeScale))
	rows, err := s.store.db.QueryContext(ctx, `
		SELECT r.id, r.code, r.name, r.game_type, r.max_players, r.cents_per_point,
			r.cap_points, CASE WHEN r.password_hash <> '' THEN 1 ELSE 0 END,
			r.latitude, r.longitude, h.display_name,
			(SELECT COUNT(*) FROM score_participants p
			 WHERE p.room_id = r.id AND p.status = 'active')
		FROM score_rooms r
		JOIN score_participants h
			ON h.room_id = r.id AND h.role = 'host' AND h.status = 'active'
		WHERE r.status = 'waiting' AND r.game_type = ?
			AND r.latitude IS NOT NULL AND r.longitude IS NOT NULL
			AND r.latitude BETWEEN ? AND ? AND r.longitude BETWEEN ? AND ?
		ORDER BY r.created_at DESC
		LIMIT 100
	`, input.GameType,
		input.Latitude-latitudeDelta, input.Latitude+latitudeDelta,
		input.Longitude-longitudeDelta, input.Longitude+longitudeDelta,
	)
	if err != nil {
		return NearbyRoomsResult{}, fmt.Errorf("query nearby score rooms: %w", err)
	}
	defer rows.Close()

	rooms := make([]NearbyRoomSummary, 0)
	for rows.Next() {
		var room NearbyRoomSummary
		var latitude, longitude float64
		var requiresPassword int
		if err := rows.Scan(
			&room.ID, &room.Code, &room.Name, &room.GameType, &room.MaxPlayers,
			&room.CentsPerPoint, &room.CapPoints, &requiresPassword,
			&latitude, &longitude, &room.HostDisplayName, &room.ActivePlayers,
		); err != nil {
			return NearbyRoomsResult{}, fmt.Errorf("scan nearby score room: %w", err)
		}
		if room.ActivePlayers >= room.MaxPlayers {
			continue
		}
		distance := haversineMeters(input.Latitude, input.Longitude, latitude, longitude)
		if distance > float64(input.RadiusMeters) {
			continue
		}
		room.RequiresPassword = requiresPassword == 1
		room.DistanceMeters = int(math.Round(distance))
		rooms = append(rooms, room)
	}
	if err := rows.Err(); err != nil {
		return NearbyRoomsResult{}, fmt.Errorf("iterate nearby score rooms: %w", err)
	}
	sort.Slice(rooms, func(i, j int) bool {
		if rooms[i].DistanceMeters != rooms[j].DistanceMeters {
			return rooms[i].DistanceMeters < rooms[j].DistanceMeters
		}
		return rooms[i].Code < rooms[j].Code
	})
	if len(rooms) > input.Limit {
		rooms = rooms[:input.Limit]
	}
	return NearbyRoomsResult{Rooms: rooms}, nil
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
		if room.GameType == GameTypeMahjong || room.Scene != SceneGeneric || room.Status != RoomActive || room.CurrentRound != nil || room.CurrentZhaJinHuaHand != nil {
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

func (s *Service) UpdateZhaJinHuaSettings(ctx context.Context, actor Actor, meta CommandMeta, input UpdateZhaJinHuaSettingsInput) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "zjh.settings.update", input, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		if room.Scene != SceneZhaJinHua || room.CurrentZhaJinHuaHand != nil || room.CurrentRound != nil {
			return ErrInvalidState
		}
		if input.ForceOpenThreshold < 2 || input.ForceOpenThreshold > room.MaxPlayers {
			return fmt.Errorf("zha jin hua settings: %w", ErrInvalidInput)
		}
		_, err := tx.ExecContext(ctx, `
			UPDATE score_room_game_configs
			SET force_open_threshold = ?, updated_at = ?
			WHERE room_id = ? AND scene = 'zhajinhua'
		`, input.ForceOpenThreshold, s.now().UTC().Unix(), room.ID)
		if err != nil {
			return fmt.Errorf("update zha jin hua settings: %w", err)
		}
		return nil
	})
}

func (s *Service) StartZhaJinHuaHand(ctx context.Context, actor Actor, meta CommandMeta) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "zjh.hand.start", nil, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		if room.Scene != SceneZhaJinHua || room.Status != RoomActive ||
			room.CurrentRound != nil || room.CurrentZhaJinHuaHand != nil {
			return ErrInvalidState
		}
		players := activeParticipants(room.Participants)
		if len(players) < 2 {
			return ErrInvalidState
		}
		var number int
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(MAX(number), 0) + 1 FROM score_zjh_hands WHERE room_id = ?
		`, room.ID).Scan(&number); err != nil {
			return fmt.Errorf("find next zha jin hua hand: %w", err)
		}
		handID := uuid.NewString()
		now := s.now().UTC().Unix()
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO score_zjh_hands (
				id, room_id, number, status, pot_points, current_turn_participant_id,
				force_open_threshold, force_open_fee_points, created_by, created_at
			) VALUES (?, ?, ?, 'active', 0, ?, ?, ?, ?, ?)
		`, handID, room.ID, number, players[0].ID, room.ZhaJinHuaSettings.ForceOpenThreshold,
			1, actor.ParticipantID, now); err != nil {
			return fmt.Errorf("insert zha jin hua hand: %w", err)
		}
		for index, participant := range players {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO score_zjh_hand_players (
					hand_id, participant_id, position, status, contribution_points, is_winner
				) VALUES (?, ?, ?, 'active', 0, 0)
			`, handID, participant.ID, index+1); err != nil {
				return fmt.Errorf("insert zha jin hua hand player: %w", err)
			}
		}
		return nil
	})
}

func (s *Service) SubmitZhaJinHuaAction(ctx context.Context, actor Actor, meta CommandMeta, handID string, input ZhaJinHuaActionInput) (RoomSnapshot, error) {
	payload := struct {
		HandID string `json:"handId"`
		ZhaJinHuaActionInput
	}{HandID: handID, ZhaJinHuaActionInput: input}
	return s.mutate(ctx, actor, meta, "zjh.action", payload, func(tx *sql.Tx, room RoomSnapshot) error {
		if room.Scene != SceneZhaJinHua || room.Status != RoomActive || room.CurrentZhaJinHuaHand == nil ||
			room.CurrentZhaJinHuaHand.ID != handID {
			return ErrInvalidZJHHand
		}
		hand := room.CurrentZhaJinHuaHand
		if hand.CurrentTurnParticipantID != actor.ParticipantID {
			return ErrNotYourTurn
		}
		actorPlayer := findZhaJinHuaPlayer(hand.Players, actor.ParticipantID)
		if actorPlayer == nil || actorPlayer.Status != ZhaJinHuaPlayerActive {
			return ErrForbidden
		}
		now := s.now().UTC().Unix()
		var targetParticipantID, winnerParticipantID string
		var actionPoints int64
		switch input.ActionType {
		case ZhaJinHuaActionRaise:
			if input.Points <= 0 || input.Points > 2_147_483_647 || hand.PotPoints > 2_147_483_647-input.Points {
				return fmt.Errorf("raise points: %w", ErrInvalidInput)
			}
			actionPoints = input.Points
			if _, err := tx.ExecContext(ctx, `
				UPDATE score_zjh_hand_players
				SET contribution_points = contribution_points + ?
				WHERE hand_id = ? AND participant_id = ?
			`, input.Points, handID, actor.ParticipantID); err != nil {
				return fmt.Errorf("raise zha jin hua contribution: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE score_zjh_hands SET pot_points = pot_points + ? WHERE id = ?
			`, input.Points, handID); err != nil {
				return fmt.Errorf("raise zha jin hua pot: %w", err)
			}
		case ZhaJinHuaActionFold:
			if _, err := tx.ExecContext(ctx, `
				UPDATE score_zjh_hand_players SET status = 'folded'
				WHERE hand_id = ? AND participant_id = ?
			`, handID, actor.ParticipantID); err != nil {
				return fmt.Errorf("fold zha jin hua player: %w", err)
			}
		case ZhaJinHuaActionForceOpen:
			targetParticipantID = strings.TrimSpace(input.TargetParticipantID)
			winnerParticipantID = strings.TrimSpace(input.WinnerParticipantID)
			targetPlayer := findZhaJinHuaPlayer(hand.Players, targetParticipantID)
			activeCount := activeZhaJinHuaPlayerCount(hand.Players)
			if activeCount > hand.ForceOpenThreshold {
				return ErrForceOpenLocked
			}
			if targetParticipantID == "" || targetParticipantID == actor.ParticipantID ||
				targetPlayer == nil || targetPlayer.Status != ZhaJinHuaPlayerActive {
				return fmt.Errorf("force open target: %w", ErrInvalidInput)
			}
			if winnerParticipantID != actor.ParticipantID && winnerParticipantID != targetParticipantID {
				return fmt.Errorf("force open winner: %w", ErrInvalidInput)
			}
			currentBetPoints, err := currentZhaJinHuaBet(ctx, tx, handID)
			if err != nil {
				return err
			}
			if currentBetPoints <= 0 {
				return ErrForceOpenLocked
			}
			if hand.PotPoints > 2_147_483_647-currentBetPoints {
				return fmt.Errorf("force open fee: %w", ErrInvalidInput)
			}
			actionPoints = currentBetPoints
			loserParticipantID := targetParticipantID
			if winnerParticipantID == targetParticipantID {
				loserParticipantID = actor.ParticipantID
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE score_zjh_hand_players
				SET contribution_points = contribution_points + ?
				WHERE hand_id = ? AND participant_id = ?
			`, currentBetPoints, handID, actor.ParticipantID); err != nil {
				return fmt.Errorf("charge zha jin hua force open fee: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE score_zjh_hand_players SET status = 'folded'
				WHERE hand_id = ? AND participant_id = ?
			`, handID, loserParticipantID); err != nil {
				return fmt.Errorf("fold zha jin hua force open loser: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE score_zjh_hands
				SET pot_points = pot_points + ?, force_open_fee_points = ?
				WHERE id = ?
			`, currentBetPoints, currentBetPoints, handID); err != nil {
				return fmt.Errorf("add zha jin hua force open fee: %w", err)
			}
		default:
			return fmt.Errorf("zha jin hua action: %w", ErrInvalidInput)
		}

		var sequence int
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(MAX(sequence), 0) + 1 FROM score_zjh_actions WHERE hand_id = ?
		`, handID).Scan(&sequence); err != nil {
			return fmt.Errorf("find zha jin hua action sequence: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO score_zjh_actions (
				hand_id, sequence, action_type, actor_participant_id,
				target_participant_id, winner_participant_id, points, created_at
			) VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?)
		`, handID, sequence, input.ActionType, actor.ParticipantID,
			targetParticipantID, winnerParticipantID, actionPoints, now); err != nil {
			return fmt.Errorf("insert zha jin hua action: %w", err)
		}

		var remaining int
		if err := tx.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM score_zjh_hand_players WHERE hand_id = ? AND status = 'active'
		`, handID).Scan(&remaining); err != nil {
			return fmt.Errorf("count active zha jin hua players: %w", err)
		}
		if remaining == 1 {
			var winnerID string
			var potPoints int64
			if err := tx.QueryRowContext(ctx, `
				SELECT p.participant_id, h.pot_points
				FROM score_zjh_hand_players p
				JOIN score_zjh_hands h ON h.id = p.hand_id
				WHERE p.hand_id = ? AND p.status = 'active'
			`, handID).Scan(&winnerID, &potPoints); err != nil {
				return fmt.Errorf("load zha jin hua winner: %w", err)
			}
			return finishZhaJinHuaHand(ctx, tx, handID, winnerID, potPoints, now)
		}
		nextParticipantID, err := nextZhaJinHuaParticipant(ctx, tx, handID, actor.ParticipantID)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE score_zjh_hands SET current_turn_participant_id = ? WHERE id = ?
		`, nextParticipantID, handID); err != nil {
			return fmt.Errorf("advance zha jin hua turn: %w", err)
		}
		return nil
	})
}

func (s *Service) CancelZhaJinHuaHand(ctx context.Context, actor Actor, meta CommandMeta, handID string) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "zjh.hand.cancel", map[string]string{"handId": handID}, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		if room.Scene != SceneZhaJinHua || room.CurrentZhaJinHuaHand == nil || room.CurrentZhaJinHuaHand.ID != handID {
			return ErrInvalidZJHHand
		}
		_, err := tx.ExecContext(ctx, `
			UPDATE score_zjh_hands
			SET status = 'cancelled', current_turn_participant_id = NULL, cancelled_at = ?
			WHERE id = ?
		`, s.now().UTC().Unix(), handID)
		return err
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
		if room.Scene != SceneGeneric || room.Status != RoomActive || room.CurrentRound == nil || room.CurrentRound.ID != roundID || room.CurrentRound.Kind != RoundNormal {
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

func (s *Service) SubmitGifts(ctx context.Context, actor Actor, meta CommandMeta, input SubmitGiftsInput) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "gifts.submit", input, func(tx *sql.Tx, room RoomSnapshot) error {
		if room.Scene != SceneGeneric || room.Status != RoomActive || room.CurrentRound != nil {
			return ErrInvalidState
		}
		active := make(map[string]bool, len(room.Participants))
		for _, participant := range room.Participants {
			if participant.Status == ParticipantActive {
				active[participant.ID] = true
			}
		}
		if !active[actor.ParticipantID] {
			return ErrForbidden
		}
		if len(input.Allocations) == 0 || len(input.Allocations) > len(active)-1 {
			return fmt.Errorf("gift allocations: %w", ErrInvalidInput)
		}
		seenRecipients := make(map[string]bool, len(input.Allocations))
		var totalPoints int64
		allocations := make([]GiftAllocationInput, len(input.Allocations))
		for index, allocation := range input.Allocations {
			allocation.ToParticipantID = strings.TrimSpace(allocation.ToParticipantID)
			if allocation.ToParticipantID == "" || allocation.ToParticipantID == actor.ParticipantID ||
				!active[allocation.ToParticipantID] || seenRecipients[allocation.ToParticipantID] ||
				allocation.Points <= 0 || allocation.Points > 2_147_483_647 ||
				totalPoints > 2_147_483_647-allocation.Points {
				return fmt.Errorf("gift allocation: %w", ErrInvalidInput)
			}
			seenRecipients[allocation.ToParticipantID] = true
			totalPoints += allocation.Points
			allocations[index] = allocation
		}
		if room.CapPoints > 0 && totalPoints > room.CapPoints {
			return ErrCapExceeded
		}

		var number int
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(MAX(number), 0) + 1 FROM score_gift_batches WHERE room_id = ?
		`, room.ID).Scan(&number); err != nil {
			return fmt.Errorf("find next score gift batch: %w", err)
		}
		batchID := uuid.NewString()
		now := s.now().UTC().Unix()
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO score_gift_batches (
				id, room_id, number, kind, reverses_batch_id, created_by, created_at
			) VALUES (?, ?, ?, 'normal', NULL, ?, ?)
		`, batchID, room.ID, number, actor.ParticipantID, now); err != nil {
			return fmt.Errorf("insert score gift batch: %w", err)
		}
		for _, allocation := range allocations {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO score_point_gifts (batch_id, from_participant_id, to_participant_id, points)
				VALUES (?, ?, ?, ?)
			`, batchID, actor.ParticipantID, allocation.ToParticipantID, allocation.Points); err != nil {
				return fmt.Errorf("insert score gift: %w", err)
			}
		}
		return nil
	})
}

func (s *Service) ReverseGiftBatch(ctx context.Context, actor Actor, meta CommandMeta, batchID string) (RoomSnapshot, error) {
	return s.mutate(ctx, actor, meta, "gifts.reverse", map[string]string{"batchId": batchID}, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		if room.Scene != SceneGeneric || room.Status != RoomActive || room.CurrentRound != nil {
			return ErrInvalidState
		}
		batchID = strings.TrimSpace(batchID)
		var kind string
		if err := tx.QueryRowContext(ctx, `
			SELECT kind FROM score_gift_batches WHERE id = ? AND room_id = ?
		`, batchID, room.ID).Scan(&kind); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrGiftBatchNotFound
			}
			return err
		}
		if kind != string(RoundNormal) {
			return ErrInvalidState
		}
		var reversed int
		if err := tx.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM score_gift_batches WHERE reverses_batch_id = ?
		`, batchID).Scan(&reversed); err != nil {
			return err
		}
		if reversed > 0 {
			return ErrInvalidState
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT from_participant_id, to_participant_id, points
			FROM score_point_gifts WHERE batch_id = ? ORDER BY from_participant_id, to_participant_id
		`, batchID)
		if err != nil {
			return fmt.Errorf("load score gifts for reversal: %w", err)
		}
		gifts := make([]GiftItem, 0)
		for rows.Next() {
			var gift GiftItem
			if err := rows.Scan(&gift.FromParticipantID, &gift.ToParticipantID, &gift.Points); err != nil {
				_ = rows.Close()
				return err
			}
			gifts = append(gifts, gift)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		if len(gifts) == 0 {
			return ErrGiftBatchNotFound
		}
		var number int
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(MAX(number), 0) + 1 FROM score_gift_batches WHERE room_id = ?
		`, room.ID).Scan(&number); err != nil {
			return fmt.Errorf("find next score gift reversal: %w", err)
		}
		newBatchID := uuid.NewString()
		now := s.now().UTC().Unix()
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO score_gift_batches (
				id, room_id, number, kind, reverses_batch_id, created_by, created_at
			) VALUES (?, ?, ?, 'reversal', ?, ?, ?)
		`, newBatchID, room.ID, number, batchID, actor.ParticipantID, now); err != nil {
			return fmt.Errorf("insert score gift reversal batch: %w", err)
		}
		for _, gift := range gifts {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO score_point_gifts (batch_id, from_participant_id, to_participant_id, points)
				VALUES (?, ?, ?, ?)
			`, newBatchID, gift.ToParticipantID, gift.FromParticipantID, gift.Points); err != nil {
				return fmt.Errorf("insert reversed score gift: %w", err)
			}
		}
		return nil
	})
}

func (s *Service) ConfirmRound(ctx context.Context, actor Actor, meta CommandMeta, roundID string) (RoomSnapshot, error) {
	payload := map[string]string{"roundId": roundID}
	return s.mutate(ctx, actor, meta, "round.confirm", payload, func(tx *sql.Tx, room RoomSnapshot) error {
		if room.Scene != SceneGeneric || room.Status != RoomActive || room.CurrentRound == nil || room.CurrentRound.ID != roundID || room.CurrentRound.Status != RoundReview {
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
		if room.Scene != SceneGeneric || room.Status != RoomActive || room.CurrentRound == nil || room.CurrentRound.ID != roundID {
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
		if room.CurrentRound != nil || room.CurrentZhaJinHuaHand != nil {
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

func (s *Service) SettleRoom(ctx context.Context, actor Actor, meta CommandMeta, input SettleRoomInput) (RoomSnapshot, error) {
	payload := struct {
		CentsPerPoint int64 `json:"centsPerPoint"`
	}{CentsPerPoint: input.CentsPerPoint}
	return s.mutate(ctx, actor, meta, "room.settle", payload, func(tx *sql.Tx, room RoomSnapshot) error {
		if actor.Role != ParticipantHost {
			return ErrForbidden
		}
		if room.Status != RoomActive || room.CurrentRound != nil || room.CurrentZhaJinHuaHand != nil ||
			(len(room.Rounds) == 0 && len(room.GiftBatches) == 0 && len(room.ZhaJinHuaHands) == 0) {
			return ErrInvalidState
		}
		centsPerPoint := input.CentsPerPoint
		if centsPerPoint == 0 {
			centsPerPoint = room.CentsPerPoint
		}
		if room.GameType == GameTypeMahjong {
			centsPerPoint = room.CentsPerPoint
		}
		if centsPerPoint < 1 || centsPerPoint > 1_000_000 {
			return fmt.Errorf("settlement rate: %w", ErrInvalidInput)
		}
		balances := make(map[string]int64, len(room.Participants))
		order := make([]string, 0, len(room.Participants))
		settlementBalances := make([]SettlementBalance, 0, len(room.Participants))
		for _, participant := range room.Participants {
			amount := participant.TotalPoints * centsPerPoint
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
		_, err = tx.ExecContext(ctx, `
			UPDATE score_rooms SET status = 'settled', cents_per_point = ?, settled_at = ? WHERE id = ?
		`, centsPerPoint, now, room.ID)
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

func findZhaJinHuaPlayer(players []ZhaJinHuaPlayer, participantID string) *ZhaJinHuaPlayer {
	for index := range players {
		if players[index].ParticipantID == participantID {
			return &players[index]
		}
	}
	return nil
}

func activeZhaJinHuaPlayerCount(players []ZhaJinHuaPlayer) int {
	count := 0
	for _, player := range players {
		if player.Status == ZhaJinHuaPlayerActive {
			count++
		}
	}
	return count
}

func currentZhaJinHuaBet(ctx context.Context, q queryer, handID string) (int64, error) {
	var points int64
	err := q.QueryRowContext(ctx, `
		SELECT COALESCE((
			SELECT points FROM score_zjh_actions
			WHERE hand_id = ? AND action_type = 'raise'
			ORDER BY sequence DESC LIMIT 1
		), 0)
	`, handID).Scan(&points)
	if err != nil {
		return 0, fmt.Errorf("load current zha jin hua bet: %w", err)
	}
	return points, nil
}

func nextZhaJinHuaParticipant(ctx context.Context, tx *sql.Tx, handID, actorParticipantID string) (string, error) {
	var actorPosition int
	if err := tx.QueryRowContext(ctx, `
		SELECT position FROM score_zjh_hand_players
		WHERE hand_id = ? AND participant_id = ?
	`, handID, actorParticipantID).Scan(&actorPosition); err != nil {
		return "", fmt.Errorf("load zha jin hua actor position: %w", err)
	}
	var nextParticipantID string
	if err := tx.QueryRowContext(ctx, `
		SELECT participant_id
		FROM score_zjh_hand_players
		WHERE hand_id = ? AND status = 'active'
		ORDER BY CASE WHEN position > ? THEN 0 ELSE 1 END, position
		LIMIT 1
	`, handID, actorPosition).Scan(&nextParticipantID); err != nil {
		return "", fmt.Errorf("find next zha jin hua player: %w", err)
	}
	return nextParticipantID, nil
}

func finishZhaJinHuaHand(ctx context.Context, tx *sql.Tx, handID, winnerParticipantID string, potPoints, now int64) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT participant_id, contribution_points
		FROM score_zjh_hand_players WHERE hand_id = ?
	`, handID)
	if err != nil {
		return fmt.Errorf("load zha jin hua contributions: %w", err)
	}
	type contribution struct {
		participantID string
		points        int64
	}
	contributions := make([]contribution, 0)
	for rows.Next() {
		var item contribution
		if err := rows.Scan(&item.participantID, &item.points); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan zha jin hua contribution: %w", err)
		}
		contributions = append(contributions, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return fmt.Errorf("iterate zha jin hua contributions: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close zha jin hua contributions: %w", err)
	}
	for _, item := range contributions {
		delta := -item.points
		if item.participantID == winnerParticipantID {
			delta += potPoints
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO score_zjh_ledger (hand_id, participant_id, delta_points)
			VALUES (?, ?, ?)
		`, handID, item.participantID, delta); err != nil {
			return fmt.Errorf("insert zha jin hua ledger: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE score_zjh_hand_players SET is_winner = CASE WHEN participant_id = ? THEN 1 ELSE 0 END
		WHERE hand_id = ?
	`, winnerParticipantID, handID); err != nil {
		return fmt.Errorf("mark zha jin hua winner: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE score_zjh_hands
		SET status = 'finished', current_turn_participant_id = NULL,
			winner_participant_id = ?, finished_at = ?
		WHERE id = ?
	`, winnerParticipantID, now, handID); err != nil {
		return fmt.Errorf("finish zha jin hua hand: %w", err)
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

func validRoomPassword(value string) bool {
	if len(value) < 4 || len(value) > 6 {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func validLatitude(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= -90 && value <= 90
}

func validLongitude(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= -180 && value <= 180
}

func haversineMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusMeters = 6_371_000.0
	lat1Radians := lat1 * math.Pi / 180
	lat2Radians := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Radians)*math.Cos(lat2Radians)*math.Sin(deltaLon/2)*math.Sin(deltaLon/2)
	return earthRadiusMeters * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
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
