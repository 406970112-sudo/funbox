package httpapi

import (
	"errors"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/priceradar"
	"my-first-expo-app/backend/internal/user"
)

const priceRadarFormOverhead = 1 << 20

func registerPriceRadarRoutes(mux *http.ServeMux, api *Server) {
	if api.priceRadarService == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/price-radar/search", api.withRateLimitedAPIPipeline("price-radar", api.handlePriceRadarSearch))
	mux.HandleFunc("GET /api/v1/price-radar/products/{productID}", api.withRateLimitedAPIPipeline("price-radar", api.handlePriceRadarProduct))
	mux.HandleFunc("GET /api/v1/price-radar/products/{productID}/reports", api.withRateLimitedAPIPipeline("price-radar", api.handlePriceRadarReports))
	mux.HandleFunc("GET /api/v1/price-radar/reports/{reportID}/discussions", api.withRateLimitedAPIPipeline("price-radar", api.handlePriceRadarDiscussions))
	mux.HandleFunc("POST /api/v1/price-radar/reports", api.withAuth(api.withPriceRadarUploadPipeline(api.handleCreatePriceRadarReport)))
	mux.HandleFunc("POST /api/v1/price-radar/reports/{reportID}/comments", api.withAuth(api.withRateLimitedAPIPipeline("price-radar", api.handleCreatePriceRadarComment)))
	mux.HandleFunc("POST /api/v1/price-radar/reports/{reportID}/objections", api.withAuth(api.withPriceRadarUploadPipeline(api.handleCreatePriceRadarObjection)))
	mux.HandleFunc("GET /api/v1/price-radar/evidence/{reportID}/{evidenceID}", api.handlePriceRadarEvidence)
	mux.HandleFunc("GET /api/v1/price-radar/objection-evidence/{evidenceID}", api.handlePriceRadarObjectionEvidence)
	mux.HandleFunc("GET /api/v1/price-radar/my-contributions", api.withAuth(api.withRateLimitedAPIPipeline("price-radar", api.handlePriceRadarMyContributions)))
	mux.HandleFunc("GET /api/v1/price-radar/sources", api.withRateLimitedAPIPipeline("price-radar", api.handlePriceRadarSources))
	mux.HandleFunc("GET /api/v1/admin/price-reviews", api.withAuth(api.withAdmin(api.withRateLimitedAPIPipeline("price-radar", api.handleAdminPriceReviews))))
	mux.HandleFunc("POST /api/v1/admin/price-reviews/{reportID}/decision", api.withAuth(api.withAdmin(api.withRateLimitedAPIPipeline("price-radar", api.handleAdminPriceReviewDecision))))
	mux.HandleFunc("POST /api/v1/admin/objections/{objectionID}/decision", api.withAuth(api.withAdmin(api.withRateLimitedAPIPipeline("price-radar", api.handleAdminObjectionDecision))))
}

