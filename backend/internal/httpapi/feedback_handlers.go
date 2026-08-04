package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/feedback"
	"my-first-expo-app/backend/internal/realtime"
)

func registerFeedbackRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("POST /api/v1/feedback", api.withAuth(api.withFeedbackUploadPipeline(api.handleCreateFeedback)))
	mux.HandleFunc("GET /api/v1/feedback/mine", api.withAuth(api.withAPIPipeline(api.handleListMyFeedback)))
	mux.HandleFunc("GET /api/v1/feedback/notifications", api.withAuth(api.withAPIPipeline(api.handleListFeedbackNotifications)))
	mux.HandleFunc("POST /api/v1/feedback/notifications/read", api.withAuth(api.withAPIPipeline(api.handleMarkFeedbackNotificationsRead)))
	mux.HandleFunc("GET /api/v1/feedback/{feedbackID}", api.withAuth(api.withAPIPipeline(api.handleGetMyFeedback)))
	mux.HandleFunc(
		"GET /api/v1/feedback/{feedbackID}/images/{imageID}",
		api.withAuth(api.handleMyFeedbackImage),
	)
	mux.HandleFunc("GET /api/v1/admin/feedback", api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleListFeedback))))
	mux.HandleFunc(
		"POST /api/v1/admin/feedback/{feedbackID}/resolve",
		api.withAuth(api.withAdmin(api.withAPIPipeline(api.handleResolveFeedback))),
	)
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
	kind := r.FormValue("kind")
	title := r.FormValue("title")
	category := r.FormValue("category")
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

	created, err := s.feedbackService.Create(
		r.Context(),
		account.ID,
		kind,
		title,
		category,
		description,
		uploads,
	)
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
	page, err := s.feedbackService.List(r.Context(), feedback.ListOptions{
		Kind:   strings.TrimSpace(r.URL.Query().Get("kind")),
		Status: strings.TrimSpace(r.URL.Query().Get("status")),
		Query:  strings.TrimSpace(r.URL.Query().Get("q")),
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		log.Printf("list feedback failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_feedback_failed"})
		return
	}
	writeJSON(w, http.StatusOK, s.feedbackPageResponse(page, "/api/v1/admin/feedback", 0))
}

func (s *Server) handleListMyFeedback(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.feedbackService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "feedback_unavailable"})
		return
	}
	limit, offset := parseFeedbackPage(r)
	page, err := s.feedbackService.ListByUser(r.Context(), account.ID, limit, offset)
	if err != nil {
		log.Printf("list my feedback failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_feedback_failed"})
		return
	}
	unread, err := s.feedbackService.UnreadCount(r.Context(), account.ID)
	if err != nil {
		log.Printf("count my feedback unread failed: %v", err)
	}
	writeJSON(w, http.StatusOK, s.feedbackPageResponse(page, "/api/v1/feedback", unread))
}

func (s *Server) handleListFeedbackNotifications(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.feedbackService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "feedback_unavailable"})
		return
	}
	limit, offset := parseFeedbackPage(r)
	page, err := s.feedbackService.ListNotifications(r.Context(), account.ID, limit, offset)
	if err != nil {
		log.Printf("list feedback notifications failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_feedback_failed"})
		return
	}
	unread, err := s.feedbackService.UnreadCount(r.Context(), account.ID)
	if err != nil {
		log.Printf("count feedback unread failed: %v", err)
	}
	writeJSON(w, http.StatusOK, s.feedbackPageResponse(page, "/api/v1/feedback", unread))
}

func (s *Server) handleGetMyFeedback(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.feedbackService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "feedback_unavailable"})
		return
	}
	item, err := s.feedbackService.GetByUser(r.Context(), account.ID, strings.TrimSpace(r.PathValue("feedbackID")))
	if err != nil {
		s.writeFeedbackError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"item": s.feedbackItemResponse(item, "/api/v1/feedback"),
	})
}

