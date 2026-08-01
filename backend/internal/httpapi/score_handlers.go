package httpapi

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"my-first-expo-app/backend/internal/realtime"
	"my-first-expo-app/backend/internal/score"
)

type scoreActorContextKey struct{}

type scoreCommandBody struct {
	ClientActionID      string `json:"clientActionId"`
	ExpectedRoomVersion int64  `json:"expectedRoomVersion"`
}

func (body scoreCommandBody) meta() score.CommandMeta {
	return score.CommandMeta{
		ClientActionID:      strings.TrimSpace(body.ClientActionID),
		ExpectedRoomVersion: body.ExpectedRoomVersion,
	}
}

func registerScoreRoutes(mux *http.ServeMux, api *Server) {
	if api.scoreService == nil {
		return
	}
	mux.HandleFunc("POST /api/v1/score-rooms", api.withAuth(api.withAPIPipeline(api.handleCreateScoreRoom)))
	mux.HandleFunc("POST /api/v1/score-rooms/join", api.withRateLimitedAPIPipeline("score-join", api.handleJoinScoreRoom))
	mux.HandleFunc("POST /api/v1/score-rooms/invite-preview", api.withOptionalAuth(api.withRateLimitedAPIPipeline("score-join", api.handlePreviewScoreInvite)))
	mux.HandleFunc("GET /api/v1/score-rooms/history", api.withAuth(api.withAPIPipeline(api.handleScoreRoomHistory)))
	mux.HandleFunc("GET /api/v1/score-rooms/{roomID}", api.withScoreActor(api.withAPIPipeline(api.handleGetScoreRoom)))
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/start", api.withScoreActor(api.withAPIPipeline(api.handleStartScoreRoom)))
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/cancel", api.withScoreActor(api.withAPIPipeline(api.handleCancelScoreRoom)))
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/rounds", api.withScoreActor(api.withAPIPipeline(api.handleStartScoreRound)))
	mux.HandleFunc("PUT /api/v1/score-rooms/{roomID}/rounds/{roundID}/entry", api.withScoreActor(api.withAPIPipeline(api.handleSubmitScoreEntry)))
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/rounds/{roundID}/confirm", api.withScoreActor(api.withAPIPipeline(api.handleConfirmScoreRound)))
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/rounds/{roundID}/cancel", api.withScoreActor(api.withAPIPipeline(api.handleCancelScoreRound)))
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/participants/{participantID}/remove", api.withScoreActor(api.withAPIPipeline(api.handleRemoveScoreParticipant)))
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/settle", api.withScoreActor(api.withAPIPipeline(api.handleSettleScoreRoom)))
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/invite-token", api.withScoreActor(api.withAPIPipeline(api.handleScoreInviteToken)))
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/realtime-ticket", api.withScoreActor(api.withAPIPipeline(api.handleCreateScoreRealtimeTicket)))
}

func (s *Server) withScoreActor(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Fields(strings.TrimSpace(r.Header.Get("Authorization")))
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}

		actor, guestErr := s.scoreService.AuthenticateGuestToken(r.Context(), parts[1])
		if guestErr != nil {
			account, authErr := s.authService.AuthenticateToken(r.Context(), parts[1])
			if authErr != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
				return
			}
			actor, authErr = s.scoreService.ActorForUser(r.Context(), r.PathValue("roomID"), account.ID)
			if authErr != nil {
				s.writeScoreError(w, authErr)
				return
			}
		}
		if actor.RoomID != r.PathValue("roomID") {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "score_room_forbidden"})
			return
		}
		ctx := context.WithValue(r.Context(), scoreActorContextKey{}, actor)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func scoreActorFromContext(ctx context.Context) (score.Actor, bool) {
	actor, ok := ctx.Value(scoreActorContextKey{}).(score.Actor)
	return actor, ok
}

