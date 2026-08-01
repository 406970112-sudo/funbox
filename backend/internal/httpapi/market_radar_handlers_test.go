package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"my-first-expo-app/backend/internal/marketradar"
)

type fakeMarketRadarService struct {
	err          error
	forceRefresh bool
	snapshot     marketradar.Snapshot
}

func (f *fakeMarketRadarService) Snapshot(_ context.Context, force bool) (marketradar.Snapshot, error) {
	f.forceRefresh = force
	return f.snapshot, f.err
}

func TestMarketRadarSnapshotHandlerReturnsSnapshot(t *testing.T) {
	api := &Server{marketRadarService: &fakeMarketRadarService{snapshot: marketradar.Snapshot{
		Source: "eastmoney",
	}}}
	mux := http.NewServeMux()
	registerMarketRadarRoutes(mux, api)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/market-radar/snapshot?refresh=1", nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var snapshot marketradar.Snapshot
	if err := json.NewDecoder(response.Body).Decode(&snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Source != "eastmoney" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	if !api.marketRadarService.(*fakeMarketRadarService).forceRefresh {
		t.Fatal("refresh was not forwarded")
	}
}

func TestMarketRadarSnapshotHandlerMapsSourceErrors(t *testing.T) {
	tests := []struct {
		body string
		err  error
	}{
		{err: marketradar.ErrSourceUnavailable, body: "market_radar_source_unavailable"},
		{err: marketradar.ErrSourceInvalid, body: "market_radar_source_invalid"},
		{err: marketradar.ErrInsufficientCoverage, body: "market_radar_insufficient_coverage"},
		{err: errors.New("unexpected"), body: "market_radar_source_unavailable"},
	}
	for _, test := range tests {
		api := &Server{marketRadarService: &fakeMarketRadarService{err: test.err}}
		response := httptest.NewRecorder()
		api.handleMarketRadarSnapshot(response, httptest.NewRequest(http.MethodGet, "/api/v1/market-radar/snapshot", nil))
		if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), test.body) {
			t.Fatalf("error %v: status/body = %d %s", test.err, response.Code, response.Body.String())
		}
	}
}

var _ marketRadarSnapshotService = (*fakeMarketRadarService)(nil)
