package lottery

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDrawServiceFetchesAllSevenGamesAndSupportsHistoryAndIssueDetail(t *testing.T) {
	cwlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("name") {
		case "ssq":
			_, _ = w.Write([]byte(`{"state":0,"result":[
				{"code":"2026136","date":"2026-11-24(二)","red":"04,09,16,21,27,31","blue":"08","sales":"386000000","poolmoney":"2186000000","prizegrades":[{"type":1,"typenum":"7","typemoney":"7482190"},{"type":6,"typenum":"10641200","typemoney":"5"}]},
				{"code":"2025150","date":"2025-12-30(二)","red":"01,02,03,04,05,06","blue":"07","sales":"350000000","poolmoney":"2000000000","prizegrades":[]}
			]}`))
		case "3d":
			_, _ = w.Write([]byte(`{"state":0,"result":[{"code":"2026316","date":"2026-11-25","red":"5,2,8","blue":"","sales":"91200000","poolmoney":"","prizegrades":[{"type":"直选","typenum":"12300","typemoney":"1040"}]}]}`))
		case "qlc":
			_, _ = w.Write([]byte(`{"state":0,"result":[{"code":"2026135","date":"2026-11-25","red":"02,07,14,18,22,26,29","blue":"11","sales":"4680000","poolmoney":"12400000","prizegrades":[{"type":1,"typenum":"1","typemoney":"2000000"}]}]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer cwlServer.Close()

	sportServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Query().Get("gameNo") {
		case "85":
			_, _ = w.Write([]byte(`{"success":true,"value":{"list":[{"lotteryDrawNum":"26135","lotteryDrawTime":"2026-11-25","lotteryDrawResult":"03 11 19 25 34 04 11","totalSaleAmount":"314,000,000","poolBalanceAfterdraw":"942,000,000","prizeLevelList":[{"prizeLevel":"一等奖","stakeCount":"5","stakeAmount":"10,000,000"}]}]}}`))
		case "35":
			_, _ = w.Write([]byte(`{"success":true,"value":{"list":[{"lotteryDrawNum":"26316","lotteryDrawTime":"2026-11-25","lotteryDrawResult":"7 0 4","totalSaleAmount":"43,800,000","poolBalanceAfterdraw":"","prizeLevelList":[{"prizeLevel":"直选","stakeCount":"10000","stakeAmount":"1,040"}]}]}}`))
		case "350133":
			_, _ = w.Write([]byte(`{"success":true,"value":{"list":[{"lotteryDrawNum":"26316","lotteryDrawTime":"2026-11-25","lotteryDrawResult":"7 0 4 9 2","totalSaleAmount":"21,900,000","poolBalanceAfterdraw":"","prizeLevelList":[{"prizeLevel":"一等奖","stakeCount":"120","stakeAmount":"100,000"}]}]}}`))
		case "04":
			_, _ = w.Write([]byte(`{"success":true,"value":{"list":[{"lotteryDrawNum":"26135","lotteryDrawTime":"2026-11-24","lotteryDrawResult":"2 8 1 6 0 5 11","totalSaleAmount":"28,500,000","poolBalanceAfterdraw":"318,000,000","prizeLevelList":[{"prizeLevel":"一等奖","stakeCount":"1","stakeAmount":"5,000,000"}]}]}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer sportServer.Close()

	svc := NewDrawService(DrawServiceConfig{
		CacheTTL:        time.Minute,
		CWLBaseURL:      cwlServer.URL,
		SportteryAPIURL: sportServer.URL,
	})

	latest, err := svc.Latest(context.Background())
	if err != nil {
		t.Fatalf("Latest error: %v", err)
	}
	if len(latest.Games) != 7 {
		t.Fatalf("games = %d, want 7", len(latest.Games))
	}
	for _, g := range latest.Games {
		if !g.Available || g.Latest == nil {
			t.Fatalf("game %s unavailable", g.Game)
		}
	}

	page, err := svc.GameHistory(context.Background(), "ssq", GameHistoryQuery{Year: "2026", Limit: 10})
	if err != nil {
		t.Fatalf("GameHistory error: %v", err)
	}
	if page.Total != 1 || page.Draws[0].Issue != "2026136" || len(page.Years) != 2 {
		t.Fatalf("unexpected history page: %#v", page)
	}

	detail, err := svc.IssueDetail(context.Background(), "ssq", "2026136")
	if err != nil {
		t.Fatalf("IssueDetail error: %v", err)
	}
	if detail.PrevIssue != "2025150" || detail.NextIssue != "" || len(detail.Draw.PrizeGrades) != 2 {
		t.Fatalf("unexpected detail: %#v", detail)
	}
}
