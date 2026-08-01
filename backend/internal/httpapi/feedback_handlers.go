package httpapi

import (
	"errors"
	"fmt"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/feedback"
)

func registerFeedbackRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("POST /api/v1/feedback", api.withAuth(api.withFeedbackUploadPipeline(api.handleCreateFeedback)))
	mux.HandleFunc("GET /api/v1/admin/feedback", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleListFeedback))))
	mux.HandleFunc(
		"GET /api/v1/admin/feedback/{feedbackID}/images/{imageID}",
		api.withAuth(api.withAdmin(api.handleFeedbackImage)),
	)
}

func (s *Server) withFeedbackUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "feedback") {
			return
		}
		limit := s.cfg.Storage.MaxFeedbackImageBytes * int64(s.cfg.Storage.MaxFeedbackImages)
		if limit <= 0 {
			limit = 15 << 20
		}
		r.Body = http.MaxBytesReader(w, r.Body, limit+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleCreateFeedback(w http.ResponseWriter, r *http.Request) {
	if s.feedbackService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "feedback_unavailable"})
		return
	}
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}

	maxImageBytes := s.cfg.Storage.MaxFeedbackImageBytes
	if maxImageBytes <= 0 {
		maxImageBytes = 5 << 20
	}
	if err := r.ParseMultipartForm(maxImageBytes); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "request body too large") {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "feedback_upload_too_large"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_feedback_upload"})
		return
	}

	description := r.FormValue("description")
	fileHeaders := r.MultipartForm.File["images"]
	uploads := make([]feedback.Upload, 0, len(fileHeaders))
	openFiles := make([]multipart.File, 0, len(fileHeaders))
	for _, header := range fileHeaders {
		file, err := header.Open()
		if err != nil {
			closeFeedbackFiles(openFiles)
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "feedback_image_read_failed"})
			return
		}
		openFiles = append(openFiles, file)
		uploads = append(uploads, feedback.Upload{Reader: file})
	}

	created, err := s.feedbackService.Create(r.Context(), account.ID, description, uploads)
	closeFeedbackFiles(openFiles)
	if err != nil {
		s.writeFeedbackError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"createdAt": created.CreatedAt.Format(time.RFC3339),
		"id":        created.ID,
	})
}

func (s *Server) handleListFeedback(w http.ResponseWriter, r *http.Request) {
	if s.feedbackService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "feedback_unavailable"})
		return
	}
	limit, offset := parseFeedbackPage(r)
	page, err := s.feedbackService.List(r.Context(), limit, offset)
	if err != nil {
		log.Printf("list feedback failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_feedback_failed"})
		return
	}
	writeJSON(w, http.StatusOK, s.feedbackPageResponse(page))
}

func (s *Server) handleFeedbackImage(w http.ResponseWriter, r *http.Request) {
	if s.feedbackService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "feedback_unavailable"})
		return
	}
	feedbackID := strings.TrimSpace(r.PathValue("feedbackID"))
	imageID := strings.TrimSpace(r.PathValue("imageID"))
	image, err := s.feedbackService.GetImage(r.Context(), feedbackID, imageID)
	if err != nil {
		if errors.Is(err, feedback.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "feedback_image_not_found"})
			return
		}
		log.Printf("get feedback image failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "read_feedback_image_failed"})
		return
	}

	file, err := os.Open(s.feedbackService.ImagePath(image))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "feedback_image_not_found"})
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		log.Printf("stat feedback image failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "read_feedback_image_failed"})
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Type", image.ContentType)
	http.ServeContent(w, r, image.StoredName, info.ModTime(), file)
}

func (s *Server) writeFeedbackError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, feedback.ErrDescriptionInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "description_invalid"})
	case errors.Is(err, feedback.ErrImagesTooMany):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "feedback_images_too_many"})
	case errors.Is(err, feedback.ErrImageTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "feedback_image_too_large"})
	case errors.Is(err, feedback.ErrImageTypeInvalid):
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "feedback_image_type_invalid"})
	default:
		log.Printf("feedback request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_server_error"})
	}
}

func (s *Server) feedbackPageResponse(page feedback.Page) map[string]any {
	items := make([]map[string]any, 0, len(page.Items))
	for _, item := range page.Items {
		images := make([]map[string]any, 0, len(item.Images))
		for _, image := range item.Images {
			images = append(images, map[string]any{
				"contentType": image.ContentType,
				"id":          image.ID,
				"path":        fmt.Sprintf("/api/v1/admin/feedback/%s/images/%s", item.ID, image.ID),
				"sizeBytes":   image.SizeBytes,
				"sortOrder":   image.SortOrder,
			})
		}
		avatarURL := ""
		if item.User.AvatarFile != "" {
			avatarURL = "/avatars/" + item.User.AvatarFile
			if baseURL := strings.TrimRight(strings.TrimSpace(s.cfg.Server.PublicBaseURL), "/"); baseURL != "" {
				avatarURL = baseURL + avatarURL
			}
		}
		items = append(items, map[string]any{
			"createdAt":   item.CreatedAt.Format(time.RFC3339),
			"description": item.Description,
			"id":          item.ID,
			"images":      images,
			"user": map[string]any{
				"avatarUrl":   avatarURL,
				"displayName": item.User.DisplayName,
				"id":          item.User.ID,
				"username":    item.User.Username,
			},
		})
	}
	return map[string]any{
		"items":  items,
		"limit":  page.Limit,
		"offset": page.Offset,
		"total":  page.Total,
	}
}

func parseFeedbackPage(r *http.Request) (int, int) {
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

func closeFeedbackFiles(files []multipart.File) {
	for _, file := range files {
		_ = file.Close()
	}
}
