package httpapi

import (
	"context"
	"errors"
	"net/http"

	"my-first-expo-app/backend/internal/lottery"
)

type lotteryHistoryService interface {
	History(context.Context) (lottery.HistorySnapshot, error)
}

func registerLotteryRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("GET /api/v1/lottery/ssq/history", api.withAPIPipeline(api.handleLotteryHistory))
}

func (s *Server) handleLotteryHistory(w http.ResponseWriter, r *http.Request) {
	snapshot, err := s.lotteryService.History(r.Context())
	if err != nil {
		code := "lottery_source_unavailable"
		if errors.Is(err, lottery.ErrSourceInvalid) {
			code = "lottery_source_invalid"
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": code})
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}
