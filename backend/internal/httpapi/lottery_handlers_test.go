package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"my-first-expo-app/backend/internal/lottery"
)

type fakeLotteryService struct {
	err      error
	snapshot lottery.HistorySnapshot
}

func (f fakeLotteryService) History(context.Context) (lottery.HistorySnapshot, error) {
	return f.snapshot, f.err
}

func TestLotteryHistoryHandlerReturnsSnapshot(t *testing.T) {
	api := &Server{lotteryService: fakeLotteryService{snapshot: lottery.HistorySnapshot{
		AnalysisWindowMax: 300,
		Draws:             []lottery.Draw{{Issue: "2026087", Date: "2026-07-30", Red: []int{1, 2, 3, 4, 5, 6}, Blue: 7}},
		Source:            "cwl",
	}}}
	mux := http.NewServeMux()
	registerLotteryRoutes(mux, api)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/lottery/ssq/history", nil)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var snapshot lottery.HistorySnapshot
	if err := json.NewDecoder(response.Body).Decode(&snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Source != "cwl" || snapshot.AnalysisWindowMax != 300 || len(snapshot.Draws) != 1 {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}

func TestLotteryHistoryHandlerMapsSourceErrors(t *testing.T) {
	tests := []struct {
		body string
		err  error
	}{
		{err: lottery.ErrSourceUnavailable, body: "lottery_source_unavailable"},
		{err: lottery.ErrSourceInvalid, body: "lottery_source_invalid"},
		{err: errors.New("unexpected"), body: "lottery_source_unavailable"},
	}
	for _, test := range tests {
		api := &Server{lotteryService: fakeLotteryService{err: test.err}}
		response := httptest.NewRecorder()
		api.handleLotteryHistory(response, httptest.NewRequest(http.MethodGet, "/api/v1/lottery/ssq/history", nil))
		if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), test.body) {
			t.Fatalf("error %v: status/body = %d %s", test.err, response.Code, response.Body.String())
		}
	}
}

var _ lotteryHistoryService = fakeLotteryService{}
