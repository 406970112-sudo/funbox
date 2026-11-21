package httpapi

import (
	"net/http"
	"time"

	"my-first-expo-app/backend/internal/score"
)

func registerMahjongHandoverRoutes(mux *http.ServeMux, api *Server) {
	// Waiting guests poll for the host's approval. Keep those reads separate
	// from the rate limit for joining rooms and submitting invitations.
	previewLimiter := NewRateLimiter(time.Minute, 120)
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/mahjong-handover",
		api.withScoreActor(api.withAPIPipeline(api.handleManageMahjongHandover)))
	mux.HandleFunc("POST /api/v1/score-rooms/{roomID}/mahjong-handover/{handoverID}/code",
		api.withScoreActor(api.withRateLimitedAPIPipeline("score-handover-code", api.handleMahjongHandoverCode)))
	mux.HandleFunc("POST /api/v1/score-rooms/mahjong-handover/preview",
		api.withJSONPipelineAndLimiter("score-handover-preview", previewLimiter, api.handleMahjongHandoverPreview))
	mux.HandleFunc("POST /api/v1/score-rooms/mahjong-handover/accept",
		api.withOptionalAuthError(api.withRateLimitedAPIPipeline("score-handover-accept", api.handleAcceptMahjongHandover), "score_handover_login_expired"))
}

func (s *Server) handleManageMahjongHandover(w http.ResponseWriter, r *http.Request) {
	var body struct {
		scoreCommandBody
		score.MahjongHandoverInput
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	actor, _ := scoreActorFromContext(r.Context())
	room, err := s.scoreService.ManageMahjongHandover(r.Context(), actor, body.meta(), body.MahjongHandoverInput)
	s.writeScoreMutation(w, http.StatusOK, room, err)
}

func (s *Server) handleMahjongHandoverCode(w http.ResponseWriter, r *http.Request) {
	actor, _ := scoreActorFromContext(r.Context())
	result, err := s.scoreService.IssueMahjongHandoverCode(r.Context(), actor, r.PathValue("handoverID"))
	if err != nil {
		s.writeScoreError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleMahjongHandoverPreview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Scene      string `json:"scene"`
		ClaimToken string `json:"claimToken"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	preview, err := s.scoreService.PreviewMahjongHandover(r.Context(), body.Scene, body.ClaimToken)
	if err != nil {
		s.writeScoreError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"handover": preview})
}

func (s *Server) handleAcceptMahjongHandover(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Scene            string `json:"scene"`
		ClaimToken       string `json:"claimToken"`
		DisplayName      string `json:"displayName"`
		ParticipantToken string `json:"participantToken"`
		Points           *int64 `json:"points"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if body.Points == nil {
		s.writeScoreError(w, score.ErrInvalidInput)
		return
	}
	input := score.MahjongHandoverAcceptance{
		Scene: body.Scene, ClaimToken: body.ClaimToken, DisplayName: body.DisplayName,
		ParticipantToken: body.ParticipantToken, Points: *body.Points,
	}
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		input.UserID = account.ID
	}
	preview, room, err := s.scoreService.AcceptMahjongHandover(r.Context(), input)
	if err != nil {
		s.writeScoreError(w, err)
		return
	}
	if room.ID != "" {
		s.publishScoreInvalidation(room)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"handover": preview})
}
