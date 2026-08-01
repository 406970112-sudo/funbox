package httpapi

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"

	"my-first-expo-app/backend/internal/marketradar"
	"my-first-expo-app/backend/internal/news"
)

type marketRadarSnapshotService interface {
	Snapshot(context.Context, bool) (marketradar.Snapshot, error)
	SectorDetail(context.Context, string) (marketradar.SectorDetail, error)
}

func registerMarketRadarRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("GET /api/v1/market-radar/snapshot", api.withAPIPipeline(api.handleMarketRadarSnapshot))
	mux.HandleFunc("GET /api/v1/market-radar/sectors/{sectorID}", api.withAPIPipeline(api.handleMarketRadarSectorDetail))
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

type marketRadarSectorDetailResponse struct {
	marketradar.SectorDetail
	News []news.Event `json:"news"`
}

func (s *Server) handleMarketRadarSectorDetail(w http.ResponseWriter, r *http.Request) {
	sectorID := r.PathValue("sectorID")
	detail, err := s.marketRadarService.SectorDetail(r.Context(), sectorID)
	if err != nil {
		log.Printf("market radar sector detail failed: %v", err)
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
	writeJSON(w, http.StatusOK, marketRadarSectorDetailResponse{
		SectorDetail: detail,
		News:         s.sectorNews(r.Context(), sectorID, detail.Name),
	})
}

func (s *Server) sectorNews(ctx context.Context, sectorID string, sectorName string) []news.Event {
	if s.newsService == nil {
		return nil
	}
	snapshot, err := s.newsService.Feed(ctx)
	if err != nil {
		return nil
	}
	keywords := marketradar.BoardKeywords(sectorID)
	keywords = append(keywords, sectorName)

	result := make([]news.Event, 0, 5)
	for _, event := range snapshot.Events {
		text := strings.ToLower(event.Title + " " + event.Summary.OneSentence)
		if matchesSectorNewsKeywords(text, keywords) {
			result = append(result, event)
			if len(result) >= 5 {
				break
			}
		}
	}
	return result
}

func matchesSectorNewsKeywords(text string, keywords []string) bool {
	for _, keyword := range keywords {
		if keyword != "" && strings.Contains(text, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}
