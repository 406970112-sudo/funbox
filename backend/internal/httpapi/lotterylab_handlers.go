package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"my-first-expo-app/backend/internal/lotterylab"
)

var errLotteryLabCountInvalid = errors.New("invalid lottery lab count")

type lotteryLabHistoryService interface {
	History(context.Context, int) (lotterylab.HistorySnapshot, error)
}

func registerLotteryLabRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("GET /api/v1/lottery/ssq-lab/history", api.withAPIPipeline(api.handleLotteryLabHistory))
}

func (s *Server) handleLotteryLabHistory(w http.ResponseWriter, r *http.Request) {
	count, err := parseLotteryLabCount(r.URL.Query().Get("count"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_count"})
		return
	}

	snapshot, err := s.lotteryLabService.History(r.Context(), count)
	if err != nil {
		code := "lottery_source_unavailable"
		if errors.Is(err, lotterylab.ErrSourceInvalid) {
			code = "lottery_source_invalid"
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": code})
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func parseLotteryLabCount(value string) (int, error) {
	if value == "" {
		return 400, nil
	}
	count, err := strconv.Atoi(value)
	if err != nil || count < 100 || count > 1000 {
		return 0, errLotteryLabCountInvalid
	}
	return count, nil
}
