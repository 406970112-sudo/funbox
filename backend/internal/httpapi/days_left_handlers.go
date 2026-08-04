package httpapi

import (
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/daysleft"
)

var daysLeftHostPattern = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$`)

func registerDaysLeftRoutes(mux *http.ServeMux, api *Server) {
	if api.daysLeftStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/days-left/summary", api.withAuth(api.withAPIPipeline(api.handleDaysLeftSummary)))
	mux.HandleFunc("GET /api/v1/days-left/records", api.withAuth(api.withAPIPipeline(api.handleDaysLeftRecords)))
	mux.HandleFunc("POST /api/v1/days-left/records", api.withAuth(api.withAPIPipeline(api.handleCreateDaysLeftRecord)))
	mux.HandleFunc("GET /api/v1/days-left/records/{recordID}", api.withAuth(api.withAPIPipeline(api.handleGetDaysLeftRecord)))
	mux.HandleFunc("PATCH /api/v1/days-left/records/{recordID}", api.withAuth(api.withAPIPipeline(api.handleUpdateDaysLeftRecord)))
	mux.HandleFunc("DELETE /api/v1/days-left/records/{recordID}", api.withAuth(api.withAPIPipeline(api.handleDeleteDaysLeftRecord)))
	mux.HandleFunc("POST /api/v1/days-left/records/{recordID}/renew", api.withAuth(api.withAPIPipeline(api.handleRenewDaysLeftRecord)))
	mux.HandleFunc("POST /api/v1/days-left/records/{recordID}/complete", api.withAuth(api.withAPIPipeline(api.handleCompleteDaysLeftRecord)))
	mux.HandleFunc("POST /api/v1/days-left/records/{recordID}/undo", api.withAuth(api.withAPIPipeline(api.handleUndoDaysLeftRecord)))
	mux.HandleFunc("GET /api/v1/days-left/records/{recordID}/events", api.withAuth(api.withAPIPipeline(api.handleDaysLeftEvents)))
	mux.HandleFunc("GET /api/v1/days-left/records/{recordID}/evidence", api.withAuth(api.withAPIPipeline(api.handleDaysLeftEvidenceList)))
	mux.HandleFunc("POST /api/v1/days-left/records/{recordID}/evidence", api.withAuth(api.withDaysLeftUploadPipeline(api.handleDaysLeftEvidenceUpload)))
	mux.HandleFunc("GET /api/v1/days-left/categories", api.withAuth(api.withAPIPipeline(api.handleDaysLeftCategories)))
	mux.HandleFunc("POST /api/v1/days-left/categories", api.withAuth(api.withAPIPipeline(api.handleCreateDaysLeftCategory)))
	mux.HandleFunc("PATCH /api/v1/days-left/categories/{categoryID}", api.withAuth(api.withAPIPipeline(api.handleUpdateDaysLeftCategory)))
	mux.HandleFunc("DELETE /api/v1/days-left/categories/{categoryID}", api.withAuth(api.withAPIPipeline(api.handleDeleteDaysLeftCategory)))
	mux.HandleFunc("GET /api/v1/days-left/calendar", api.withAuth(api.withAPIPipeline(api.handleDaysLeftCalendar)))
	mux.HandleFunc("GET /api/v1/days-left/stats", api.withAuth(api.withAPIPipeline(api.handleDaysLeftStats)))
	mux.HandleFunc("GET /api/v1/days-left/reminders", api.withAuth(api.withAPIPipeline(api.handleDaysLeftReminders)))
	mux.HandleFunc("POST /api/v1/days-left/reminders/{reminderID}/dismiss", api.withAuth(api.withAPIPipeline(api.handleDismissDaysLeftReminder)))
	mux.HandleFunc("GET /api/v1/days-left/export", api.withAuth(api.withAPIPipeline(api.handleDaysLeftExport)))
	mux.HandleFunc("POST /api/v1/days-left/import", api.withAuth(api.withAPIPipeline(api.handleDaysLeftImport)))
	mux.HandleFunc("GET /api/v1/days-left/verify/ssl", api.withAuth(api.withAPIPipeline(api.handleDaysLeftVerifySSL)))
	mux.HandleFunc("GET /days-left-evidence/", api.withAuth(api.handleServeDaysLeftEvidence))
}

func (s *Server) withDaysLeftUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "days-left-upload") {
			return
		}
		maxBytes := s.cfg.Storage.MaxDaysLeftImageBytes
		maxImages := s.cfg.Storage.MaxDaysLeftImages
		if maxBytes <= 0 {
			maxBytes = 5 << 20
		}
		if maxImages <= 0 {
			maxImages = 5
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes*int64(maxImages)+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleDaysLeftSummary(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if _, err := s.daysLeftStore.EnsureDefaultCategories(r.Context(), account.ID); err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	summary, err := s.daysLeftStore.Summary(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("date")))
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleDaysLeftRecords(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	filter := daysleft.RecordFilter{
		CategoryID: strings.TrimSpace(r.URL.Query().Get("category")),
		Status:     strings.TrimSpace(r.URL.Query().Get("status")),
		Query:      strings.TrimSpace(r.URL.Query().Get("q")),
		Sort:       strings.TrimSpace(r.URL.Query().Get("sort")),
		Today:      strings.TrimSpace(r.URL.Query().Get("date")),
	}
	records, err := s.daysLeftStore.ListRecords(r.Context(), account.ID, filter)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"records": records})
}

func (s *Server) handleCreateDaysLeftRecord(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input daysleft.RecordInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	record, err := s.daysLeftStore.CreateRecord(r.Context(), account.ID, input)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, record)
}

func (s *Server) handleGetDaysLeftRecord(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	record, err := s.daysLeftStore.GetRecord(r.Context(), account.ID, r.PathValue("recordID"))
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (s *Server) handleUpdateDaysLeftRecord(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input daysleft.RecordInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	record, err := s.daysLeftStore.UpdateRecord(r.Context(), account.ID, r.PathValue("recordID"), input)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (s *Server) handleDeleteDaysLeftRecord(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.daysLeftStore.DeleteRecord(r.Context(), account.ID, r.PathValue("recordID")); err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleRenewDaysLeftRecord(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input daysleft.RenewInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	record, err := s.daysLeftStore.RenewRecord(r.Context(), account.ID, r.PathValue("recordID"), input)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (s *Server) handleCompleteDaysLeftRecord(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input daysleft.CompleteInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	record, err := s.daysLeftStore.CompleteRecord(r.Context(), account.ID, r.PathValue("recordID"), input)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (s *Server) handleUndoDaysLeftRecord(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	record, err := s.daysLeftStore.UndoRecord(r.Context(), account.ID, r.PathValue("recordID"))
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, record)
}

func (s *Server) handleDaysLeftEvents(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	events, err := s.daysLeftStore.ListEvents(r.Context(), account.ID, r.PathValue("recordID"))
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) handleDaysLeftEvidenceList(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.daysLeftStore.ListEvidence(r.Context(), account.ID, r.PathValue("recordID"))
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	for i := range items {
		items[i].FileURL = s.publicDaysLeftEvidenceURL(items[i].FileURL)
	}
	writeJSON(w, http.StatusOK, map[string]any{"evidence": items})
}

func (s *Server) handleDaysLeftEvidenceUpload(w http.ResponseWriter, r *http.Request) {
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
	if header.Size > s.cfg.Storage.MaxDaysLeftImageBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "file_too_large"})
		return
	}

	relativeDir := filepath.Join(account.ID, "evidence")
	dir := filepath.Join(s.cfg.Storage.DaysLeftDir, relativeDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	fileName := fmt.Sprintf("%d-%s%s", time.Now().UnixNano(), shortID(), ext)
	target := filepath.Join(dir, fileName)
	out, err := os.Create(target)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	if _, err := io.Copy(out, file); err != nil {
		_ = out.Close()
		_ = os.Remove(target)
		s.writeDaysLeftError(w, err)
		return
	}
	_ = out.Close()

	relativeURL := "/days-left-evidence/" + relativeDir + "/" + fileName
	kind := strings.TrimSpace(r.FormValue("kind"))
	item, err := s.daysLeftStore.AddEvidence(r.Context(), account.ID, r.PathValue("recordID"), relativeURL, kind)
	if err != nil {
		_ = os.Remove(target)
		s.writeDaysLeftError(w, err)
		return
	}
	item.FileURL = s.publicDaysLeftEvidenceURL(item.FileURL)
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleServeDaysLeftEvidence(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	relative := strings.TrimPrefix(r.URL.Path, "/days-left-evidence/")
	parts := strings.SplitN(relative, "/", 2)
	if len(parts) != 2 || parts[0] != account.ID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	fileName := filepath.Base(parts[1])
	filePath := filepath.Join(s.cfg.Storage.DaysLeftDir, account.ID, "evidence", fileName)
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

func (s *Server) handleDaysLeftCategories(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.daysLeftStore.EnsureDefaultCategories(r.Context(), account.ID)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": items})
}

func (s *Server) handleCreateDaysLeftCategory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input daysleft.CategoryInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.daysLeftStore.CreateCategory(r.Context(), account.ID, input)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleUpdateDaysLeftCategory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input daysleft.CategoryInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.daysLeftStore.UpdateCategory(r.Context(), account.ID, r.PathValue("categoryID"), input)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteDaysLeftCategory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.daysLeftStore.DeleteCategory(r.Context(), account.ID, r.PathValue("categoryID")); err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleDaysLeftCalendar(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	snapshot, err := s.daysLeftStore.Calendar(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("month")))
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleDaysLeftStats(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	rangeID := strings.TrimSpace(r.URL.Query().Get("range"))
	if rangeID == "" {
		rangeID = "month"
	}
	stats, err := s.daysLeftStore.Stats(r.Context(), account.ID, rangeID)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleDaysLeftReminders(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.daysLeftStore.ListReminders(r.Context(), account.ID)
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reminders": items})
}

func (s *Server) handleDismissDaysLeftReminder(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.daysLeftStore.DismissReminder(r.Context(), account.ID, r.PathValue("reminderID")); err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleDaysLeftExport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	records, err := s.daysLeftStore.ListRecords(r.Context(), account.ID, daysleft.RecordFilter{})
	if err != nil {
		s.writeDaysLeftError(w, err)
		return
	}
	format := strings.TrimSpace(r.URL.Query().Get("format"))
	if format == "csv" {
		var builder strings.Builder
		builder.WriteString("name,category,recordType,startDate,expiryDate,validityValue,validityUnit,cycleUnit,cycleInterval,reminderLeadDays,note,status,source,verified,createdAt\n")
		for _, record := range records {
			fields := []string{
				csvField(record.Name), csvField(record.CategoryName), record.RecordType,
				record.StartDate, record.ExpiryDate, fmt.Sprint(record.ValidityValue),
				record.ValidityUnit, record.CycleUnit, fmt.Sprint(record.CycleInterval),
				fmt.Sprint(record.ReminderLeadDays), csvField(record.Note), record.Status,
				record.Source, fmt.Sprint(record.Verified), record.CreatedAt.Format(time.RFC3339),
			}
			builder.WriteString(strings.Join(fields, ","))
			builder.WriteString("\n")
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="days-left-export.csv"`)
		_, _ = w.Write([]byte(builder.String()))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="days-left-export.json"`)
	writeJSON(w, http.StatusOK, map[string]any{"exportedAt": time.Now().UTC().Format(time.RFC3339), "records": records})
}

func (s *Server) handleDaysLeftImport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var inputs []daysleft.RecordInput
	if err := decodeJSONBody(r, &inputs); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if len(inputs) == 0 || len(inputs) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_import_count"})
		return
	}
	created := 0
	for _, input := range inputs {
		if _, err := s.daysLeftStore.CreateRecord(r.Context(), account.ID, input); err != nil {
			s.writeDaysLeftError(w, err)
			return
		}
		created++
	}
	writeJSON(w, http.StatusCreated, map[string]any{"created": created})
}

func (s *Server) handleDaysLeftVerifySSL(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	host := strings.TrimSpace(r.URL.Query().Get("host"))
	if !daysLeftHostPattern.MatchString(host) || strings.Contains(host, "://") {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_host"})
		return
	}
	result, err := verifySSLCertificate(host)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "ssl_verify_failed", "detail": err.Error()})
		return
	}
	result.UserID = account.ID
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) writeDaysLeftError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, daysleft.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "days_left_not_found"})
	case errors.Is(err, daysleft.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "days_left_invalid_input"})
	default:
		log.Printf("days left request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "days_left_request_failed"})
	}
}

type sslVerifyResult struct {
	UserID    string   `json:"userId"`
	Host      string   `json:"host"`
	ExpiresAt string   `json:"expiresAt"`
	Issuer    string   `json:"issuer"`
	DNSNames  []string `json:"dnsNames"`
	Verified  bool     `json:"verified"`
	CheckedAt string   `json:"checkedAt"`
}

func verifySSLCertificate(host string) (sslVerifyResult, error) {
	dialer := &net.Dialer{Timeout: 8 * time.Second}
	config := &tls.Config{
		ServerName: host,
		MinVersion: tls.VersionTLS12,
	}
	conn, err := tls.DialWithDialer(dialer, "tcp", net.JoinHostPort(host, "443"), config)
	if err != nil {
		return sslVerifyResult{}, err
	}
	defer conn.Close()
	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return sslVerifyResult{}, errors.New("no peer certificate")
	}
	cert := state.PeerCertificates[0]
	issuer := ""
	if cert.Issuer.CommonName != "" {
		issuer = cert.Issuer.CommonName
	} else {
		issuer = cert.Issuer.Organization[0]
	}
	return sslVerifyResult{
		Host:      host,
		ExpiresAt: cert.NotAfter.Format(time.RFC3339),
		Issuer:    issuer,
		DNSNames:  cert.DNSNames,
		Verified:  true,
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (s *Server) publicDaysLeftEvidenceURL(relativeURL string) string {
	if strings.HasPrefix(relativeURL, "http") {
		return relativeURL
	}
	if baseURL := strings.TrimRight(s.cfg.Server.PublicBaseURL, "/"); baseURL != "" {
		return baseURL + relativeURL
	}
	return relativeURL
}

func shortID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano()%100000000)
}

func csvField(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}
