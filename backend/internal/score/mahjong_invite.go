package score

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

func (s *Service) IssueMahjongHandoverCode(ctx context.Context, actor Actor, id string) (InviteCodeResult, error) {
	if actor.Role != ParticipantHost {
		return InviteCodeResult{}, ErrForbidden
	}
	tx, err := s.store.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return InviteCodeResult{}, err
	}
	defer tx.Rollback()
	if err := s.validateActor(ctx, tx, actor, true); err != nil {
		return InviteCodeResult{}, err
	}
	var scene string
	err = tx.QueryRowContext(ctx, `
		SELECT h.scene FROM score_mahjong_handovers h JOIN score_rooms r ON r.id = h.room_id
		WHERE h.room_id = ? AND h.id = ? AND h.expires_at > ?
			AND h.status IN ('open', 'accepted', 'reconfirm') AND r.game_type = 'mahjong' AND r.status = 'active'`,
		actor.RoomID, strings.TrimSpace(id), s.now().Unix()).Scan(&scene)
	if errors.Is(err, sql.ErrNoRows) {
		return InviteCodeResult{}, ErrInvalidState
	}
	if err != nil {
		return InviteCodeResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return InviteCodeResult{}, err
	}
	result := InviteCodeResult{InviteScene: scene}
	if s.inviteCodeGenerator != nil {
		image, mediaType, width, err := s.inviteCodeGenerator.Generate(ctx, scene)
		if err == nil {
			result.ImageBase64 = base64.StdEncoding.EncodeToString(image)
			result.MediaType = mediaType
			result.Width = width
		}
	}
	return result, nil
}

func (s *Service) PreviewMahjongHandover(ctx context.Context, scene, claimToken string) (MahjongHandoverPreview, error) {
	tx, err := s.store.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return MahjongHandoverPreview{}, err
	}
	defer tx.Rollback()
	scene = strings.TrimSpace(scene)
	record, err := findMahjongHandover(ctx, tx, scene)
	if err != nil {
		return MahjongHandoverPreview{}, err
	}
	if claimToken == "" && record.status == "open" && s.now().Unix() < record.expiresAt {
		claimToken, err = s.issueMahjongClaim(scene)
		if err != nil {
			return MahjongHandoverPreview{}, err
		}
	}
	hash := s.mahjongClaimHash(scene, claimToken)
	preview, _, err := s.previewMahjongHandover(ctx, tx, record, claimToken, hash)
	return preview, err
}

