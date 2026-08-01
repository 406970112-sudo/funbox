package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"my-first-expo-app/backend/internal/lotterylab"
)

type fakeLotteryLabService struct {
	err      error
	count    int
	snapshot lotterylab.HistorySnapshot
}

func (f *fakeLotteryLabService) History(_ context.Context, count int) (lotterylab.HistorySnapshot, error) {
	f.count = count
	return f.snapshot, f.err
}

func TestLotteryLabHistoryHandlerUsesCountQuery(t *testing.T) {
	service := &fakeLotteryLabService{
		snapshot: lotterylab.HistorySnapshot{
			Count:  1000,
			Draws:  []lotterylab.Draw{{Issue: "2026087", Date: "2026-07-30", Red: []int{1, 2, 3, 4, 5, 6}, Blue: 7}},
			Source: "cwl",
		},
	}
	api := &Server{lotteryLabService: service}
	mux := http.NewServeMux()
	registerLotteryLabRoutes(mux, api)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/lottery/ssq-lab/history?count=1000", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if service.count != 1000 {
		t.Fatalf("count = %d", service.count)
	}
	var snapshot lotterylab.HistorySnapshot
	if err := json.NewDecoder(response.Body).Decode(&snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Source != "cwl" || len(snapshot.Draws) != 1 {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}

func TestLotteryLabHistoryHandlerDefaultsAndRejectsInvalidCount(t *testing.T) {
	service := &fakeLotteryLabService{snapshot: lotterylab.HistorySnapshot{Source: "cwl"}}
	api := &Server{lotteryLabService: service}
	mux := http.NewServeMux()
	registerLotteryLabRoutes(mux, api)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/lottery/ssq-lab/history", nil))
	if response.Code != http.StatusOK || service.count != 400 {
		t.Fatalf("status/count = %d/%d", response.Code, service.count)
	}

	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/lottery/ssq-lab/history?count=99999", nil))
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "invalid_count") {
		t.Fatalf("status/body = %d %s", response.Code, response.Body.String())
	}
}

func TestLotteryLabHistoryHandlerMapsSourceErrors(t *testing.T) {
	tests := []struct {
		body string
		err  error
	}{
		{err: lotterylab.ErrSourceUnavailable, body: "lottery_source_unavailable"},
		{err: lotterylab.ErrSourceInvalid, body: "lottery_source_invalid"},
		{err: errors.New("unexpected"), body: "lottery_source_unavailable"},
	}
	for _, test := range tests {
		api := &Server{lotteryLabService: &fakeLotteryLabService{err: test.err}}
		response := httptest.NewRecorder()
		api.handleLotteryLabHistory(response, httptest.NewRequest(http.MethodGet, "/api/v1/lottery/ssq-lab/history", nil))
		if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), test.body) {
			t.Fatalf("error %v: status/body = %d %s", test.err, response.Code, response.Body.String())
		}
	}
}

var _ lotteryLabHistoryService = (*fakeLotteryLabService)(nil)
