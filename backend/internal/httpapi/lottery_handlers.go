package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/lottery"
)

type lotteryHistoryService interface {
	History(context.Context) (lottery.HistorySnapshot, error)
}

type lotteryDrawQueryService interface {
	Latest(context.Context) (lottery.LatestSnapshot, error)
	GameHistory(context.Context, string, lottery.GameHistoryQuery) (lottery.GameHistoryPage, error)
	IssueDetail(context.Context, string, string) (lottery.GameIssueDetail, error)
}

func registerLotteryRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("GET /api/v1/lottery/ssq/history", api.withAPIPipeline(api.handleLotteryHistory))
	mux.HandleFunc("GET /api/v1/lottery/latest", api.withAPIPipeline(api.handleLotteryLatest))
	mux.HandleFunc("GET /api/v1/lottery/games/{game}/history", api.withAPIPipeline(api.handleLotteryGameHistory))
	mux.HandleFunc("GET /api/v1/lottery/games/{game}/issues/{issue}", api.withAPIPipeline(api.handleLotteryIssueDetail))
}

func (s *Server) handleLotteryHistory(w http.ResponseWriter, r *http.Request) {
	snapshot, err := s.lotteryService.History(r.Context())
	if err != nil {
		writeLotteryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleLotteryLatest(w http.ResponseWriter, r *http.Request) {
	if s.lotteryDrawService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "lottery_source_unavailable"})
		return
	}
	snapshot, err := s.lotteryDrawService.Latest(r.Context())
	if err != nil {
		writeLotteryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleLotteryGameHistory(w http.ResponseWriter, r *http.Request) {
	if s.lotteryDrawService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "lottery_source_unavailable"})
		return
	}
	game := strings.TrimSpace(r.PathValue("game"))
	q := r.URL.Query()
	limit, _ := strconv.Atoi(strings.TrimSpace(q.Get("limit")))
	offset, _ := strconv.Atoi(strings.TrimSpace(q.Get("offset")))
	page, err := s.lotteryDrawService.GameHistory(r.Context(), game, lottery.GameHistoryQuery{
		Limit:  limit,
		Offset: offset,
		Year:   strings.TrimSpace(q.Get("year")),
		Issue:  strings.TrimSpace(q.Get("issue")),
	})
	if err != nil {
		writeLotteryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleLotteryIssueDetail(w http.ResponseWriter, r *http.Request) {
	if s.lotteryDrawService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "lottery_source_unavailable"})
		return
	}
	game := strings.TrimSpace(r.PathValue("game"))
	issue := strings.TrimSpace(r.PathValue("issue"))
	detail, err := s.lotteryDrawService.IssueDetail(r.Context(), game, issue)
	if err != nil {
		writeLotteryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func writeLotteryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, lottery.ErrGameNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "lottery_game_not_found"})
	case errors.Is(err, lottery.ErrIssueNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "lottery_issue_not_found"})
	case errors.Is(err, lottery.ErrSourceInvalid):
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "lottery_source_invalid"})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "lottery_source_unavailable"})
	}
}