func (s *Service) AcceptMahjongHandover(ctx context.Context, input MahjongHandoverAcceptance) (MahjongHandoverPreview, RoomSnapshot, error) {
	input.Scene = strings.TrimSpace(input.Scene)
	hash := s.mahjongClaimHash(input.Scene, input.ClaimToken)
	if hash == "" {
		return MahjongHandoverPreview{}, RoomSnapshot{}, ErrInviteInvalid
	}
	tx, err := s.store.db.BeginTx(ctx, nil)
	if err != nil {
		return MahjongHandoverPreview{}, RoomSnapshot{}, err
	}
	defer tx.Rollback()
	record, err := findMahjongHandover(ctx, tx, input.Scene)
	if err != nil {
		return MahjongHandoverPreview{}, RoomSnapshot{}, err
	}
	preview, room, err := s.previewMahjongHandover(ctx, tx, record, input.ClaimToken, hash)
	if err != nil {
		return MahjongHandoverPreview{}, RoomSnapshot{}, err
	}
	switch preview.Status {
	case "cancelled", "expired", "completed":
		return preview, RoomSnapshot{}, nil
	case "claimed":
		return MahjongHandoverPreview{}, RoomSnapshot{}, ErrHandoverClaimed
	}
	if preview.Points != input.Points {
		return MahjongHandoverPreview{}, RoomSnapshot{}, ErrHandoverScoreChanged
	}
	if preview.Status == "accepted" {
		return preview, RoomSnapshot{}, nil
	}
	if preview.Status == "open" {
		candidate, err := s.resolveMahjongCandidate(ctx, tx, room, record, input)
		if err != nil {
			return MahjongHandoverPreview{}, RoomSnapshot{}, err
		}
		record.candidateID = sql.NullString{String: candidate.ID, Valid: candidate.ID != ""}
		record.candidateName = candidate.DisplayName
		record.candidateUserID = candidate.UserID
	}
	now := s.now().UTC()
	if now.Unix() >= record.expiresAt {
		preview.Status = "expired"
		return preview, RoomSnapshot{}, nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE score_mahjong_handovers SET status = 'accepted', claim_hash = ?,
		candidate_name = ?, candidate_user_id = ?, candidate_id = ?, accepted_points = ? WHERE id = ?`,
		hash, record.candidateName, record.candidateUserID, record.candidateID, input.Points, record.id); err != nil {
		return MahjongHandoverPreview{}, RoomSnapshot{}, err
	}
	if _, err := bumpRoomAndAppendEvent(ctx, tx, room.ID, "", "mahjong.handover.accept", map[string]string{"handoverId": record.id}, now); err != nil {
		return MahjongHandoverPreview{}, RoomSnapshot{}, err
	}
	room, err = s.loadRoomSnapshot(ctx, tx, room.ID)
	if err != nil {
		return MahjongHandoverPreview{}, RoomSnapshot{}, err
	}
	if err := tx.Commit(); err != nil {
		return MahjongHandoverPreview{}, RoomSnapshot{}, err
	}
	preview.Status = "accepted"
	return preview, room, nil
}

func (s *Service) previewMahjongHandover(ctx context.Context, q queryer, record mahjongHandoverRecord, proof, hash string) (MahjongHandoverPreview, RoomSnapshot, error) {
	preview := MahjongHandoverPreview{Status: record.status, ExpiresAt: time.Unix(record.expiresAt, 0).UTC()}
	now := s.now().UTC()
	if preview.Status == "cancelled" {
		return preview, RoomSnapshot{}, nil
	}
	matchesClaim := record.claimHash != "" && hmac.Equal([]byte(hash), []byte(record.claimHash))
	credentialExpiresAt := preview.ExpiresAt.Add(s.guestTTL)
	deadline := preview.ExpiresAt
	if preview.Status == "completed" && matchesClaim {
		deadline = credentialExpiresAt
	}
	if !now.Before(deadline) || preview.Status == "expired" {
		preview.Status = "expired"
		return preview, RoomSnapshot{}, nil
	}
	if record.claimHash != "" && !matchesClaim {
		preview.Status = "claimed"
		return preview, RoomSnapshot{}, nil
	}
	if proof != "" && hash == "" {
		return MahjongHandoverPreview{}, RoomSnapshot{}, ErrInviteInvalid
	}
	room, err := s.loadRoomSnapshot(ctx, q, record.roomID)
	if err != nil {
		return MahjongHandoverPreview{}, RoomSnapshot{}, err
	}
	from := mahjongParticipant(room, record.fromID)
	if from == nil {
		return MahjongHandoverPreview{}, RoomSnapshot{}, ErrInviteInvalid
	}
	preview.RoomID, preview.RoomCode, preview.RoomName = room.ID, room.Code, room.Name
	preview.FromName, preview.Seat, preview.Points = from.DisplayName, record.seat, from.TotalPoints
	preview.ClaimToken = proof
	preview.CredentialExpiresAt = &credentialExpiresAt
	if preview.Status == "completed" {
		preview.Points = record.acceptedPoints
		token, err := s.completedMahjongGuestToken(ctx, q, record, room)
		if err != nil {
			return MahjongHandoverPreview{}, RoomSnapshot{}, err
		}
		if token == "" {
			return MahjongHandoverPreview{Status: "expired", ExpiresAt: preview.ExpiresAt}, RoomSnapshot{}, nil
		} else {
			preview.GuestToken, preview.ParticipantID = token, record.candidateID.String
		}
		return preview, RoomSnapshot{}, nil
	}
	if !mahjongTableEligible(room) || from.Status != ParticipantActive || from.Role == ParticipantHost {
		preview.Status = "cancelled"
		return preview, RoomSnapshot{}, nil
	}
	if preview.Status == "accepted" && record.acceptedPoints != from.TotalPoints {
		preview.Status = "reconfirm"
	}
	return preview, room, nil
}

func (s *Service) completedMahjongGuestToken(ctx context.Context, q queryer, record mahjongHandoverRecord, room RoomSnapshot) (string, error) {
	if !allowsGuestRoomAccess(room.Status, room.SettledAt, s.now()) {
		return "", nil
	}
	var version int
	err := q.QueryRowContext(ctx, `SELECT token_version FROM score_participants
		WHERE id = ? AND room_id = ? AND status = 'active' AND token_version = ?`,
		record.candidateID, room.ID, record.completedTokenVersion).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return s.signToken(tokenClaims{Type: "score_guest", RoomID: room.ID, ParticipantID: record.candidateID.String, TokenVersion: version}, s.guestTTL)
}

func (s *Service) resolveMahjongCandidate(ctx context.Context, tx *sql.Tx, room RoomSnapshot, record mahjongHandoverRecord, input MahjongHandoverAcceptance) (Participant, error) {
	var returningID string
	if strings.TrimSpace(input.ParticipantToken) != "" {
		claims, err := s.parseToken(input.ParticipantToken, "score_guest")
		if err != nil || claims.RoomID != room.ID {
			return Participant{}, ErrUnauthorized
		}
		var version int
		err = tx.QueryRowContext(ctx, `SELECT token_version FROM score_participants WHERE id = ? AND room_id = ?`,
			claims.ParticipantID, claims.RoomID).Scan(&version)
		if errors.Is(err, sql.ErrNoRows) {
			return Participant{}, ErrUnauthorized
		}
		if err != nil {
			return Participant{}, err
		}
		if claims.TokenVersion != version {
			return Participant{}, ErrUnauthorized
		}
		returningID = claims.ParticipantID
	}
	userID := strings.TrimSpace(input.UserID)
	for _, participant := range room.Participants {
		if userID != "" && participant.UserID == userID {
			if returningID != "" && returningID != participant.ID {
				return Participant{}, ErrAccountAlreadyBound
			}
			returningID = participant.ID
		}
	}
	if returningID != "" {
		p := mahjongParticipant(room, returningID)
		if p == nil || p.Status != ParticipantLeft || p.MahjongSeat != record.seat {
			return Participant{}, ErrForbidden
		}
		if userID != "" && p.UserID != "" && p.UserID != userID {
			return Participant{}, ErrAccountAlreadyBound
		}
		return *p, nil
	}
	name := strings.TrimSpace(input.DisplayName)
	if name == "" || len([]rune(name)) > 48 {
		return Participant{}, ErrInvalidInput
	}
	normalized := normalizeDisplayName(name)
	for _, p := range room.Participants {
		if normalizeDisplayName(p.DisplayName) == normalized {
			return Participant{}, ErrNicknameConflict
		}
	}
	return Participant{DisplayName: name, UserID: userID}, nil
}

// Authenticate the random proof against the invite scene without reserving the
// invitation when somebody opens a preview. Only an acceptance stores its hash.
func (s *Service) issueMahjongClaim(scene string) (string, error) {
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return "", err
	}
	proof := append(nonce[:], s.signMahjongClaim(scene, nonce[:])...)
	return base64.RawURLEncoding.EncodeToString(proof), nil
}

func (s *Service) mahjongClaimHash(scene, proof string) string {
	if len(proof) != base64.RawURLEncoding.EncodedLen(16+sha256.Size) {
		return ""
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(proof)
	if err != nil || !hmac.Equal(raw[16:], s.signMahjongClaim(scene, raw[:16])) {
		return ""
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func (s *Service) signMahjongClaim(scene string, nonce []byte) []byte {
	mac := hmac.New(sha256.New, s.signingKey)
	mac.Write([]byte("score.mahjong.handover\x00" + scene))
	mac.Write(nonce)
	return mac.Sum(nil)
}
