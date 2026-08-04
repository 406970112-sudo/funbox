package httpapi

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/stockalert"
)

type stockAlertService interface {
	Search(context.Context, string) ([]stockalert.Symbol, error)
	AddWatch(context.Context, string, string) (stockalert.WatchItem, error)
	AddWatchBySymbol(context.Context, string, stockalert.Symbol) (stockalert.WatchItem, error)
	ListWatch(context.Context, string) ([]stockalert.WatchItem, error)
	GetWatch(context.Context, string, string) (stockalert.WatchItem, error)
	UpdateWatch(context.Context, string, string, *bool, []string) (stockalert.WatchItem, error)
	DeleteWatch(context.Context, string, string) error
	Reanalyze(context.Context, string, string) (stockalert.WatchItem, error)
	Intraday(context.Context, string, string) (stockalert.IntradaySnapshot, error)
	ListReminders(context.Context, string, string) ([]stockalert.Reminder, error)
	CreateReminder(context.Context, string, string, stockalert.ReminderInput) (stockalert.Reminder, error)
	UpdateReminder(context.Context, string, string, stockalert.ReminderInput) (stockalert.Reminder, error)
	DeleteReminder(context.Context, string, string) error
	Events(context.Context, string, int) ([]stockalert.AlertEvent, int, error)
	MarkEventsRead(context.Context, string, []string) error
	GetSettings(context.Context, string) (stockalert.Settings, error)
	SaveSettings(context.Context, string, string, bool) (stockalert.Settings, error)
	TestPush(context.Context, string) (map[string]any, error)
}

func registerStockAlertRoutes(mux *http.ServeMux, api *Server) {
	if api.stockAlertService == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/stock-alert/search", api.withAuth(api.withAPIPipeline(api.handleStockAlertSearch)))
	mux.HandleFunc("POST /api/v1/stock-alert/watch", api.withAuth(api.withAPIPipeline(api.handleStockAlertAddWatch)))
	mux.HandleFunc("GET /api/v1/stock-alert/watch", api.withAuth(api.withAPIPipeline(api.handleStockAlertListWatch)))
	mux.HandleFunc("GET /api/v1/stock-alert/watch/{symbol}", api.withAuth(api.withAPIPipeline(api.handleStockAlertGetWatch)))
	mux.HandleFunc("PATCH /api/v1/stock-alert/watch/{symbol}", api.withAuth(api.withAPIPipeline(api.handleStockAlertUpdateWatch)))
	mux.HandleFunc("DELETE /api/v1/stock-alert/watch/{symbol}", api.withAuth(api.withAPIPipeline(api.handleStockAlertDeleteWatch)))
	mux.HandleFunc("POST /api/v1/stock-alert/watch/{symbol}/reanalyze", api.withAuth(api.withAPIPipeline(api.handleStockAlertReanalyze)))
	mux.HandleFunc("GET /api/v1/stock-alert/watch/{symbol}/intraday", api.withAuth(api.withAPIPipeline(api.handleStockAlertIntraday)))
	mux.HandleFunc("GET /api/v1/stock-alert/reminders", api.withAuth(api.withAPIPipeline(api.handleStockAlertListReminders)))
	mux.HandleFunc("POST /api/v1/stock-alert/reminders", api.withAuth(api.withAPIPipeline(api.handleStockAlertCreateReminder)))
	mux.HandleFunc("PATCH /api/v1/stock-alert/reminders/{id}", api.withAuth(api.withAPIPipeline(api.handleStockAlertUpdateReminder)))
	mux.HandleFunc("DELETE /api/v1/stock-alert/reminders/{id}", api.withAuth(api.withAPIPipeline(api.handleStockAlertDeleteReminder)))
	mux.HandleFunc("GET /api/v1/stock-alert/events", api.withAuth(api.withAPIPipeline(api.handleStockAlertEvents)))
	mux.HandleFunc("POST /api/v1/stock-alert/events/read", api.withAuth(api.withAPIPipeline(api.handleStockAlertMarkEventsRead)))
	mux.HandleFunc("GET /api/v1/stock-alert/settings", api.withAuth(api.withAPIPipeline(api.handleStockAlertGetSettings)))
	mux.HandleFunc("PUT /api/v1/stock-alert/settings", api.withAuth(api.withAPIPipeline(api.handleStockAlertSaveSettings)))
	mux.HandleFunc("POST /api/v1/stock-alert/settings/test-push", api.withAuth(api.withAPIPipeline(api.handleStockAlertTestPush)))
}

func (s *Server) handleStockAlertSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	symbols, err := s.stockAlertService.Search(r.Context(), query)
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stockalert.SearchResult{Symbols: symbols})
}

