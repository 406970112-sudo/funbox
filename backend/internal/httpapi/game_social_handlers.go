package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/realtime"
	"my-first-expo-app/backend/internal/social"
)

type gameMoveResponse struct {
	ClientMoveID string `json:"clientMoveId"`
	Col          int    `json:"col"`
	CreatedAt    string `json:"createdAt"`
	Row          int    `json:"row"`
	Sequence     int    `json:"sequence"`
	UserID       string `json:"userId"`
}

type gameMatchResponse struct {
	CreatedAt         string             `json:"createdAt"`
	CurrentTurnUserID string             `json:"currentTurnUserId"`
	GameID            string             `json:"gameId"`
	ID                string             `json:"id"`
	Inviter           socialUserResponse `json:"inviter"`
	Moves             []gameMoveResponse `json:"moves"`
	Opponent          socialUserResponse `json:"opponent"`
	Status            string             `json:"status"`
	UpdatedAt         string             `json:"updatedAt"`
	WinnerUserID      string             `json:"winnerUserId"`
}

type gameScoreResponse struct {
	CreatedAt string `json:"createdAt"`
	GameID    string `json:"gameId"`
	ID        string `json:"id"`
	Score     int    `json:"score"`
	UserID    string `json:"userId"`
}

type gameLeaderboardEntryResponse struct {
	IsCurrentUser bool               `json:"isCurrentUser"`
	Rank          int                `json:"rank"`
	Score         int                `json:"score"`
	UpdatedAt     string             `json:"updatedAt"`
	User          socialUserResponse `json:"user"`
}

type createGameMatchBody struct {
	GameID     string `json:"gameId"`
	OpponentID string `json:"opponentId"`
}

type createGameMoveBody struct {
	ClientMoveID string `json:"clientMoveId"`
	Col          int    `json:"col"`
	Row          int    `json:"row"`
}

type createGameScoreBody struct {
	GameID string `json:"gameId"`
	Score  int    `json:"score"`
}

func (s *Server) handleCreateGameMatch(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var body createGameMatchBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	match, err := s.socialStore.CreateGameMatch(
		r.Context(),
		account.ID,
		strings.TrimSpace(body.OpponentID),
		strings.TrimSpace(body.GameID),
	)
	if err != nil {
		writeGameSocialError(w, err)
		return
	}
	response := s.gameMatch(match)
	s.realtimeHub.Publish(match.Opponent.ID, realtime.Event{
		Type: "game.match.invited",
		Data: response,
	})
	writeJSON(w, http.StatusCreated, map[string]any{"match": response})
}

func (s *Server) handleListGameMatches(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	matches, err := s.socialStore.ListGameMatches(r.Context(), account.ID)
	if err != nil {
		writeGameSocialError(w, err)
		return
	}
	result := make([]gameMatchResponse, 0, len(matches))
	for _, match := range matches {
		result = append(result, s.gameMatch(match))
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": result})
}

func (s *Server) handleGetGameMatch(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	match, err := s.socialStore.GetGameMatch(r.Context(), r.PathValue("matchID"), account.ID)
	if err != nil {
		writeGameSocialError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"match": s.gameMatch(match)})
}

func (s *Server) handleAcceptGameMatch(w http.ResponseWriter, r *http.Request) {
	s.handleRespondGameMatch(w, r, true)
}

func (s *Server) handleDeclineGameMatch(w http.ResponseWriter, r *http.Request) {
	s.handleRespondGameMatch(w, r, false)
}

func (s *Server) handleRespondGameMatch(w http.ResponseWriter, r *http.Request, accept bool) {
	account, _ := authenticatedUserFromContext(r.Context())
	match, err := s.socialStore.RespondGameMatch(r.Context(), r.PathValue("matchID"), account.ID, accept)
	if err != nil {
		writeGameSocialError(w, err)
		return
	}
	response := s.gameMatch(match)
	s.publishGameMatch(match, "game.match.updated", response)
	writeJSON(w, http.StatusOK, map[string]any{"match": response})
}

func (s *Server) handleCreateGameMove(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var body createGameMoveBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	match, err := s.socialStore.SubmitGameMove(
		r.Context(),
		r.PathValue("matchID"),
		account.ID,
		social.GameMoveInput{
			ClientMoveID: strings.TrimSpace(body.ClientMoveID),
			Col:          body.Col,
			Row:          body.Row,
		},
	)
	if err != nil {
		writeGameSocialError(w, err)
		return
	}
	response := s.gameMatch(match)
	eventType := "game.match.updated"
	if match.Status == social.GameMatchFinished {
		eventType = "game.match.finished"
	}
	s.publishGameMatch(match, eventType, response)
	writeJSON(w, http.StatusOK, map[string]any{"match": response})
}