func (s *Server) handleMarkFeedbackNotificationsRead(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.feedbackService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "feedback_unavailable"})
		return
	}
	var payload struct {
		FeedbackIDs []string `json:"feedbackIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_feedback_read_request"})
		return
	}
	if err := s.feedbackService.MarkNotificationsRead(r.Context(), account.ID, payload.FeedbackIDs); err != nil {
		log.Printf("mark feedback notifications read failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "mark_feedback_read_failed"})
		return
	}
	unread, err := s.feedbackService.UnreadCount(r.Context(), account.ID)
	if err != nil {
		log.Printf("count feedback unread failed: %v", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "unreadCount": unread})
}

func (s *Server) handleResolveFeedback(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.feedbackService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "feedback_unavailable"})
		return
	}
	var payload struct {
		Reply  string `json:"reply"`
		Status string `json:"status"`
	}
	if err := decodeJSONBody(r, &payload); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	updated, err := s.feedbackService.Resolve(
		r.Context(),
		strings.TrimSpace(r.PathValue("feedbackID")),
		account.ID,
		strings.TrimSpace(payload.Status),
		payload.Reply,
	)
	if err != nil {
		s.writeFeedbackError(w, err)
		return
	}
	preview := updated.AdminReply
	runes := []rune(preview)
	if len(runes) > 60 {
		preview = string(runes[:60]) + "..."
	}
	s.realtimeHub.Publish(updated.User.ID, realtime.Event{
		Type: "feedback.resolved",
		Data: map[string]any{
			"feedbackId":   updated.ID,
			"kind":         updated.Kind,
			"status":       updated.Status,
			"replyPreview": preview,
		},
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"item": s.feedbackItemResponse(updated, "/api/v1/admin/feedback"),
	})
}

func (s *Server) handleMyFeedbackImage(w http.ResponseWriter, r *http.Request) {
	if s.feedbackService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "feedback_unavailable"})
		return
	}
	feedbackID := strings.TrimSpace(r.PathValue("feedbackID"))
	imageID := strings.TrimSpace(r.PathValue("imageID"))
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if _, err := s.feedbackService.GetByUser(r.Context(), account.ID, feedbackID); err != nil {
		s.writeFeedbackError(w, err)
		return
	}
	image, err := s.feedbackService.GetImage(r.Context(), feedbackID, imageID)
	if err != nil {
		s.writeFeedbackError(w, err)
		return
	}
	s.serveFeedbackImage(w, r, image)
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
		s.writeFeedbackError(w, err)
		return
	}
	s.serveFeedbackImage(w, r, image)
}

func (s *Server) serveFeedbackImage(w http.ResponseWriter, r *http.Request, image feedback.Image) {
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
	case errors.Is(err, feedback.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "feedback_not_found"})
	case errors.Is(err, feedback.ErrDescriptionInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "description_invalid"})
	case errors.Is(err, feedback.ErrKindInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "feedback_kind_invalid"})
	case errors.Is(err, feedback.ErrTitleInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "feedback_title_invalid"})
	case errors.Is(err, feedback.ErrCategoryInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "feedback_category_invalid"})
	case errors.Is(err, feedback.ErrStatusInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "feedback_status_invalid"})
	case errors.Is(err, feedback.ErrReplyInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "feedback_reply_invalid"})
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

func (s *Server) feedbackPageResponse(page feedback.Page, imageBase string, unreadCount int) map[string]any {
	items := make([]map[string]any, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, s.feedbackItemResponse(item, imageBase))
	}
	return map[string]any{
		"items":       items,
		"limit":       page.Limit,
		"offset":      page.Offset,
		"total":       page.Total,
		"unreadCount": unreadCount,
	}
}

func (s *Server) feedbackItemResponse(item feedback.Submission, imageBase string) map[string]any {
	images := make([]map[string]any, 0, len(item.Images))
	for _, image := range item.Images {
		images = append(images, map[string]any{
			"contentType": image.ContentType,
			"id":          image.ID,
			"path":        fmt.Sprintf("%s/%s/images/%s", imageBase, item.ID, image.ID),
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
	return map[string]any{
		"adminReply":     item.AdminReply,
		"category":       item.Category,
		"createdAt":      item.CreatedAt.Format(time.RFC3339),
		"description":    item.Description,
		"id":             item.ID,
		"images":         images,
		"kind":           item.Kind,
		"processedAt":    formatOptionalFeedbackTime(item.ProcessedAt),
		"read":           isFeedbackRead(item),
		"replyUpdatedAt": formatOptionalFeedbackTime(item.ReplyUpdatedAt),
		"status":         item.Status,
		"title":          item.Title,
		"user": map[string]any{
			"avatarUrl":   avatarURL,
			"displayName": item.User.DisplayName,
			"id":          item.User.ID,
			"username":    item.User.Username,
		},
	}
}

func formatOptionalFeedbackTime(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format(time.RFC3339)
}

func isFeedbackRead(item feedback.Submission) bool {
	if item.UserReadAt == nil {
		return false
	}
	if item.ReplyUpdatedAt == nil {
		return true
	}
	return !item.UserReadAt.Before(*item.ReplyUpdatedAt)
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
