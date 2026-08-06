package httpapi

import (
	"errors"
	"log"
	"net/http"

	"my-first-expo-app/backend/internal/borrowledger"
)

func registerBorrowLedgerRoutes(mux *http.ServeMux, api *Server) {
	if api.borrowLedgerStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/borrow-ledger/state", api.withAuth(api.withAPIPipeline(api.handleBorrowLedgerState)))
	mux.HandleFunc("PUT /api/v1/borrow-ledger/state", api.withAuth(api.withAPIPipeline(api.handleSaveBorrowLedgerState)))
	mux.HandleFunc("DELETE /api/v1/borrow-ledger/state", api.withAuth(api.withAPIPipeline(api.handleClearBorrowLedgerState)))
}

func (s *Server) handleBorrowLedgerState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.borrowLedgerStore.GetState(r.Context(), account.ID)
	if err != nil {
		s.writeBorrowLedgerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleSaveBorrowLedgerState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var state borrowledger.State
	if err := decodeJSONBody(r, &state); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	saved, err := s.borrowLedgerStore.SaveState(r.Context(), account.ID, state)
	if err != nil {
		s.writeBorrowLedgerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleClearBorrowLedgerState(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.borrowLedgerStore.ClearState(r.Context(), account.ID)
	if err != nil {
		s.writeBorrowLedgerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "updatedAt": state.UpdatedAt})
}

func (s *Server) writeBorrowLedgerError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, borrowledger.ErrInvalidInput):
		log.Printf("borrow ledger invalid input: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "borrow_ledger_invalid_input"})
	case errors.Is(err, borrowledger.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "borrow_ledger_not_found"})
	default:
		log.Printf("borrow ledger error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}
