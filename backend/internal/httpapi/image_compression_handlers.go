package httpapi

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/imagecompression"
)

const imageUploadOverheadBytes = 1 << 20

type imageCompressionHandler struct {
	maxImageBytes int64
	service       *imagecompression.Service
}

func registerImageCompressionRoutes(mux *http.ServeMux, api *Server) {
	handler := newImageCompressionHandler(api.cfg.TinyPNG)
	mux.HandleFunc("GET /api/v1/image-compression/status", api.withAPIPipeline(handler.handleStatus))
	mux.HandleFunc(
		"POST /api/v1/image-compression/compress",
		api.withImageCompressionPipeline(handler.handleCompress),
	)
}

func newImageCompressionHandler(cfg config.TinyPNGConfig) *imageCompressionHandler {
	maxImageBytes := cfg.MaxImageBytes
	if maxImageBytes <= 0 {
		maxImageBytes = 5 << 20
	}

	var service *imagecompression.Service
	if strings.TrimSpace(cfg.APIKey) != "" {
		service = imagecompression.NewService(cfg.APIKey, cfg.BaseURL, cfg.RequestTimeout)
	}

	return &imageCompressionHandler{maxImageBytes: maxImageBytes, service: service}
}

func (s *Server) withImageCompressionPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}

		if !s.allowRateLimitedRequest(w, r, "image-compression") {
			return
		}

		maxBodyBytes := s.cfg.TinyPNG.MaxImageBytes + imageUploadOverheadBytes
		if maxBodyBytes <= imageUploadOverheadBytes {
			maxBodyBytes = (5 << 20) + imageUploadOverheadBytes
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		next.ServeHTTP(w, r)
	}
}

func (h *imageCompressionHandler) handleStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"available": h.service != nil,
		"provider":  "TinyPNG",
	})
}

func (h *imageCompressionHandler) handleCompress(w http.ResponseWriter, r *http.Request) {
	if h.service == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "image_compression_not_configured"})
		return
	}

	if err := r.ParseMultipartForm(h.maxImageBytes + imageUploadOverheadBytes); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) || strings.Contains(err.Error(), "request body too large") {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "image_too_large"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_multipart_form"})
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	file, header, err := r.FormFile("image")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "image_required"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, h.maxImageBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "image_read_failed"})
		return
	}
	if len(data) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "image_required"})
		return
	}
	if int64(len(data)) > h.maxImageBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "image_too_large"})
		return
	}

	contentType := http.DetectContentType(data)
	if !supportedImageType(contentType) {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "image_type_invalid"})
		return
	}

	mode := imagecompression.Mode(strings.TrimSpace(r.FormValue("mode")))
	if mode == "" {
		mode = imagecompression.ModeSmart
	}
	if mode != imagecompression.ModeSmart && mode != imagecompression.ModeQuality {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "compression_mode_invalid"})
		return
	}

	result, err := h.service.Compress(r.Context(), data, mode)
	if err != nil {
		handleImageCompressionError(w, err)
		return
	}

	fileName := filepath.Base(strings.TrimSpace(header.Filename))
	if fileName == "." || fileName == "" {
		fileName = "compressed-image" + extensionForContentType(result.ContentType)
	}
	compressedSize := int64(len(result.Data))
	ratio := float64(compressedSize) / float64(result.OriginalSize)

	w.Header().Set("Content-Type", result.ContentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", compressedSize))
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": fileName}))
	w.Header().Set("X-Original-Size", fmt.Sprintf("%d", result.OriginalSize))
	w.Header().Set("X-Compressed-Size", fmt.Sprintf("%d", compressedSize))
	w.Header().Set("X-Compression-Ratio", fmt.Sprintf("%.6f", ratio))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(result.Data)
}

func supportedImageType(contentType string) bool {
	switch contentType {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

func extensionForContentType(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".png"
	}
}

func handleImageCompressionError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, imagecompression.ErrAuthentication):
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "provider_auth_failed"})
	case errors.Is(err, imagecompression.ErrQuotaExceeded):
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "provider_quota_exceeded"})
	default:
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "image_compression_failed"})
	}
}