func (s *Server) handleCreateScoreRoom(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input score.CreateRoomInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	result, err := s.scoreService.CreateRoom(r.Context(), account.ID, account.DisplayName, input)
	if err != nil {
		s.writeScoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleJoinScoreRoom(w http.ResponseWriter, r *http.Request) {
	var input score.JoinRoomInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	result, err := s.scoreService.JoinRoom(r.Context(), input)
	if err != nil {
		s.writeScoreError(w, err)
		return
	}
	s.publishScoreInvalidation(result.Room)
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handlePreviewScoreInvite(w http.ResponseWriter, r *http.Request) {
	var input score.InvitePreviewInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	userID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
	}
	result, err := s.scoreService.PreviewInvite(r.Context(), userID, input)
	if err != nil {
		s.writeScoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleScoreRoomHistory(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	rooms, err := s.scoreService.ListHistory(r.Context(), account.ID)
	if err != nil {
		s.writeScoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rooms": rooms})
}

func (s *Server) handleGetScoreRoom(w http.ResponseWriter, r *http.Request) {
	actor, _ := scoreActorFromContext(r.Context())
	room, err := s.scoreService.GetRoom(r.Context(), actor)
	if err != nil {
		s.writeScoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"room": room})
}

func (s *Server) handleStartScoreRoom(w http.ResponseWriter, r *http.Request) {
	s.handleScoreCommand(w, r, http.StatusOK, func(actor score.Actor, body scoreCommandBody) (score.RoomSnapshot, error) {
		return s.scoreService.StartRoom(r.Context(), actor, body.meta())
	})
}

func (s *Server) handleCancelScoreRoom(w http.ResponseWriter, r *http.Request) {
	s.handleScoreCommand(w, r, http.StatusOK, func(actor score.Actor, body scoreCommandBody) (score.RoomSnapshot, error) {
		return s.scoreService.CancelRoom(r.Context(), actor, body.meta())
	})
}

func (s *Server) handleStartScoreRound(w http.ResponseWriter, r *http.Request) {
	var body struct {
		scoreCommandBody
		ReversesRoundID string `json:"reversesRoundId"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	actor, _ := scoreActorFromContext(r.Context())
	room, err := s.scoreService.StartRound(r.Context(), actor, body.meta(), score.StartRoundInput{ReversesRoundID: strings.TrimSpace(body.ReversesRoundID)})
	s.writeScoreMutation(w, http.StatusCreated, room, err)
}

func (s *Server) handleSubmitScoreEntry(w http.ResponseWriter, r *http.Request) {
	var body struct {
		scoreCommandBody
		DeltaPoints int64 `json:"deltaPoints"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	actor, _ := scoreActorFromContext(r.Context())
	room, err := s.scoreService.SubmitEntry(r.Context(), actor, body.meta(), r.PathValue("roundID"), body.DeltaPoints)
	s.writeScoreMutation(w, http.StatusOK, room, err)
}

func (s *Server) handleConfirmScoreRound(w http.ResponseWriter, r *http.Request) {
	s.handleScoreCommand(w, r, http.StatusOK, func(actor score.Actor, body scoreCommandBody) (score.RoomSnapshot, error) {
		return s.scoreService.ConfirmRound(r.Context(), actor, body.meta(), r.PathValue("roundID"))
	})
}

func (s *Server) handleCancelScoreRound(w http.ResponseWriter, r *http.Request) {
	s.handleScoreCommand(w, r, http.StatusOK, func(actor score.Actor, body scoreCommandBody) (score.RoomSnapshot, error) {
		return s.scoreService.CancelRound(r.Context(), actor, body.meta(), r.PathValue("roundID"))
	})
}

func (s *Server) handleRemoveScoreParticipant(w http.ResponseWriter, r *http.Request) {
	s.handleScoreCommand(w, r, http.StatusOK, func(actor score.Actor, body scoreCommandBody) (score.RoomSnapshot, error) {
		return s.scoreService.RemoveParticipant(r.Context(), actor, body.meta(), r.PathValue("participantID"))
	})
}

func (s *Server) handleSettleScoreRoom(w http.ResponseWriter, r *http.Request) {
	s.handleScoreCommand(w, r, http.StatusOK, func(actor score.Actor, body scoreCommandBody) (score.RoomSnapshot, error) {
		return s.scoreService.SettleRoom(r.Context(), actor, body.meta())
	})
}

func (s *Server) handleScoreInviteToken(w http.ResponseWriter, r *http.Request) {
	actor, _ := scoreActorFromContext(r.Context())
	token, err := s.scoreService.IssueInviteToken(r.Context(), actor)
	if err != nil {
		s.writeScoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"inviteToken": token})
}

func (s *Server) handleCreateScoreRealtimeTicket(w http.ResponseWriter, r *http.Request) {
	actor, _ := scoreActorFromContext(r.Context())
	ticket, expiresAt, err := s.realtimeHub.IssueTicket(scorePrincipal(actor.ParticipantID))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "create_realtime_ticket_failed"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"expiresAt": formatSocialTime(expiresAt), "ticket": ticket})
}

func (s *Server) handleScoreCommand(w http.ResponseWriter, r *http.Request, status int, command func(score.Actor, scoreCommandBody) (score.RoomSnapshot, error)) {
	var body scoreCommandBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	actor, _ := scoreActorFromContext(r.Context())
	room, err := command(actor, body)
	s.writeScoreMutation(w, status, room, err)
}

func (s *Server) writeScoreMutation(w http.ResponseWriter, status int, room score.RoomSnapshot, err error) {
	if err != nil {
		s.writeScoreError(w, err)
		return
	}
	s.publishScoreInvalidation(room)
	writeJSON(w, status, map[string]any{"room": room})
}

func (s *Server) publishScoreInvalidation(room score.RoomSnapshot) {
	event := realtime.Event{Type: "score.room.updated", Data: map[string]any{
		"roomId": room.ID, "roomVersion": room.Version, "sequence": room.EventSequence,
	}}
	for _, participant := range room.Participants {
		s.realtimeHub.Publish(scorePrincipal(participant.ID), event)
	}
}

func scorePrincipal(participantID string) string { return "score:" + participantID }

func (s *Server) writeScoreError(w http.ResponseWriter, err error) {
	var conflict *score.VersionConflictError
	switch {
	case errors.As(err, &conflict):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "score_version_conflict", "room": conflict.Latest})
	case errors.Is(err, score.ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
	case errors.Is(err, score.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "score_action_forbidden"})
	case errors.Is(err, score.ErrInviteInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "score_invite_invalid"})
	case errors.Is(err, score.ErrRoomNotFound), errors.Is(err, score.ErrRoundNotFound), errors.Is(err, score.ErrParticipantMissing):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "score_not_found"})
	case errors.Is(err, score.ErrRoomFull):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "score_room_full"})
	case errors.Is(err, score.ErrNicknameConflict):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "score_nickname_conflict"})
	case errors.Is(err, score.ErrActionIDReused):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "score_action_id_reused"})
	case errors.Is(err, score.ErrInvalidState):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "score_invalid_state"})
	case errors.Is(err, score.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "score_invalid_input"})
	case errors.Is(err, score.ErrBalancesNotZero):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": "score_balances_not_zero"})
	default:
		log.Printf("score request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "score_request_failed"})
	}
}
