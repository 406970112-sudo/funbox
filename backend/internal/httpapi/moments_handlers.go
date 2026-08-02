package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/moments"
	"my-first-expo-app/backend/internal/realtime"
	"my-first-expo-app/backend/internal/social"
)

type createMomentCommentBody struct {
	Body           string   `json:"body"`
	MentionUserIDs []string `json:"mentionUserIds"`
	ParentID       string   `json:"parentId"`
}

type markMomentNotificationsReadBody struct {
	MomentID string `json:"momentId"`
}

type momentReportBody struct {
	Reason string `json:"reason"`
}

type momentVisibilityBody struct {
	Visibility string `json:"visibility"`
}

type momentMediaResponse struct {
	URL        string `json:"url"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
}

type momentAttachmentResponse struct {
	Type   string `json:"type"`
	RefID  string `json:"refId"`
	GameID string `json:"gameId,omitempty"`
	Title  string `json:"title,omitempty"`
	Result string `json:"result,omitempty"`
	Score  int    `json:"score,omitempty"`
}

type momentCommentResponse struct {
	Author    socialUserResponse `json:"author"`
	Body      string             `json:"body"`
	CanDelete bool               `json:"canDelete"`
	CreatedAt string             `json:"createdAt"`
	ID        string             `json:"id"`
	MomentID  string             `json:"momentId"`
	ParentID  string             `json:"parentId,omitempty"`
}

type momentNotificationResponse struct {
	Actor     socialUserResponse `json:"actor"`
	CommentID string             `json:"commentId,omitempty"`
	CreatedAt string             `json:"createdAt"`
	ID        string             `json:"id"`
	MomentID  string             `json:"momentId,omitempty"`
	Preview   string             `json:"preview"`
	Read      bool               `json:"read"`
	Type      string             `json:"type"`
}

type momentResponse struct {
	Attachments    []momentAttachmentResponse `json:"attachments"`
	Author         socialUserResponse         `json:"author"`
	Body           string                     `json:"body"`
	CanDelete      bool                       `json:"canDelete"`
	CommentCount   int                        `json:"commentCount"`
	CreatedAt      string                     `json:"createdAt"`
	ID             string                     `json:"id"`
	Images         []momentMediaResponse      `json:"images"`
	LikeCount      int                        `json:"likeCount"`
	LikedByMe      bool                       `json:"likedByMe"`
	RecentComments []momentCommentResponse    `json:"recentComments"`
	RecentLikers   []socialUserResponse       `json:"recentLikers"`
	Status         string                     `json:"status"`
	UpdatedAt      string                     `json:"updatedAt"`
	Visibility     string                     `json:"visibility"`
}

type momentAttachmentOptionResponse struct {
	CreatedAt string `json:"createdAt"`
	GameID    string `json:"gameId"`
	RefID     string `json:"refId"`
	Result    string `json:"result"`
	Source    string `json:"source"`
	Title     string `json:"title"`
	Type      string `json:"type"`
}

type adminMomentResponse struct {
	momentResponse
	ReportCount int `json:"reportCount"`
}

func registerMomentsRoutes(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("POST /api/v1/moments", s.withAuth(s.withMomentUploadPipeline(s.handleCreateMoment)))
	mux.HandleFunc("GET /api/v1/moments/feed", s.withAuth(s.withAPIPipeline(s.handleListMomentFeed)))
	mux.HandleFunc("GET /api/v1/moments/unread-count", s.withAuth(s.withAPIPipeline(s.handleMomentUnreadCount)))
	mux.HandleFunc("GET /api/v1/moments/attachment-options", s.withAuth(s.withAPIPipeline(s.handleMomentAttachmentOptions)))
	mux.HandleFunc("GET /api/v1/moments/{momentID}", s.withAuth(s.withAPIPipeline(s.handleGetMoment)))
	mux.HandleFunc("PATCH /api/v1/moments/{momentID}", s.withAuth(s.withAPIPipeline(s.handleUpdateMomentVisibility)))
	mux.HandleFunc("DELETE /api/v1/moments/{momentID}", s.withAuth(s.withAPIPipeline(s.handleDeleteMoment)))
	mux.HandleFunc("POST /api/v1/moments/{momentID}/like", s.withAuth(s.withAPIPipeline(s.handleLikeMoment)))
	mux.HandleFunc("DELETE /api/v1/moments/{momentID}/like", s.withAuth(s.withAPIPipeline(s.handleUnlikeMoment)))
	mux.HandleFunc("GET /api/v1/moments/{momentID}/likes", s.withAuth(s.withAPIPipeline(s.handleListMomentLikes)))
	mux.HandleFunc("POST /api/v1/moments/{momentID}/comments", s.withAuth(s.withAPIPipeline(s.handleCreateMomentComment)))
	mux.HandleFunc("GET /api/v1/moments/{momentID}/comments", s.withAuth(s.withAPIPipeline(s.handleListMomentComments)))
	mux.HandleFunc("DELETE /api/v1/moment-comments/{commentID}", s.withAuth(s.withAPIPipeline(s.handleDeleteMomentComment)))
	mux.HandleFunc("GET /api/v1/moments/notifications", s.withAuth(s.withAPIPipeline(s.handleListMomentNotifications)))
	mux.HandleFunc("POST /api/v1/moments/notifications/read", s.withAuth(s.withAPIPipeline(s.handleMarkMomentNotificationsRead)))
	mux.HandleFunc("POST /api/v1/moments/{momentID}/report", s.withAuth(s.withAPIPipeline(s.handleReportMoment)))
	mux.HandleFunc("GET /api/v1/admin/moments", s.withAuth(s.withAdmin(s.withAPIPipeline(s.handleAdminListMoments))))
	mux.HandleFunc("POST /api/v1/admin/moments/{momentID}/hide", s.withAuth(s.withAdmin(s.withAPIPipeline(s.handleAdminHideMoment))))
}

func (s *Server) withMomentUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "moment-upload") {
			return
		}
		maxBytes := s.cfg.Storage.MaxMomentImageBytes
		maxImages := s.cfg.Storage.MaxMomentImages
		if maxBytes <= 0 {
			maxBytes = moments.MaxImageBytes
		}
		if maxImages <= 0 {
			maxImages = moments.MaxMomentImages
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes*int64(maxImages)+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleCreateMoment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	maxBytes := s.cfg.Storage.MaxMomentImageBytes
	if maxBytes <= 0 {
		maxBytes = moments.MaxImageBytes
	}
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_moment_upload"})
		return
	}

	uploads := make([]moments.Upload, 0, len(r.MultipartForm.File["images"]))
	for _, header := range r.MultipartForm.File["images"] {
		file, err := header.Open()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "moment_image_read_failed"})
			return
		}
		uploads = append(uploads, moments.Upload{Reader: file})
	}

	attachment := momentAttachmentFromForm(r)
	created, err := s.momentsService.Create(
		r.Context(),
		account.ID,
		strings.TrimSpace(r.FormValue("body")),
		strings.TrimSpace(r.FormValue("visibility")),
		uploads,
		attachment,
	)
	if err != nil {
		writeMomentsError(w, err)
		return
	}

	response := s.moment(created, account.ID)
	s.publishMomentCreated(r, account.ID, response)
	writeJSON(w, http.StatusCreated, map[string]any{"moment": response})
}

func (s *Server) handleListMomentFeed(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	page, err := s.momentsService.Store().ListFeed(
		r.Context(),
		account.ID,
		r.URL.Query().Get("scope"),
		r.URL.Query().Get("cursor"),
		parseMomentLimit(r),
	)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	items := make([]momentResponse, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, s.moment(item, account.ID))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"moments":    items,
		"nextCursor": page.NextCursor,
	})
}

func (s *Server) handleGetMoment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	item, err := s.momentsService.Store().Get(r.Context(), account.ID, r.PathValue("momentID"))
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"moment": s.moment(item, account.ID)})
}

func (s *Server) handleUpdateMomentVisibility(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	var body momentVisibilityBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.momentsService.Store().UpdateVisibility(
		r.Context(),
		account.ID,
		r.PathValue("momentID"),
		body.Visibility,
	)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"moment": s.moment(item, account.ID)})
}

func (s *Server) handleDeleteMoment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	momentID := r.PathValue("momentID")
	if err := s.momentsService.Store().Delete(r.Context(), account.ID, momentID); err != nil {
		writeMomentsError(w, err)
		return
	}
	s.publishMomentEventToFriends(r, account.ID, "moment.deleted", map[string]any{"momentId": momentID})
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleLikeMoment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	momentID := r.PathValue("momentID")
	created, err := s.momentsService.Store().Like(r.Context(), account.ID, momentID)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	if created {
		if authorID, authorErr := s.momentsService.Store().AuthorOf(r.Context(), momentID); authorErr == nil {
			s.realtimeHub.Publish(authorID, realtime.Event{
				Type: "moment.like.created",
				Data: map[string]any{"actorId": account.ID, "momentId": momentID},
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"liked": created})
}

func (s *Server) handleUnlikeMoment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	momentID := r.PathValue("momentID")
	removed, err := s.momentsService.Store().Unlike(r.Context(), account.ID, momentID)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	if removed {
		if authorID, authorErr := s.momentsService.Store().AuthorOf(r.Context(), momentID); authorErr == nil {
			s.realtimeHub.Publish(authorID, realtime.Event{
				Type: "moment.like.removed",
				Data: map[string]any{"actorId": account.ID, "momentId": momentID},
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"liked": false})
}

func (s *Server) handleListMomentLikes(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	users, nextCursor, err := s.momentsService.Store().ListLikes(
		r.Context(),
		account.ID,
		r.PathValue("momentID"),
		r.URL.Query().Get("cursor"),
		parseMomentLimit(r),
	)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	result := make([]socialUserResponse, 0, len(users))
	for _, user := range users {
		result = append(result, s.socialUser(momentsUserSummary(user)))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"likes":      result,
		"nextCursor": nextCursor,
	})
}

func (s *Server) handleCreateMomentComment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	var body createMomentCommentBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	momentID := r.PathValue("momentID")
	comment, err := s.momentsService.Store().Comment(
		r.Context(),
		account.ID,
		momentID,
		strings.TrimSpace(body.ParentID),
		body.Body,
		body.MentionUserIDs,
	)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	response := s.momentComment(comment, account.ID)
	if authorID, authorErr := s.momentsService.Store().AuthorOf(r.Context(), momentID); authorErr == nil {
		s.realtimeHub.Publish(authorID, realtime.Event{
			Type: "moment.comment.created",
			Data: map[string]any{"comment": response, "momentId": momentID},
		})
	}
	for _, mentionID := range body.MentionUserIDs {
		mentionID = strings.TrimSpace(mentionID)
		if mentionID == "" || mentionID == account.ID {
			continue
		}
		s.realtimeHub.Publish(mentionID, realtime.Event{
			Type: "moment.comment.created",
			Data: map[string]any{"comment": response, "momentId": momentID},
		})
	}
	writeJSON(w, http.StatusCreated, map[string]any{"comment": response})
}

func (s *Server) handleListMomentComments(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	page, err := s.momentsService.Store().ListComments(
		r.Context(),
		account.ID,
		r.PathValue("momentID"),
		r.URL.Query().Get("cursor"),
		parseMomentLimit(r),
	)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	items := make([]momentCommentResponse, 0, len(page.Items))
	for _, comment := range page.Items {
		items = append(items, s.momentComment(comment, account.ID))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"comments":   items,
		"nextCursor": page.NextCursor,
	})
}

func (s *Server) handleDeleteMomentComment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	if err := s.momentsService.Store().DeleteComment(
		r.Context(),
		account.ID,
		r.PathValue("commentID"),
	); err != nil {
		writeMomentsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleListMomentNotifications(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	page, err := s.momentsService.Store().Notifications(
		r.Context(),
		account.ID,
		r.URL.Query().Get("cursor"),
		parseMomentLimit(r),
	)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	items := make([]momentNotificationResponse, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, s.momentNotification(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":        items,
		"nextCursor":   page.NextCursor,
		"unreadCount":  page.UnreadCount,
	})
}

func (s *Server) handleMarkMomentNotificationsRead(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	var body markMomentNotificationsReadBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.momentsService.Store().MarkNotificationsRead(
		r.Context(),
		account.ID,
		strings.TrimSpace(body.MomentID),
	); err != nil {
		writeMomentsError(w, err)
		return
	}
	s.realtimeHub.Publish(account.ID, realtime.Event{
		Type: "moment.notification.read",
		Data: map[string]any{"momentId": body.MomentID},
	})
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleMomentUnreadCount(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusOK, map[string]any{"unreadCount": 0})
		return
	}
	count, err := s.momentsService.Store().UnreadCount(r.Context(), account.ID)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"unreadCount": count})
}

func (s *Server) handleMomentAttachmentOptions(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	options, err := s.momentsService.Store().ListAttachmentOptions(
		r.Context(),
		account.ID,
		parseMomentLimit(r),
	)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	items := make([]momentAttachmentOptionResponse, 0, len(options))
	for _, option := range options {
		items = append(items, momentAttachmentOptionResponse{
			CreatedAt: formatSocialTime(option.CreatedAt),
			GameID:    option.GameID,
			RefID:     option.RefID,
			Result:    option.Result,
			Source:    option.Source,
			Title:     option.Title,
			Type:      option.Type,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleReportMoment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	var body momentReportBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.momentsService.Store().Report(
		r.Context(),
		account.ID,
		r.PathValue("momentID"),
		body.Reason,
	); err != nil {
		writeMomentsError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"success": true})
}

func (s *Server) handleAdminListMoments(w http.ResponseWriter, r *http.Request) {
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	page, err := s.momentsService.Store().AdminList(
		r.Context(),
		r.URL.Query().Get("status"),
		r.URL.Query().Get("cursor"),
		parseMomentLimit(r),
	)
	if err != nil {
		writeMomentsError(w, err)
		return
	}
	items := make([]adminMomentResponse, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, adminMomentResponse{
			momentResponse: s.moment(item.Moment, item.Author.ID),
			ReportCount:    item.ReportCount,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"moments":    items,
		"nextCursor": page.NextCursor,
	})
}

func (s *Server) handleAdminHideMoment(w http.ResponseWriter, r *http.Request) {
	if s.momentsService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "moments_not_configured"})
		return
	}
	if err := s.momentsService.Store().AdminHide(r.Context(), r.PathValue("momentID")); err != nil {
		writeMomentsError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleServeMomentMedia(w http.ResponseWriter, r *http.Request) {
	fileName := filepath.Base(strings.TrimPrefix(r.URL.Path, "/moment-media/"))
	if fileName == "." || fileName == "" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	filePath := filepath.Join(s.cfg.Storage.MomentDir, fileName)
	if _, err := os.Stat(filePath); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, filePath)
}

func (s *Server) moment(item moments.Moment, viewerID string) momentResponse {
	images := make([]momentMediaResponse, 0, len(item.Media))
	for _, media := range item.Media {
		images = append(images, s.momentMedia(media))
	}
	attachments := make([]momentAttachmentResponse, 0, len(item.Attachments))
	for _, attachment := range item.Attachments {
		attachments = append(attachments, s.momentAttachment(attachment))
	}
	recentLikers := make([]socialUserResponse, 0, len(item.RecentLikers))
	for _, user := range item.RecentLikers {
		recentLikers = append(recentLikers, s.socialUser(momentsUserSummary(user)))
	}
	recentComments := make([]momentCommentResponse, 0, len(item.RecentComments))
	for _, comment := range item.RecentComments {
		recentComments = append(recentComments, s.momentComment(comment, viewerID))
	}
	return momentResponse{
		Attachments:    attachments,
		Author:         s.socialUser(momentsUserSummary(item.Author)),
		Body:           item.Body,
		CanDelete:      item.Author.ID == viewerID,
		CommentCount:   item.CommentCount,
		CreatedAt:      formatSocialTime(item.CreatedAt),
		ID:             item.ID,
		Images:         images,
		LikeCount:      item.LikeCount,
		LikedByMe:      item.LikedByMe,
		RecentComments: recentComments,
		RecentLikers:   recentLikers,
		Status:         item.Status,
		UpdatedAt:      formatSocialTime(item.UpdatedAt),
		Visibility:     item.Visibility,
	}
}

func (s *Server) momentMedia(media moments.Media) momentMediaResponse {
	url := "/moment-media/" + media.StoredName
	if baseURL := strings.TrimRight(strings.TrimSpace(s.cfg.Server.PublicBaseURL), "/"); baseURL != "" {
		url = baseURL + url
	}
	return momentMediaResponse{
		URL:    url,
		Width:  media.Width,
		Height: media.Height,
	}
}

func (s *Server) momentAttachment(attachment moments.Attachment) momentAttachmentResponse {
	var payload momentAttachmentResponse
	_ = json.Unmarshal([]byte(attachment.PayloadJSON), &payload)
	payload.Type = attachment.Type
	payload.RefID = attachment.RefID
	return payload
}

func (s *Server) momentComment(comment moments.Comment, viewerID string) momentCommentResponse {
	return momentCommentResponse{
		Author:    s.socialUser(momentsUserSummary(comment.Author)),
		Body:      comment.Body,
		CanDelete: comment.Author.ID == viewerID,
		CreatedAt: formatSocialTime(comment.CreatedAt),
		ID:        comment.ID,
		MomentID:  comment.MomentID,
		ParentID:  comment.ParentID,
	}
}

func (s *Server) momentNotification(item moments.Notification) momentNotificationResponse {
	return momentNotificationResponse{
		Actor:     s.socialUser(momentsUserSummary(item.Actor)),
		CommentID: item.CommentID,
		CreatedAt: formatSocialTime(item.CreatedAt),
		ID:        item.ID,
		MomentID:  item.MomentID,
		Preview:   item.Preview,
		Read:      item.Read,
		Type:      item.Type,
	}
}

func (s *Server) publishMomentCreated(r *http.Request, userID string, response momentResponse) {
	friends, err := s.socialStore.ListFriendIDs(r.Context(), userID)
	if err != nil {
		return
	}
	for _, friendID := range friends {
		s.realtimeHub.Publish(friendID, realtime.Event{
			Type: "moment.created",
			Data: response,
		})
	}
	s.realtimeHub.Publish(userID, realtime.Event{
		Type: "moment.created",
		Data: response,
	})
}

func (s *Server) publishMomentEventToFriends(
	r *http.Request,
	userID string,
	eventType string,
	data map[string]any,
) {
	friends, err := s.socialStore.ListFriendIDs(r.Context(), userID)
	if err != nil {
		return
	}
	for _, friendID := range friends {
		s.realtimeHub.Publish(friendID, realtime.Event{Type: eventType, Data: data})
	}
}

func momentAttachmentFromForm(r *http.Request) *moments.Attachment {
	attachmentType := strings.TrimSpace(r.FormValue("attachmentType"))
	refID := strings.TrimSpace(r.FormValue("attachmentRefId"))
	if attachmentType == "" || refID == "" {
		return nil
	}
	refTable := "game_matches"
	if strings.TrimSpace(r.FormValue("attachmentSource")) == "score" {
		refTable = "game_score_submissions"
	}
	return &moments.Attachment{
		ID:       "",
		Type:     attachmentType,
		RefTable: refTable,
		RefID:    refID,
	}
}

func momentsUserSummary(user moments.UserSummary) social.UserSummary {
	return social.UserSummary{
		ID:          user.ID,
		Role:        user.Role,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		AvatarFile:  user.AvatarFile,
	}
}

func parseMomentLimit(r *http.Request) int {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > moments.MaxPageSize {
		return moments.DefaultPageSize
	}
	return limit
}

func writeMomentsError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, moments.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_found"})
	case errors.Is(err, moments.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
	case errors.Is(err, moments.ErrBodyInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "moment_body_invalid"})
	case errors.Is(err, moments.ErrCommentInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "comment_invalid"})
	case errors.Is(err, moments.ErrImageTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "moment_image_too_large"})
	case errors.Is(err, moments.ErrImagesTooMany):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "moment_images_too_many"})
	case errors.Is(err, moments.ErrImageTypeInvalid):
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "moment_image_type_invalid"})
	case errors.Is(err, moments.ErrAttachmentInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "moment_attachment_invalid"})
	default:
		log.Printf("moments request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "moments_request_failed"})
	}
}
