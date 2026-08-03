package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"my-first-expo-app/backend/internal/stockalert"
	"my-first-expo-app/backend/internal/user"
)

type fakeStockAlertService struct {
	symbols  []stockalert.Symbol
	watch    stockalert.WatchItem
	items    []stockalert.WatchItem
	events   []stockalert.AlertEvent
	settings stockalert.Settings
	push     map[string]any
	err      error
}

func (f *fakeStockAlertService) Search(_ context.Context, _ string) ([]stockalert.Symbol, error) {
	return f.symbols, f.err
}

func (f *fakeStockAlertService) AddWatch(_ context.Context, _ string, _ string) (stockalert.WatchItem, error) {
	return f.watch, f.err
}

func (f *fakeStockAlertService) ListWatch(_ context.Context, _ string) ([]stockalert.WatchItem, error) {
	return f.items, f.err
}

func (f *fakeStockAlertService) GetWatch(_ context.Context, _ string, _ string) (stockalert.WatchItem, error) {
	return f.watch, f.err
}

func (f *fakeStockAlertService) UpdateWatch(_ context.Context, _ string, _ string, _ *bool, _ []string) (stockalert.WatchItem, error) {
	return f.watch, f.err
}

func (f *fakeStockAlertService) DeleteWatch(_ context.Context, _ string, _ string) error {
	return f.err
}

func (f *fakeStockAlertService) Reanalyze(_ context.Context, _ string, _ string) (stockalert.WatchItem, error) {
	return f.watch, f.err
}

func (f *fakeStockAlertService) Intraday(_ context.Context, _ string, _ string) (stockalert.IntradaySnapshot, error) {
	return stockalert.IntradaySnapshot{}, f.err
}

func (f *fakeStockAlertService) Events(_ context.Context, _ string, _ int) ([]stockalert.AlertEvent, int, error) {
	return f.events, 1, f.err
}

func (f *fakeStockAlertService) MarkEventsRead(_ context.Context, _ string, _ []string) error {
	return f.err
}

func (f *fakeStockAlertService) GetSettings(_ context.Context, _ string) (stockalert.Settings, error) {
	return f.settings, f.err
}

func (f *fakeStockAlertService) SaveSettings(_ context.Context, _ string, _ string, _ bool) (stockalert.Settings, error) {
	return f.settings, f.err
}

func (f *fakeStockAlertService) TestPush(_ context.Context, _ string) (map[string]any, error) {
	return f.push, f.err
}

func stockAlertTestRequest(method string, target string, body string) *http.Request {
	request := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	request = request.WithContext(contextWithAuthenticatedUser(request.Context(), user.User{ID: "user-1", Username: "tester"}))
	return request
}

func TestStockAlertSearchHandlerReturnsRealSymbols(t *testing.T) {
	api := &Server{stockAlertService: &fakeStockAlertService{
		symbols: []stockalert.Symbol{{Code: "600519", Name: "贵州茅台", Market: "SH", SecID: "1.600519"}},
	}}
	response := httptest.NewRecorder()
	api.handleStockAlertSearch(response, stockAlertTestRequest(http.MethodGet, "/api/v1/stock-alert/search?q=600519", ""))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "600519") {
		t.Fatalf("status/body = %d %s", response.Code, response.Body.String())
	}
}

func TestStockAlertAddWatchHandlerMapsAnalysisError(t *testing.T) {
	api := &Server{stockAlertService: &fakeStockAlertService{err: stockalert.ErrAnalysisUnavailable}}
	response := httptest.NewRecorder()
	api.handleStockAlertAddWatch(response, stockAlertTestRequest(http.MethodPost, "/api/v1/stock-alert/watch", `{"query":"600519"}`))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "stock_alert_analysis_unavailable") {
		t.Fatalf("status/body = %d %s", response.Code, response.Body.String())
	}
}

func TestStockAlertErrorIncludesUpstreamStage(t *testing.T) {
	api := &Server{stockAlertService: &fakeStockAlertService{
		err: fmt.Errorf("search upstream: %w", stockalert.ErrSourceUnavailable),
	}}
	response := httptest.NewRecorder()
	api.handleStockAlertSearch(response, stockAlertTestRequest(http.MethodGet, "/api/v1/stock-alert/search?q=600519", ""))
	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "search upstream") {
		t.Fatalf("status/body = %d %s", response.Code, response.Body.String())
	}
}

func TestStockAlertListWatchHandlerReturnsItems(t *testing.T) {
	api := &Server{stockAlertService: &fakeStockAlertService{
		items: []stockalert.WatchItem{{SymbolCode: "600519", Name: "贵州茅台", SignalStatus: stockalert.SignalListening}},
	}}
	response := httptest.NewRecorder()
	api.handleStockAlertListWatch(response, stockAlertTestRequest(http.MethodGet, "/api/v1/stock-alert/watch", ""))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "贵州茅台") {
		t.Fatalf("status/body = %d %s", response.Code, response.Body.String())
	}
}

func TestStockAlertEventsHandlerReturnsUnreadCount(t *testing.T) {
	api := &Server{stockAlertService: &fakeStockAlertService{
		events: []stockalert.AlertEvent{{
			ID:             "e1",
			SymbolCode:     "600519",
			Name:           "贵州茅台",
			Direction:      "buy",
			SignalStrength: stockalert.StrengthConfirmed,
		}},
	}}
	response := httptest.NewRecorder()
	api.handleStockAlertEvents(response, stockAlertTestRequest(http.MethodGet, "/api/v1/stock-alert/events", ""))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		Events []stockalert.AlertEvent `json:"events"`
		Unread int                     `json:"unread"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Unread != 1 || len(payload.Events) != 1 {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestStockAlertSettingsHandlerMasksSendKey(t *testing.T) {
	api := &Server{stockAlertService: &fakeStockAlertService{
		settings: stockalert.Settings{UserID: "user-1", SendKeyBound: true, SendKeyMasked: "SCT3****TKEY"},
	}}
	response := httptest.NewRecorder()
	api.handleStockAlertSaveSettings(response, stockAlertTestRequest(http.MethodPut, "/api/v1/stock-alert/settings", `{"sendKey":"secret"}`))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "SCT3****TKEY") {
		t.Fatalf("status/body = %d %s", response.Code, response.Body.String())
	}
}

var _ stockAlertService = (*fakeStockAlertService)(nil)