func (s *Server) withPriceRadarUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "price-radar-upload") {
			return
		}
		maxBytes := s.cfg.PriceRadar.MaxImageBytes * int64(s.cfg.PriceRadar.MaxImages)
		if maxBytes <= 0 {
			maxBytes = 15 << 20
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes+priceRadarFormOverhead)
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handlePriceRadarSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	provinceCode := strings.TrimSpace(r.URL.Query().Get("provinceCode"))
	result, err := s.priceRadarService.Search(r.Context(), query, provinceCode)
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handlePriceRadarProduct(w http.ResponseWriter, r *http.Request) {
	productID := strings.TrimSpace(r.PathValue("productID"))
	provinceCode := strings.TrimSpace(r.URL.Query().Get("provinceCode"))
	result, err := s.priceRadarService.ProductDetail(r.Context(), productID, provinceCode)
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handlePriceRadarReports(w http.ResponseWriter, r *http.Request) {
	productID := strings.TrimSpace(r.PathValue("productID"))
	includePending := r.URL.Query().Get("includePending") == "1"
	limit, offset := parsePriceRadarPage(r)
	result, err := s.priceRadarService.Reports(r.Context(), productID, includePending, limit, offset)
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handlePriceRadarDiscussions(w http.ResponseWriter, r *http.Request) {
	reportID := strings.TrimSpace(r.PathValue("reportID"))
	result, err := s.priceRadarService.Discussions(r.Context(), reportID)
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleCreatePriceRadarReport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	maxBytes := s.cfg.PriceRadar.MaxImageBytes
	if maxBytes <= 0 {
		maxBytes = 5 << 20
	}
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_price_radar_upload"})
		return
	}
	fileHeaders := r.MultipartForm.File["images"]
	uploads := make([]priceradar.Upload, 0, len(fileHeaders))
	files := make([]multipart.File, 0, len(fileHeaders))
	for _, header := range fileHeaders {
		file, err := header.Open()
		if err != nil {
			closePriceRadarFiles(files)
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "price_radar_image_read_failed"})
			return
		}
		files = append(files, file)
		uploads = append(uploads, priceradar.Upload{Reader: file})
	}
	input := priceradar.CreateReportInput{
		ProductID:    strings.TrimSpace(r.FormValue("productId")),
		ProductName:  strings.TrimSpace(r.FormValue("productName")),
		StoreName:    strings.TrimSpace(r.FormValue("storeName")),
		StoreType:    strings.TrimSpace(r.FormValue("storeType")),
		Address:      strings.TrimSpace(r.FormValue("address")),
		Unit:         strings.TrimSpace(r.FormValue("unit")),
		PurchaseDate: strings.TrimSpace(r.FormValue("purchaseDate")),
	}
	input.Price, _ = strconv.ParseFloat(strings.TrimSpace(r.FormValue("price")), 64)
	input.Latitude, _ = strconv.ParseFloat(strings.TrimSpace(r.FormValue("latitude")), 64)
	input.Longitude, _ = strconv.ParseFloat(strings.TrimSpace(r.FormValue("longitude")), 64)
	created, err := s.priceRadarService.CreateReport(r.Context(), account.ID, input, uploads)
	closePriceRadarFiles(files)
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleCreatePriceRadarComment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input struct {
		Body string `json:"body"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	comment, err := s.priceRadarService.CreateComment(r.Context(), account.ID, priceradar.CreateCommentInput{
		ReportID: strings.TrimSpace(r.PathValue("reportID")),
		Body:     input.Body,
	})
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	comment.User = priceRadarUserSummary(account)
	writeJSON(w, http.StatusCreated, comment)
}

func (s *Server) handleCreatePriceRadarObjection(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	maxBytes := s.cfg.PriceRadar.MaxImageBytes
	if maxBytes <= 0 {
		maxBytes = 5 << 20
	}
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_price_radar_upload"})
		return
	}
	fileHeaders := r.MultipartForm.File["images"]
	uploads := make([]priceradar.Upload, 0, len(fileHeaders))
	files := make([]multipart.File, 0, len(fileHeaders))
	for _, header := range fileHeaders {
		file, err := header.Open()
		if err != nil {
			closePriceRadarFiles(files)
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "price_radar_image_read_failed"})
			return
		}
		files = append(files, file)
		uploads = append(uploads, priceradar.Upload{Reader: file})
	}
	objection, err := s.priceRadarService.CreateObjection(r.Context(), account.ID, priceradar.CreateObjectionInput{
		ReportID: strings.TrimSpace(r.PathValue("reportID")),
		Reason:   strings.TrimSpace(r.FormValue("reason")),
		Body:     strings.TrimSpace(r.FormValue("body")),
		Images:   uploads,
	})
	closePriceRadarFiles(files)
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	objection.User = priceRadarUserSummary(account)
	writeJSON(w, http.StatusCreated, objection)
}

func (s *Server) handlePriceRadarEvidence(w http.ResponseWriter, r *http.Request) {
	reportID := strings.TrimSpace(r.PathValue("reportID"))
	evidenceID := strings.TrimSpace(r.PathValue("evidenceID"))
	image, filePath, err := s.priceRadarService.GetEvidence(r.Context(), reportID, evidenceID)
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	servePriceRadarEvidence(w, r, filePath, image.ContentType)
}

func (s *Server) handlePriceRadarObjectionEvidence(w http.ResponseWriter, r *http.Request) {
	evidenceID := strings.TrimSpace(r.PathValue("evidenceID"))
	image, filePath, err := s.priceRadarService.GetObjectionEvidence(r.Context(), evidenceID)
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	servePriceRadarEvidence(w, r, filePath, image.ContentType)
}

func (s *Server) handlePriceRadarMyContributions(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	result, err := s.priceRadarService.MyContributions(r.Context(), account.ID)
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handlePriceRadarSources(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sources": s.priceRadarService.Sources(r.Context())})
}

func (s *Server) handleAdminPriceReviews(w http.ResponseWriter, r *http.Request) {
	result, err := s.priceRadarService.AdminPending(r.Context())
	if err != nil {
		writePriceRadarError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAdminPriceReviewDecision(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input struct {
		Action string `json:"action"`
		Note   string `json:"note"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.priceRadarService.AdminDecideReport(
		r.Context(),
		strings.TrimSpace(r.PathValue("reportID")),
		input.Action,
		account.ID,
		input.Note,
	); err != nil {
		writePriceRadarError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleAdminObjectionDecision(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input struct {
		Action     string `json:"action"`
		Resolution string `json:"resolution"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.priceRadarService.AdminDecideObjection(
		r.Context(),
		strings.TrimSpace(r.PathValue("objectionID")),
		input.Action,
		account.ID,
		input.Resolution,
	); err != nil {
		writePriceRadarError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func writePriceRadarError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, priceradar.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "price_radar_invalid_input"})
	case errors.Is(err, priceradar.ErrProductNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "price_radar_product_not_found"})
	case errors.Is(err, priceradar.ErrReportNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "price_radar_report_not_found"})
	case errors.Is(err, priceradar.ErrImagesTooMany):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "price_radar_images_too_many"})
	case errors.Is(err, priceradar.ErrImageTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "price_radar_image_too_large"})
	case errors.Is(err, priceradar.ErrImageTypeInvalid):
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "price_radar_image_type_invalid"})
	case errors.Is(err, priceradar.ErrSourceInvalid):
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "price_radar_source_invalid"})
	default:
		log.Printf("price radar request failed: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "price_radar_source_unavailable"})
	}
}

func parsePriceRadarPage(r *http.Request) (int, int) {
	limit := 30
	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value > 0 {
			limit = value
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		if value, err := strconv.Atoi(raw); err == nil && value >= 0 {
			offset = value
		}
	}
	if limit > 100 {
		limit = 100
	}
	return limit, offset
}

func closePriceRadarFiles(files []multipart.File) {
	for _, file := range files {
		_ = file.Close()
	}
}

func servePriceRadarEvidence(w http.ResponseWriter, r *http.Request, filePath, contentType string) {
	file, err := os.Open(filePath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "price_radar_evidence_not_found"})
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "read_price_radar_evidence_failed"})
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Type", contentType)
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

func priceRadarUserSummary(account user.User) priceradar.UserSummary {
	return priceradar.UserSummary{
		ID:          account.ID,
		Username:    account.Username,
		DisplayName: account.DisplayName,
	}
}
