package httpapi

import (
	"context"
	"errors"
	"log"
	"net/http"

	"my-first-expo-app/backend/internal/marketradar"
)

type marketRadarSnapshotService interface {
	Snapshot(context.Context, bool) (marketradar.Snapshot, error)
}

func registerMarketRadarRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("GET /api/v1/market-radar/snapshot", api.withAPIPipeline(api.handleMarketRadarSnapshot))
}

func (s *Server) handleMarketRadarSnapshot(w http.ResponseWriter, r *http.Request) {
	force := r.URL.Query().Get("refresh") == "1"
	snapshot, err := s.marketRadarService.Snapshot(r.Context(), force)
	if err != nil {
		log.Printf("market radar snapshot failed: %v", err)
		code := "market_radar_source_unavailable"
		if errors.Is(err, marketradar.ErrSourceInvalid) {
			code = "market_radar_source_invalid"
		}
		if errors.Is(err, marketradar.ErrInsufficientCoverage) {
			code = "market_radar_insufficient_coverage"
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": code})
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}