func (s *Server) handleResignGameMatch(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	match, err := s.socialStore.ResignGameMatch(r.Context(), r.PathValue("matchID"), account.ID)
	if err != nil {
		writeGameSocialError(w, err)
		return
	}
	response := s.gameMatch(match)
	s.publishGameMatch(match, "game.match.finished", response)
	writeJSON(w, http.StatusOK, map[string]any{"match": response})
}

func (s *Server) handleCreateGameScore(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var body createGameScoreBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	score, err := s.socialStore.SubmitGameScore(
		r.Context(),
		account.ID,
		strings.TrimSpace(body.GameID),
		body.Score,
		time.Now().UTC(),
	)
	if err != nil {
		writeGameSocialError(w, err)
		return
	}
	response := gameScoreResponse{
		CreatedAt: formatSocialTime(score.CreatedAt),
		GameID:    score.GameID,
		ID:        score.ID,
		Score:     score.Score,
		UserID:    score.UserID,
	}
	friendIDs, err := s.socialStore.ListFriendIDs(r.Context(), account.ID)
	if err == nil {
		for _, friendID := range friendIDs {
			s.realtimeHub.Publish(friendID, realtime.Event{
				Type: "game.score.updated",
				Data: response,
			})
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"score": response})
}

func (s *Server) handleGetGameLeaderboard(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	period := strings.TrimSpace(r.URL.Query().Get("period"))
	if period == "" {
		period = social.LeaderboardWeekly
	}
	entries, err := s.socialStore.ListFriendLeaderboard(
		r.Context(),
		account.ID,
		strings.TrimSpace(r.PathValue("gameID")),
		period,
		time.Now().UTC(),
	)
	if err != nil {
		writeGameSocialError(w, err)
		return
	}
	result := make([]gameLeaderboardEntryResponse, 0, len(entries))
	for _, entry := range entries {
		result = append(result, gameLeaderboardEntryResponse{
			IsCurrentUser: entry.IsCurrentUser,
			Rank:          entry.Rank,
			Score:         entry.Score,
			UpdatedAt:     formatSocialTime(entry.UpdatedAt),
			User:          s.socialUser(entry.User),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": result})
}

func (s *Server) gameMatch(match social.GameMatch) gameMatchResponse {
	moves := make([]gameMoveResponse, 0, len(match.Moves))
	for _, move := range match.Moves {
		moves = append(moves, gameMoveResponse{
			ClientMoveID: move.ClientMoveID,
			Col:          move.Col,
			CreatedAt:    formatSocialTime(move.CreatedAt),
			Row:          move.Row,
			Sequence:     move.Sequence,
			UserID:       move.UserID,
		})
	}
	return gameMatchResponse{
		CreatedAt:         formatSocialTime(match.CreatedAt),
		CurrentTurnUserID: match.CurrentTurnUserID,
		GameID:            match.GameID,
		ID:                match.ID,
		Inviter:           s.socialUser(match.Inviter),
		Moves:             moves,
		Opponent:          s.socialUser(match.Opponent),
		Status:            match.Status,
		UpdatedAt:         formatSocialTime(match.UpdatedAt),
		WinnerUserID:      match.WinnerUserID,
	}
}

func (s *Server) publishGameMatch(match social.GameMatch, eventType string, response gameMatchResponse) {
	s.realtimeHub.Publish(match.Inviter.ID, realtime.Event{Type: eventType, Data: response})
	s.realtimeHub.Publish(match.Opponent.ID, realtime.Event{Type: eventType, Data: response})
}

func writeGameSocialError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, social.ErrGameCapability):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "game_capability_unsupported"})
	case errors.Is(err, social.ErrGameMove):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "game_move_invalid"})
	case errors.Is(err, social.ErrNotFriends):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "not_friends"})
	case errors.Is(err, social.ErrMatchExists):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "game_match_exists"})
	case errors.Is(err, social.ErrMatchNotActive):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "game_match_not_active"})
	case errors.Is(err, social.ErrNotYourTurn):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "game_not_your_turn"})
	case errors.Is(err, social.ErrCellOccupied):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "game_cell_occupied"})
	default:
		writeSocialError(w, err)
	}
}
