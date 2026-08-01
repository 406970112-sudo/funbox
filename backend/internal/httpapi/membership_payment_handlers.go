package httpapi

import (
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"my-first-expo-app/backend/internal/membership"
)

type membershipSettingsResponse struct {
	Enabled          bool   `json:"enabled"`
	QrURL            string `json:"qrUrl"`
	Note             string `json:"note"`
	VIPPriceCents    int    `json:"vipPriceCents"`
	SVIPPriceCents   int    `json:"svipPriceCents"`
	UpdatedByName    string `json:"updatedByName"`
	UpdatedByUsername string `json:"updatedByUsername"`
	UpdatedAt        string `json:"updatedAt"`
}

type membershipChangeResponse struct {
	ID                  string `json:"id"`
	Action              string `json:"action"`
	Detail              string `json:"detail"`
	OperatorDisplayName string `json:"operatorDisplayName"`
	OperatorUsername    string `json:"operatorUsername"`
	CreatedAt           string `json:"createdAt"`
}

func (s *Server) handleMembershipPaymentInfo(w http.ResponseWriter, r *http.Request) {
	if s.membershipService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "membership_service_unavailable"})
		return
	}
	info, err := s.membershipService.PublicPaymentInfo(r.Context())
	if err != nil {
		log.Printf("read membership payment info failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "membership_request_failed"})
		return
	}

	plans := make([]map[string]any, 0, len(info.Plans))
	for _, plan := range info.Plans {
		plans = append(plans, map[string]any{
			"tier":       plan.Tier,
			"priceCents": plan.PriceCents,
			"period":     plan.Period,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": info.Enabled,
		"qrUrl":   s.resolvePaymentQRURL(info.QRPath),
		"note":    info.Note,
		"plans":   plans,
	})
}

func (s *Server) handleAdminMembershipSettings(w http.ResponseWriter, r *http.Request) {
	if s.membershipService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "membership_service_unavailable"})
		return
	}
	settings, err := s.membershipService.Settings(r.Context())
	if err != nil {
		log.Printf("read membership settings failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "membership_request_failed"})
		return
	}
	page, err := s.membershipService.ListChanges(r.Context(), 20, 0)
	if err != nil {
		log.Printf("list membership changes failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "membership_request_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"changes": s.membershipChangesResponse(page.Changes),
		"limit":   page.Limit,
		"offset":  page.Offset,
		"settings": s.membershipSettingsResponse(settings),
		"total":   page.Total,
	})
}

func (s *Server) handleAdminUploadPaymentQR(w http.ResponseWriter, r *http.Request) {
	operator, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.membershipService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "membership_service_unavailable"})
		return
	}

	maxBytes := s.cfg.Storage.MaxPaymentQRBytes
	if maxBytes <= 0 {
		maxBytes = 2 << 20
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+(1<<20))
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_payment_qr_upload"})
		return
	}

	upload, _, err := r.FormFile("qr")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "payment_qr_required"})
		return
	}
	defer upload.Close()

	contents, err := io.ReadAll(io.LimitReader(upload, maxBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "payment_qr_read_failed"})
		return
	}

	settings, err := s.membershipService.UploadPaymentQR(r.Context(), operator.ID, contents)
	if err != nil {
		s.writeMembershipPaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": s.membershipSettingsResponse(settings)})
}

func (s *Server) handleAdminRemovePaymentQR(w http.ResponseWriter, r *http.Request) {
	operator, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.membershipService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "membership_service_unavailable"})
		return
	}
	settings, err := s.membershipService.RemovePaymentQR(r.Context(), operator.ID)
	if err != nil {
		log.Printf("remove payment qr failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "membership_request_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": s.membershipSettingsResponse(settings)})
}

func (s *Server) handleAdminUpdatePaymentNote(w http.ResponseWriter, r *http.Request) {
	operator, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.membershipService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "membership_service_unavailable"})
		return
	}

	var request struct {
		Note string `json:"note"`
	}
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	settings, err := s.membershipService.UpdatePaymentNote(r.Context(), operator.ID, request.Note)
	if err != nil {
		s.writeMembershipPaymentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": s.membershipSettingsResponse(settings)})
}

func (s *Server) handleServePaymentQR(w http.ResponseWriter, r *http.Request) {
	fileName := filepath.Base(strings.TrimPrefix(r.URL.Path, "/payment-qr/"))
	if fileName == "." || fileName == "" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}

	filePath := filepath.Join(s.cfg.Storage.PaymentQRDir, fileName)
	if _, err := os.Stat(filePath); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}

	w.Header().Set("Cache-Control", "public, max-age=300")
	http.ServeFile(w, r, filePath)
}

func (s *Server) withPaymentQRUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "payment-qr") {
			return
		}
		limit := s.cfg.Storage.MaxPaymentQRBytes
		if limit <= 0 {
			limit = 2 << 20
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) membershipSettingsResponse(settings membership.Settings) membershipSettingsResponse {
	qrURL := ""
	if settings.PaymentQRFile != "" {
		qrURL = s.resolvePaymentQRURL("/payment-qr/" + settings.PaymentQRFile)
	}
	updatedAt := ""
	if !settings.UpdatedAt.IsZero() {
		updatedAt = settings.UpdatedAt.Format("2006-01-02T15:04:05Z07:00")
	}
	return membershipSettingsResponse{
		Enabled:           settings.PaymentQRFile != "",
		QrURL:             qrURL,
		Note:              settings.PaymentNote,
		VIPPriceCents:     settings.VIPPriceCents,
		SVIPPriceCents:    settings.SVIPPriceCents,
		UpdatedByName:     settings.UpdatedByName,
		UpdatedByUsername: settings.UpdatedByUsername,
		UpdatedAt:         updatedAt,
	}
}

func (s *Server) membershipChangesResponse(changes []membership.Change) []membershipChangeResponse {
	result := make([]membershipChangeResponse, 0, len(changes))
	for _, change := range changes {
		result = append(result, membershipChangeResponse{
			ID:                  change.ID,
			Action:              change.Action,
			Detail:              change.Detail,
			OperatorDisplayName: change.OperatorDisplayName,
			OperatorUsername:    change.OperatorUsername,
			CreatedAt:           change.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	return result
}

func (s *Server) resolvePaymentQRURL(path string) string {
	if path == "" {
		return ""
	}
	if baseURL := strings.TrimRight(strings.TrimSpace(s.cfg.Server.PublicBaseURL), "/"); baseURL != "" {
		return baseURL + path
	}
	return path
}

func (s *Server) writeMembershipPaymentError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, membership.ErrImageTypeInvalid):
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "payment_qr_type_invalid"})
	case errors.Is(err, membership.ErrImageTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "payment_qr_too_large"})
	case errors.Is(err, membership.ErrNoteInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "payment_note_invalid"})
	default:
		log.Printf("membership payment request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "membership_request_failed"})
	}
}