func (s *Server) handleStockAlertAddWatch(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input struct {
		Query  string             `json:"query"`
		Symbol *stockalert.Symbol `json:"symbol"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	var item stockalert.WatchItem
	var err error
	if input.Symbol != nil {
		item, err = s.stockAlertService.AddWatchBySymbol(r.Context(), account.ID, *input.Symbol)
	} else {
		item, err = s.stockAlertService.AddWatch(r.Context(), account.ID, input.Query)
	}
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleStockAlertListWatch(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	items, err := s.stockAlertService.ListWatch(r.Context(), account.ID)
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleStockAlertGetWatch(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	item, err := s.stockAlertService.GetWatch(r.Context(), account.ID, r.PathValue("symbol"))
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleStockAlertUpdateWatch(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input struct {
		Enabled       *bool    `json:"enabled"`
		ReminderTypes []string `json:"reminderTypes"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.stockAlertService.UpdateWatch(r.Context(), account.ID, r.PathValue("symbol"), input.Enabled, input.ReminderTypes)
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleStockAlertDeleteWatch(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	if err := s.stockAlertService.DeleteWatch(r.Context(), account.ID, r.PathValue("symbol")); err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleStockAlertReanalyze(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	item, err := s.stockAlertService.Reanalyze(r.Context(), account.ID, r.PathValue("symbol"))
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleStockAlertIntraday(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	snapshot, err := s.stockAlertService.Intraday(r.Context(), account.ID, r.PathValue("symbol"))
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleStockAlertListReminders(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	reminders, err := s.stockAlertService.ListReminders(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("symbol")))
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": reminders})
}

func (s *Server) handleStockAlertCreateReminder(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input struct {
		SymbolCode string                   `json:"symbolCode"`
		Reminder   stockalert.ReminderInput `json:"reminder"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	reminder, err := s.stockAlertService.CreateReminder(r.Context(), account.ID, input.SymbolCode, input.Reminder)
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, reminder)
}

func (s *Server) handleStockAlertUpdateReminder(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input stockalert.ReminderInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	reminder, err := s.stockAlertService.UpdateReminder(r.Context(), account.ID, r.PathValue("id"), input)
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, reminder)
}

func (s *Server) handleStockAlertDeleteReminder(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	if err := s.stockAlertService.DeleteReminder(r.Context(), account.ID, r.PathValue("id")); err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleStockAlertEvents(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	events, unread, err := s.stockAlertService.Events(r.Context(), account.ID, limit)
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events, "unread": unread})
}

func (s *Server) handleStockAlertMarkEventsRead(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input struct {
		EventIDs []string `json:"eventIds"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.stockAlertService.MarkEventsRead(r.Context(), account.ID, input.EventIDs); err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleStockAlertGetSettings(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	settings, err := s.stockAlertService.GetSettings(r.Context(), account.ID)
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleStockAlertSaveSettings(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	var input struct {
		SendKey         string `json:"sendKey"`
		ReminderEnabled bool   `json:"reminderEnabled"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	settings, err := s.stockAlertService.SaveSettings(r.Context(), account.ID, input.SendKey, input.ReminderEnabled)
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleStockAlertTestPush(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	result, err := s.stockAlertService.TestPush(r.Context(), account.ID)
	if err != nil {
		s.writeStockAlertError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) writeStockAlertError(w http.ResponseWriter, err error) {
	log.Printf("stock alert request failed: %v", err)
	code := "stock_alert_source_unavailable"
	status := http.StatusBadGateway
	switch {
	case errors.Is(err, stockalert.ErrNotFound):
		status, code = http.StatusNotFound, "stock_alert_not_found"
	case errors.Is(err, stockalert.ErrInvalidInput):
		status, code = http.StatusBadRequest, "stock_alert_invalid_input"
	case errors.Is(err, stockalert.ErrSourceInvalid):
		status, code = http.StatusBadGateway, "stock_alert_source_invalid"
	case errors.Is(err, stockalert.ErrInsufficientData):
		status, code = http.StatusUnprocessableEntity, "stock_alert_insufficient_data"
	case errors.Is(err, stockalert.ErrAnalysisUnavailable):
		status, code = http.StatusServiceUnavailable, "stock_alert_analysis_unavailable"
	case errors.Is(err, stockalert.ErrWatchLimitReached):
		status, code = http.StatusConflict, "stock_alert_watch_limit_reached"
	case errors.Is(err, stockalert.ErrAnalysisLimitReached):
		status, code = http.StatusTooManyRequests, "stock_alert_analysis_limit_reached"
	case errors.Is(err, stockalert.ErrSendKeyNotConfigured):
		status, code = http.StatusBadRequest, "stock_alert_sendkey_not_configured"
	}
	writeJSON(w, status, map[string]any{"error": code, "detail": err.Error()})
}
