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

type fakeLotteryDrawService struct {
	latest  lottery.LatestSnapshot
	history lottery.GameHistoryPage
	detail  lottery.GameIssueDetail
	err     error
}

func (f fakeLotteryDrawService) Latest(context.Context) (lottery.LatestSnapshot, error) {
	return f.latest, f.err
}
func (f fakeLotteryDrawService) GameHistory(context.Context, string, lottery.GameHistoryQuery) (lottery.GameHistoryPage, error) {
	return f.history, f.err
}
func (f fakeLotteryDrawService) IssueDetail(context.Context, string, string) (lottery.GameIssueDetail, error) {
	return f.detail, f.err
}

func TestLotteryMultiGameRoutes(t *testing.T) {
	api := &Server{
		lotteryService: fakeLotteryService{},
		lotteryDrawService: fakeLotteryDrawService{
			latest:  lottery.LatestSnapshot{Games: []lottery.LatestGameItem{{Game: "dlt", Name: "超级大乐透", Available: true}}},
			history: lottery.GameHistoryPage{Game: "dlt", Total: 1, Draws: []lottery.GameDraw{{Issue: "26135", Front: []string{"03", "11", "19", "25", "34"}, Back: []string{"04", "11"}}}},
			detail:  lottery.GameIssueDetail{Game: "dlt", Draw: lottery.GameDraw{Issue: "26135"}, PrevIssue: "26134"},
		},
	}
	mux := http.NewServeMux()
	registerLotteryRoutes(mux, api)

	for _, path := range []string{
		"/api/v1/lottery/latest",
		"/api/v1/lottery/games/dlt/history?limit=20&year=2026",
		"/api/v1/lottery/games/dlt/issues/26135",
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d body = %s", path, rec.Code, rec.Body.String())
		}
	}

	notFoundAPI := &Server{lotteryDrawService: fakeLotteryDrawService{err: lottery.ErrGameNotFound}}
	mux2 := http.NewServeMux()
	registerLotteryRoutes(mux2, notFoundAPI)
	rec := httptest.NewRecorder()
	mux2.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/lottery/games/unknown/history", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown game status = %d", rec.Code)
	}
}
