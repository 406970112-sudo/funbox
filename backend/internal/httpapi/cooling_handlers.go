package httpapi

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/cooling"
)

func registerCoolingRoutes(mux *http.ServeMux, api *Server) {
	if api.coolingStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/cooling/home", api.withAuth(api.withAPIPipeline(api.handleCoolingHome)))
	mux.HandleFunc("GET /api/v1/cooling/items", api.withAuth(api.withAPIPipeline(api.handleCoolingItems)))
	mux.HandleFunc("POST /api/v1/cooling/items", api.withAuth(api.withAPIPipeline(api.handleCreateCoolingItem)))
	mux.HandleFunc("GET /api/v1/cooling/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleGetCoolingItem)))
	mux.HandleFunc("DELETE /api/v1/cooling/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleDeleteCoolingItem)))
	mux.HandleFunc("POST /api/v1/cooling/items/{itemID}/decision", api.withAuth(api.withAPIPipeline(api.handleCoolingDecision)))
	mux.HandleFunc("POST /api/v1/cooling/items/{itemID}/extend", api.withAuth(api.withAPIPipeline(api.handleCoolingExtend)))
	mux.HandleFunc("POST /api/v1/cooling/items/{itemID}/undo", api.withAuth(api.withAPIPipeline(api.handleCoolingUndo)))
	mux.HandleFunc("GET /api/v1/cooling/items/{itemID}/events", api.withAuth(api.withAPIPipeline(api.handleCoolingEvents)))
	mux.HandleFunc("GET /api/v1/cooling/items/{itemID}/evidence", api.withAuth(api.withAPIPipeline(api.handleCoolingEvidenceList)))
	mux.HandleFunc("POST /api/v1/cooling/items/{itemID}/evidence", api.withAuth(api.withCoolingUploadPipeline(api.handleCoolingEvidenceUpload)))
	mux.HandleFunc("GET /api/v1/cooling/stats", api.withAuth(api.withAPIPipeline(api.handleCoolingStats)))
	mux.HandleFunc("GET /api/v1/cooling/settings", api.withAuth(api.withAPIPipeline(api.handleGetCoolingSettings)))
	mux.HandleFunc("PUT /api/v1/cooling/settings", api.withAuth(api.withAPIPipeline(api.handleSaveCoolingSettings)))
	mux.HandleFunc("GET /api/v1/cooling/export", api.withAuth(api.withAPIPipeline(api.handleCoolingExport)))
	mux.HandleFunc("DELETE /api/v1/cooling/data", api.withAuth(api.withAPIPipeline(api.handleClearCoolingData)))
	mux.HandleFunc("GET /cooling-evidence/", api.withAuth(api.handleServeCoolingEvidence))
}

func (s *Server) withCoolingUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "cooling-upload") {
			return
		}
		maxBytes := s.cfg.Storage.MaxCoolingImageBytes
		maxImages := s.cfg.Storage.MaxCoolingImages
		if maxBytes <= 0 {
			maxBytes = 5 << 20
		}
		if maxImages <= 0 {
			maxImages = 3
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes*int64(maxImages)+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleCoolingHome(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	home, err := s.coolingStore.Home(r.Context(), account.ID)
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, home)
}

func (s *Server) handleCoolingItems(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	filter := cooling.RecordFilter{
		Status: strings.TrimSpace(r.URL.Query().Get("status")),
		Query:  strings.TrimSpace(r.URL.Query().Get("q")),
	}
	items, err := s.coolingStore.ListItems(r.Context(), account.ID, filter)
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateCoolingItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input cooling.ItemInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.coolingStore.CreateItem(r.Context(), account.ID, input)
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetCoolingItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.coolingStore.GetItem(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteCoolingItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.coolingStore.DeleteItem(r.Context(), account.ID, r.PathValue("itemID")); err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleCoolingDecision(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input cooling.DecisionInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.coolingStore.DecideItem(r.Context(), account.ID, r.PathValue("itemID"), input)
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleCoolingExtend(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.coolingStore.ExtendItem(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleCoolingUndo(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.coolingStore.UndoItem(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleCoolingEvents(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	events, err := s.coolingStore.ListEvents(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) handleCoolingEvidenceList(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.coolingStore.ListEvidence(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	for i := range items {
		items[i].FileURL = s.publicCoolingEvidenceURL(items[i].FileURL)
	}
	writeJSON(w, http.StatusOK, map[string]any{"evidence": items})
}

func (s *Server) handleCoolingEvidenceUpload(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_multipart"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing_file"})
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	allowed := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".heic": true}
	if !allowed[ext] {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unsupported_file_type"})
		return
	}
	if header.Size > s.cfg.Storage.MaxCoolingImageBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "file_too_large"})
		return
	}

	relativeDir := filepath.Join(account.ID, "evidence")
	dir := filepath.Join(s.cfg.Storage.CoolingDir, relativeDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.writeCoolingError(w, err)
		return
	}
	fileName := fmt.Sprintf("%d-%s%s", time.Now().UnixNano(), shortID(), ext)
	target := filepath.Join(dir, fileName)
	out, err := os.Create(target)
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	if _, err := io.Copy(out, file); err != nil {
		_ = out.Close()
		_ = os.Remove(target)
		s.writeCoolingError(w, err)
		return
	}
	_ = out.Close()

	relativeURL := "/cooling-evidence/" + relativeDir + "/" + fileName
	item, err := s.coolingStore.AddEvidence(r.Context(), account.ID, r.PathValue("itemID"), relativeURL, header.Filename, header.Size)
	if err != nil {
		_ = os.Remove(target)
		s.writeCoolingError(w, err)
		return
	}
	item.FileURL = s.publicCoolingEvidenceURL(item.FileURL)
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleServeCoolingEvidence(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	relative := strings.TrimPrefix(r.URL.Path, "/cooling-evidence/")
	parts := strings.SplitN(relative, "/", 2)
	if len(parts) != 2 || parts[0] != account.ID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	fileName := filepath.Base(parts[1])
	filePath := filepath.Join(s.cfg.Storage.CoolingDir, account.ID, "evidence", fileName)
	file, err := os.Open(filePath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "read_file_failed"})
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

func (s *Server) handleCoolingStats(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	stats, err := s.coolingStore.Stats(r.Context(), account.ID)
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleGetCoolingSettings(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	settings, err := s.coolingStore.GetSettings(r.Context(), account.ID)
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleSaveCoolingSettings(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input cooling.SettingsInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	settings, err := s.coolingStore.SaveSettings(r.Context(), account.ID, input)
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleCoolingExport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.coolingStore.ListItems(r.Context(), account.ID, cooling.RecordFilter{})
	if err != nil {
		s.writeCoolingError(w, err)
		return
	}
	format := strings.TrimSpace(r.URL.Query().Get("format"))
	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="impulse-cooler-export.csv"`)
		writer := csv.NewWriter(w)
		_ = writer.Write([]string{"name", "priceCents", "currency", "sourceType", "riskLevel", "status", "equivalentHours", "incomeRatioPercent", "createdAt", "coolEndsAt"})
		for _, item := range items {
			equivalent := ""
			if item.EquivalentHours != nil {
				equivalent = fmt.Sprintf("%.1f", *item.EquivalentHours)
			}
			income := ""
			if item.IncomeRatioPercent != nil {
				income = fmt.Sprintf("%.2f", *item.IncomeRatioPercent)
			}
			_ = writer.Write([]string{
				item.Name, fmt.Sprint(item.PriceCents), item.Currency, item.SourceType,
				item.RiskLevel, item.Status, equivalent, income,
				item.CreatedAt.Format(time.RFC3339), item.CoolEndsAt.Format(time.RFC3339),
			})
		}
		writer.Flush()
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="impulse-cooler-export.json"`)
	writeJSON(w, http.StatusOK, map[string]any{
		"exportedAt": time.Now().UTC().Format(time.RFC3339),
		"items":      items,
	})
}

func (s *Server) handleClearCoolingData(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.coolingStore.ClearData(r.Context(), account.ID); err != nil {
		s.writeCoolingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) publicCoolingEvidenceURL(relativeURL string) string {
	if strings.HasPrefix(relativeURL, "http://") || strings.HasPrefix(relativeURL, "https://") {
		return relativeURL
	}
	base := strings.TrimRight(s.cfg.Server.PublicBaseURL, "/")
	if base == "" {
		return relativeURL
	}
	return base + "/" + strings.TrimLeft(relativeURL, "/")
}

func (s *Server) writeCoolingError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, cooling.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "cooling_not_found"})
	case errors.Is(err, cooling.ErrInvalidInput):
		log.Printf("cooling invalid input: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cooling_invalid_input"})
	default:
		log.Printf("cooling request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cooling_request_failed"})
	}
}
