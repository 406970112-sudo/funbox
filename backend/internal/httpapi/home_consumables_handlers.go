package httpapi

import (
	"encoding/csv"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/homeconsumables"
)

func registerHomeConsumablesRoutes(mux *http.ServeMux, api *Server) {
	if api.homeConsumablesStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/home-consumables/summary", api.withAuth(api.withAPIPipeline(api.handleHomeConsumablesSummary)))
	mux.HandleFunc("GET /api/v1/home-consumables/items", api.withAuth(api.withAPIPipeline(api.handleHomeConsumablesItems)))
	mux.HandleFunc("POST /api/v1/home-consumables/items", api.withAuth(api.withAPIPipeline(api.handleCreateHomeConsumablesItem)))
	mux.HandleFunc("GET /api/v1/home-consumables/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleGetHomeConsumablesItem)))
	mux.HandleFunc("PATCH /api/v1/home-consumables/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleUpdateHomeConsumablesItem)))
	mux.HandleFunc("DELETE /api/v1/home-consumables/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleDeleteHomeConsumablesItem)))
	mux.HandleFunc("GET /api/v1/home-consumables/items/{itemID}/events", api.withAuth(api.withAPIPipeline(api.handleHomeConsumablesItemEvents)))
	mux.HandleFunc("GET /api/v1/home-consumables/events", api.withAuth(api.withAPIPipeline(api.handleHomeConsumablesEvents)))
	mux.HandleFunc("POST /api/v1/home-consumables/items/{itemID}/events", api.withAuth(api.withAPIPipeline(api.handleCreateHomeConsumablesEvent)))
	mux.HandleFunc("POST /api/v1/home-consumables/events/{eventID}/undo", api.withAuth(api.withAPIPipeline(api.handleUndoHomeConsumablesEvent)))
	mux.HandleFunc("GET /api/v1/home-consumables/shopping-list", api.withAuth(api.withAPIPipeline(api.handleHomeConsumablesShoppingList)))
	mux.HandleFunc("GET /api/v1/home-consumables/categories", api.withAuth(api.withAPIPipeline(api.handleHomeConsumablesCategories)))
	mux.HandleFunc("POST /api/v1/home-consumables/categories", api.withAuth(api.withAPIPipeline(api.handleCreateHomeConsumablesCategory)))
	mux.HandleFunc("PATCH /api/v1/home-consumables/categories/{categoryID}", api.withAuth(api.withAPIPipeline(api.handleUpdateHomeConsumablesCategory)))
	mux.HandleFunc("DELETE /api/v1/home-consumables/categories/{categoryID}", api.withAuth(api.withAPIPipeline(api.handleDeleteHomeConsumablesCategory)))
	mux.HandleFunc("GET /api/v1/home-consumables/stats", api.withAuth(api.withAPIPipeline(api.handleHomeConsumablesStats)))
	mux.HandleFunc("GET /api/v1/home-consumables/reminders", api.withAuth(api.withAPIPipeline(api.handleHomeConsumablesReminders)))
	mux.HandleFunc("POST /api/v1/home-consumables/reminders/{reminderID}/dismiss", api.withAuth(api.withAPIPipeline(api.handleDismissHomeConsumablesReminder)))
	mux.HandleFunc("GET /api/v1/home-consumables/export", api.withAuth(api.withAPIPipeline(api.handleHomeConsumablesExport)))
	mux.HandleFunc("POST /api/v1/home-consumables/import", api.withAuth(api.withAPIPipeline(api.handleHomeConsumablesImport)))
}

func (s *Server) handleHomeConsumablesSummary(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if _, err := s.homeConsumablesStore.EnsureDefaultCategories(r.Context(), account.ID); err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	summary, err := s.homeConsumablesStore.Summary(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("date")))
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleHomeConsumablesItems(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	filter := homeconsumables.ItemFilter{
		CategoryID: strings.TrimSpace(r.URL.Query().Get("category")),
		State:      strings.TrimSpace(r.URL.Query().Get("state")),
		Query:      strings.TrimSpace(r.URL.Query().Get("q")),
		Sort:       strings.TrimSpace(r.URL.Query().Get("sort")),
	}
	items, err := s.homeConsumablesStore.ListItems(r.Context(), account.ID, filter)
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateHomeConsumablesItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input homeconsumables.ItemInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.homeConsumablesStore.CreateItem(r.Context(), account.ID, input)
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetHomeConsumablesItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.homeConsumablesStore.GetItem(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUpdateHomeConsumablesItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input homeconsumables.ItemInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.homeConsumablesStore.UpdateItem(r.Context(), account.ID, r.PathValue("itemID"), input)
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteHomeConsumablesItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.homeConsumablesStore.DeleteItem(r.Context(), account.ID, r.PathValue("itemID")); err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleHomeConsumablesItemEvents(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	events, err := s.homeConsumablesStore.ListEvents(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) handleHomeConsumablesEvents(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	events, err := s.homeConsumablesStore.ListEvents(r.Context(), account.ID, "")
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) handleCreateHomeConsumablesEvent(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input homeconsumables.EventInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.homeConsumablesStore.CreateEvent(r.Context(), account.ID, r.PathValue("itemID"), input)
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUndoHomeConsumablesEvent(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.homeConsumablesStore.UndoEvent(r.Context(), account.ID, r.PathValue("eventID"))
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleHomeConsumablesShoppingList(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	list, err := s.homeConsumablesStore.ShoppingList(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("date")))
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleHomeConsumablesCategories(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.homeConsumablesStore.EnsureDefaultCategories(r.Context(), account.ID)
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": items})
}

func (s *Server) handleCreateHomeConsumablesCategory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input homeconsumables.CategoryInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.homeConsumablesStore.CreateCategory(r.Context(), account.ID, input)
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateHomeConsumablesCategory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input homeconsumables.CategoryInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.homeConsumablesStore.UpdateCategory(r.Context(), account.ID, r.PathValue("categoryID"), input)
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteHomeConsumablesCategory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.homeConsumablesStore.DeleteCategory(r.Context(), account.ID, r.PathValue("categoryID")); err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleHomeConsumablesStats(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	stats, err := s.homeConsumablesStore.Stats(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("range")))
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleHomeConsumablesReminders(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.homeConsumablesStore.ListReminders(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("date")))
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reminders": items})
}

func (s *Server) handleDismissHomeConsumablesReminder(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.homeConsumablesStore.DismissReminder(
		r.Context(),
		account.ID,
		r.PathValue("reminderID"),
		strings.TrimSpace(r.URL.Query().Get("date")),
	); err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleHomeConsumablesExport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	backup, err := s.homeConsumablesStore.ExportData(r.Context(), account.ID)
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	format := strings.TrimSpace(r.URL.Query().Get("format"))
	if format == "csv" {
		var builder strings.Builder
		csvWriter := csv.NewWriter(&builder)
		_ = csvWriter.Write([]string{
			"kind", "id", "itemId", "categoryName", "name", "unit",
			"currentStock", "eventType", "quantity", "stockBefore",
			"stockAfter", "occurredAt", "remindDays", "note", "source",
		})
		for _, item := range backup.Items {
			_ = csvWriter.Write([]string{
				"item", item.ID, "", item.CategoryName, item.Name, item.Unit,
				nullableFloatString(item.CurrentStock), "", "", "", "",
				item.CreatedAt.Format(time.RFC3339), fmt.Sprint(item.RemindDays),
				item.Note, item.Source,
			})
		}
		for _, event := range backup.Events {
			_ = csvWriter.Write([]string{
				"event", event.ID, event.ItemID, "", "", "",
				"", event.EventType, fmt.Sprint(event.Quantity),
				nullableFloatString(event.StockBefore), nullableFloatString(event.StockAfter),
				event.OccurredAt.Format(time.RFC3339), "", event.Note, event.Source,
			})
		}
		csvWriter.Flush()
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="home-consumables-export.csv"`)
		_, _ = w.Write([]byte(builder.String()))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="home-consumables-export.json"`)
	writeJSON(w, http.StatusOK, backup)
}

func (s *Server) handleHomeConsumablesImport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var payload homeconsumables.ImportPayload
	if err := decodeJSONBody(r, &payload); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	created, err := s.homeConsumablesStore.ImportData(r.Context(), account.ID, payload)
	if err != nil {
		s.writeHomeConsumablesError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"created": created})
}

func (s *Server) writeHomeConsumablesError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, homeconsumables.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "home_consumables_not_found"})
	case errors.Is(err, homeconsumables.ErrInsufficientStock):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "home_consumables_insufficient_stock"})
	case errors.Is(err, homeconsumables.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "home_consumables_invalid_input"})
	default:
		log.Printf("home consumables request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "home_consumables_request_failed"})
	}
}

func nullableFloatString(value *float64) string {
	if value == nil {
		return ""
	}
	return fmt.Sprint(*value)
}
