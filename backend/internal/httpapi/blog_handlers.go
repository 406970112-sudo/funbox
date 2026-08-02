package httpapi

import (
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/blog"
	"my-first-expo-app/backend/internal/realtime"
	"my-first-expo-app/backend/internal/social"
)

type createBlogPostBody struct {
	Title      string `json:"title"`
	Summary    string `json:"summary"`
	Body       string `json:"body"`
	Visibility string `json:"visibility"`
}

type updateBlogPostBody struct {
	Title      string `json:"title"`
	Summary    string `json:"summary"`
	Body       string `json:"body"`
	Visibility string `json:"visibility"`
}

type blogCommentBody struct {
	Body           string   `json:"body"`
	MentionUserIDs []string `json:"mentionUserIds"`
	ParentID       string   `json:"parentId"`
}

type markBlogNotificationsReadBody struct {
	PostID string `json:"postId"`
}

type blogReportBody struct {
	Reason string `json:"reason"`
}

type blogCommentResponse struct {
	Author    socialUserResponse `json:"author"`
	Body      string             `json:"body"`
	CanDelete bool               `json:"canDelete"`
	CreatedAt string             `json:"createdAt"`
	ID        string             `json:"id"`
	PostID    string             `json:"postId"`
	ParentID  string             `json:"parentId,omitempty"`
}

type blogNotificationResponse struct {
	Actor     socialUserResponse `json:"actor"`
	CommentID string             `json:"commentId,omitempty"`
	CreatedAt string             `json:"createdAt"`
	ID        string             `json:"id"`
	PostID    string             `json:"postId,omitempty"`
	Preview   string             `json:"preview"`
	Read      bool               `json:"read"`
	Type      string             `json:"type"`
}

type blogPostResponse struct {
	Author         socialUserResponse    `json:"author"`
	Body           string                `json:"body"`
	CanDelete      bool                  `json:"canDelete"`
	CommentCount   int                   `json:"commentCount"`
	CoverURL       string                `json:"coverUrl,omitempty"`
	ID             string                `json:"id"`
	LikeCount      int                   `json:"likeCount"`
	LikedByMe      bool                  `json:"likedByMe"`
	PublishedAt    string                `json:"publishedAt"`
	RecentComments []blogCommentResponse `json:"recentComments"`
	Status         string                `json:"status"`
	Summary        string                `json:"summary"`
	Title          string                `json:"title"`
	Visibility     string                `json:"visibility"`
	WordCount      int                   `json:"wordCount"`
}

type adminBlogPostResponse struct {
	blogPostResponse
	ReportCount int `json:"reportCount"`
}

func registerBlogRoutes(mux *http.ServeMux, s *Server) {
	mux.HandleFunc("GET /api/v1/blog/feed", s.withOptionalAuth(s.withAPIPipeline(s.handleListBlogFeed)))
	mux.HandleFunc("POST /api/v1/blog/posts", s.withAuth(s.withBlogUploadPipeline(s.handleCreateBlogPost)))
	mux.HandleFunc("GET /api/v1/blog/posts/{postID}", s.withOptionalAuth(s.withAPIPipeline(s.handleGetBlogPost)))
	mux.HandleFunc("PATCH /api/v1/blog/posts/{postID}", s.withAuth(s.withAPIPipeline(s.handleUpdateBlogPost)))
	mux.HandleFunc("DELETE /api/v1/blog/posts/{postID}", s.withAuth(s.withAPIPipeline(s.handleDeleteBlogPost)))
	mux.HandleFunc("POST /api/v1/blog/posts/{postID}/cover", s.withAuth(s.withBlogUploadPipeline(s.handleReplaceBlogCover)))
	mux.HandleFunc("POST /api/v1/blog/posts/{postID}/like", s.withAuth(s.withAPIPipeline(s.handleLikeBlogPost)))
	mux.HandleFunc("DELETE /api/v1/blog/posts/{postID}/like", s.withAuth(s.withAPIPipeline(s.handleUnlikeBlogPost)))
	mux.HandleFunc("GET /api/v1/blog/posts/{postID}/likes", s.withAuth(s.withAPIPipeline(s.handleListBlogLikes)))
	mux.HandleFunc("POST /api/v1/blog/posts/{postID}/comments", s.withAuth(s.withAPIPipeline(s.handleCreateBlogComment)))
	mux.HandleFunc("GET /api/v1/blog/posts/{postID}/comments", s.withOptionalAuth(s.withAPIPipeline(s.handleListBlogComments)))
	mux.HandleFunc("DELETE /api/v1/blog/comments/{commentID}", s.withAuth(s.withAPIPipeline(s.handleDeleteBlogComment)))
	mux.HandleFunc("POST /api/v1/blog/posts/{postID}/report", s.withAuth(s.withAPIPipeline(s.handleReportBlogPost)))
	mux.HandleFunc("POST /api/v1/blog/comments/{commentID}/report", s.withAuth(s.withAPIPipeline(s.handleReportBlogComment)))
	mux.HandleFunc("GET /api/v1/blog/me/posts", s.withAuth(s.withAPIPipeline(s.handleListMyBlogPosts)))
	mux.HandleFunc("GET /api/v1/blog/notifications", s.withAuth(s.withAPIPipeline(s.handleListBlogNotifications)))
	mux.HandleFunc("GET /api/v1/blog/unread-count", s.withAuth(s.withAPIPipeline(s.handleBlogUnreadCount)))
	mux.HandleFunc("POST /api/v1/blog/notifications/read", s.withAuth(s.withAPIPipeline(s.handleMarkBlogNotificationsRead)))
	mux.HandleFunc("GET /api/v1/admin/blog/posts", s.withAuth(s.withAdmin(s.withAPIPipeline(s.handleAdminListBlogPosts))))
	mux.HandleFunc("POST /api/v1/admin/blog/posts/{postID}/hide", s.withAuth(s.withAdmin(s.withAPIPipeline(s.handleAdminHideBlogPost))))
}

func (s *Server) withBlogUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "blog-upload") {
			return
		}
		maxBytes := s.cfg.Storage.MaxBlogCoverBytes
		if maxBytes <= 0 {
			maxBytes = 2 << 20
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleListBlogFeed(w http.ResponseWriter, r *http.Request) {
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	viewerID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		viewerID = account.ID
	}
	tab := strings.TrimSpace(r.URL.Query().Get("tab"))
	if tab == "" {
		tab = "public"
	}
	if tab == "friends" && viewerID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	page, err := s.blogService.Store().ListFeed(
		r.Context(),
		viewerID,
		tab,
		r.URL.Query().Get("cursor"),
		parseBlogLimit(r),
	)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	items := make([]blogPostResponse, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, s.blogPost(item, viewerID))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"posts":      items,
		"nextCursor": page.NextCursor,
	})
}

func (s *Server) handleCreateBlogPost(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_blog_upload"})
		return
	}
	var cover *blog.CoverUpload
	if len(r.MultipartForm.File["cover"]) > 0 {
		file, err := r.MultipartForm.File["cover"][0].Open()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "blog_cover_read_failed"})
			return
		}
		defer file.Close()
		cover = &blog.CoverUpload{Reader: file}
	}
	created, err := s.blogService.Create(
		r.Context(),
		account.ID,
		strings.TrimSpace(r.FormValue("title")),
		strings.TrimSpace(r.FormValue("summary")),
		strings.TrimSpace(r.FormValue("body")),
		cover,
		strings.TrimSpace(r.FormValue("visibility")),
	)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	response := s.blogPost(created, account.ID)
	s.publishBlogCreated(r, account.ID, response)
	writeJSON(w, http.StatusCreated, map[string]any{"post": response})
}

func (s *Server) handleGetBlogPost(w http.ResponseWriter, r *http.Request) {
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	viewerID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		viewerID = account.ID
	}
	item, err := s.blogService.Store().Get(r.Context(), viewerID, r.PathValue("postID"))
	if err != nil {
		writeBlogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"post": s.blogPost(item, viewerID)})
}

func (s *Server) handleUpdateBlogPost(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	var body updateBlogPostBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.blogService.Store().Update(
		r.Context(),
		account.ID,
		r.PathValue("postID"),
		body.Title,
		body.Summary,
		body.Body,
		body.Visibility,
	)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"post": s.blogPost(item, account.ID)})
}

func (s *Server) handleDeleteBlogPost(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	postID := r.PathValue("postID")
	if err := s.blogService.Store().Delete(r.Context(), account.ID, postID); err != nil {
		writeBlogError(w, err)
		return
	}
	s.publishBlogEventToFriends(r, account.ID, "blog.post.deleted", map[string]any{"postId": postID})
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleReplaceBlogCover(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_blog_upload"})
		return
	}
	if len(r.MultipartForm.File["cover"]) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "blog_cover_required"})
		return
	}
	file, err := r.MultipartForm.File["cover"][0].Open()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "blog_cover_read_failed"})
		return
	}
	defer file.Close()
	item, err := s.blogService.ReplaceCover(
		r.Context(),
		account.ID,
		r.PathValue("postID"),
		&blog.CoverUpload{Reader: file},
	)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"post": s.blogPost(item, account.ID)})
}

func (s *Server) handleLikeBlogPost(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	postID := r.PathValue("postID")
	created, err := s.blogService.Store().Like(r.Context(), account.ID, postID)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	if created {
		if authorID, authorErr := s.blogService.Store().AuthorOf(r.Context(), postID); authorErr == nil {
			s.realtimeHub.Publish(authorID, realtime.Event{
				Type: "blog.post.like.created",
				Data: map[string]any{"actorId": account.ID, "postId": postID},
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"liked": created})
}

func (s *Server) handleUnlikeBlogPost(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	postID := r.PathValue("postID")
	removed, err := s.blogService.Store().Unlike(r.Context(), account.ID, postID)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	if removed {
		if authorID, authorErr := s.blogService.Store().AuthorOf(r.Context(), postID); authorErr == nil {
			s.realtimeHub.Publish(authorID, realtime.Event{
				Type: "blog.post.like.removed",
				Data: map[string]any{"actorId": account.ID, "postId": postID},
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"liked": false})
}

func (s *Server) handleListBlogLikes(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	users, nextCursor, err := s.blogService.Store().ListLikes(
		r.Context(),
		account.ID,
		r.PathValue("postID"),
		r.URL.Query().Get("cursor"),
		parseBlogLimit(r),
	)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	result := make([]socialUserResponse, 0, len(users))
	for _, user := range users {
		result = append(result, s.socialUser(blogUserSummary(user)))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"likes":      result,
		"nextCursor": nextCursor,
	})
}

func (s *Server) handleCreateBlogComment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	var body blogCommentBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	postID := r.PathValue("postID")
	comment, err := s.blogService.Store().Comment(
		r.Context(),
		account.ID,
		postID,
		strings.TrimSpace(body.ParentID),
		body.Body,
		body.MentionUserIDs,
	)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	response := s.blogComment(comment, account.ID)
	if authorID, authorErr := s.blogService.Store().AuthorOf(r.Context(), postID); authorErr == nil {
		s.realtimeHub.Publish(authorID, realtime.Event{
			Type: "blog.post.comment.created",
			Data: map[string]any{"comment": response, "postId": postID},
		})
	}
	for _, mentionID := range body.MentionUserIDs {
		mentionID = strings.TrimSpace(mentionID)
		if mentionID == "" || mentionID == account.ID {
			continue
		}
		s.realtimeHub.Publish(mentionID, realtime.Event{
			Type: "blog.post.comment.created",
			Data: map[string]any{"comment": response, "postId": postID},
		})
	}
	writeJSON(w, http.StatusCreated, map[string]any{"comment": response})
}

func (s *Server) handleListBlogComments(w http.ResponseWriter, r *http.Request) {
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	viewerID := ""
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		viewerID = account.ID
	}
	page, err := s.blogService.Store().ListComments(
		r.Context(),
		viewerID,
		r.PathValue("postID"),
		r.URL.Query().Get("cursor"),
		parseBlogLimit(r),
	)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	items := make([]blogCommentResponse, 0, len(page.Items))
	for _, comment := range page.Items {
		items = append(items, s.blogComment(comment, viewerID))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"comments":   items,
		"nextCursor": page.NextCursor,
	})
}

func (s *Server) handleDeleteBlogComment(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	if err := s.blogService.Store().DeleteComment(
		r.Context(),
		account.ID,
		r.PathValue("commentID"),
	); err != nil {
		writeBlogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleReportBlogPost(w http.ResponseWriter, r *http.Request) {
	s.handleReportBlogTarget(w, r, "post", r.PathValue("postID"))
}

func (s *Server) handleReportBlogComment(w http.ResponseWriter, r *http.Request) {
	s.handleReportBlogTarget(w, r, "comment", r.PathValue("commentID"))
}

func (s *Server) handleReportBlogTarget(w http.ResponseWriter, r *http.Request, targetType string, targetID string) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	var body blogReportBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.blogService.Store().Report(
		r.Context(),
		account.ID,
		targetType,
		targetID,
		body.Reason,
	); err != nil {
		writeBlogError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"success": true})
}

func (s *Server) handleListMyBlogPosts(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	page, err := s.blogService.Store().ListFeed(
		r.Context(),
		account.ID,
		"mine",
		r.URL.Query().Get("cursor"),
		parseBlogLimit(r),
	)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	items := make([]blogPostResponse, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, s.blogPost(item, account.ID))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"posts":      items,
		"nextCursor": page.NextCursor,
	})
}

func (s *Server) handleListBlogNotifications(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	page, err := s.blogService.Store().Notifications(
		r.Context(),
		account.ID,
		r.URL.Query().Get("cursor"),
		parseBlogLimit(r),
	)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	items := make([]blogNotificationResponse, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, s.blogNotification(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":       items,
		"nextCursor":  page.NextCursor,
		"unreadCount": page.UnreadCount,
	})
}

func (s *Server) handleBlogUnreadCount(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusOK, map[string]any{"unreadCount": 0})
		return
	}
	count, err := s.blogService.Store().UnreadCount(r.Context(), account.ID)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"unreadCount": count})
}

func (s *Server) handleMarkBlogNotificationsRead(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	var body markBlogNotificationsReadBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.blogService.Store().MarkNotificationsRead(
		r.Context(),
		account.ID,
		strings.TrimSpace(body.PostID),
	); err != nil {
		writeBlogError(w, err)
		return
	}
	s.realtimeHub.Publish(account.ID, realtime.Event{
		Type: "blog.notification.read",
		Data: map[string]any{"postId": body.PostID},
	})
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleAdminListBlogPosts(w http.ResponseWriter, r *http.Request) {
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	page, err := s.blogService.Store().AdminList(
		r.Context(),
		r.URL.Query().Get("status"),
		r.URL.Query().Get("cursor"),
		parseBlogLimit(r),
	)
	if err != nil {
		writeBlogError(w, err)
		return
	}
	items := make([]adminBlogPostResponse, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, adminBlogPostResponse{
			blogPostResponse: s.blogPost(item.Post, item.Author.ID),
			ReportCount:      item.ReportCount,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"posts":      items,
		"nextCursor": page.NextCursor,
	})
}

func (s *Server) handleAdminHideBlogPost(w http.ResponseWriter, r *http.Request) {
	if s.blogService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "blog_not_configured"})
		return
	}
	if err := s.blogService.Store().AdminHide(r.Context(), r.PathValue("postID")); err != nil {
		writeBlogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleServeBlogMedia(w http.ResponseWriter, r *http.Request) {
	fileName := filepath.Base(strings.TrimPrefix(r.URL.Path, "/blog-media/"))
	if fileName == "." || fileName == "" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	filePath := filepath.Join(s.cfg.Storage.BlogDir, fileName)
	if _, err := os.Stat(filePath); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, filePath)
}

func (s *Server) blogPost(item blog.Post, viewerID string) blogPostResponse {
	recentComments := make([]blogCommentResponse, 0, len(item.RecentComments))
	for _, comment := range item.RecentComments {
		recentComments = append(recentComments, s.blogComment(comment, viewerID))
	}
	return blogPostResponse{
		Author:         s.socialUser(blogUserSummary(item.Author)),
		Body:           item.Body,
		CanDelete:      item.Author.ID == viewerID,
		CommentCount:   item.CommentCount,
		CoverURL:       s.blogCoverURL(item.CoverPath),
		ID:             item.ID,
		LikeCount:      item.LikeCount,
		LikedByMe:      item.LikedByMe,
		PublishedAt:    formatSocialTime(item.PublishedAt),
		RecentComments: recentComments,
		Status:         item.Status,
		Summary:        item.Summary,
		Title:          item.Title,
		Visibility:     item.Visibility,
		WordCount:      item.WordCount,
	}
}

func (s *Server) blogCoverURL(coverPath string) string {
	if strings.TrimSpace(coverPath) == "" {
		return ""
	}
	url := "/blog-media/" + filepath.Base(coverPath)
	if baseURL := strings.TrimRight(strings.TrimSpace(s.cfg.Server.PublicBaseURL), "/"); baseURL != "" {
		url = baseURL + url
	}
	return url
}

func (s *Server) blogComment(comment blog.Comment, viewerID string) blogCommentResponse {
	return blogCommentResponse{
		Author:    s.socialUser(blogUserSummary(comment.Author)),
		Body:      comment.Body,
		CanDelete: comment.Author.ID == viewerID,
		CreatedAt: formatSocialTime(comment.CreatedAt),
		ID:        comment.ID,
		PostID:    comment.PostID,
		ParentID:  comment.ParentID,
	}
}

func (s *Server) blogNotification(item blog.Notification) blogNotificationResponse {
	return blogNotificationResponse{
		Actor:     s.socialUser(blogUserSummary(item.Actor)),
		CommentID: item.CommentID,
		CreatedAt: formatSocialTime(item.CreatedAt),
		ID:        item.ID,
		PostID:    item.PostID,
		Preview:   item.Preview,
		Read:      item.Read,
		Type:      item.Type,
	}
}

func (s *Server) publishBlogCreated(r *http.Request, userID string, response blogPostResponse) {
	friends, err := s.socialStore.ListFriendIDs(r.Context(), userID)
	if err != nil {
		return
	}
	for _, friendID := range friends {
		s.realtimeHub.Publish(friendID, realtime.Event{
			Type: "blog.post.created",
			Data: response,
		})
	}
	s.realtimeHub.Publish(userID, realtime.Event{
		Type: "blog.post.created",
		Data: response,
	})
}

func (s *Server) publishBlogEventToFriends(
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

func blogUserSummary(user blog.UserSummary) social.UserSummary {
	return social.UserSummary{
		ID:          user.ID,
		Role:        user.Role,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		AvatarFile:  user.AvatarFile,
	}
}

func parseBlogLimit(r *http.Request) int {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > blog.MaxPageSize {
		return blog.DefaultPageSize
	}
	return limit
}

func writeBlogError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, blog.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_found"})
	case errors.Is(err, blog.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
	case errors.Is(err, blog.ErrBodyInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "blog_post_invalid"})
	case errors.Is(err, blog.ErrCommentInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "comment_invalid"})
	case errors.Is(err, blog.ErrCoverInvalid):
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "blog_cover_type_invalid"})
	case errors.Is(err, blog.ErrCoverTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "blog_cover_too_large"})
	case errors.Is(err, blog.ErrReportExists):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "report_exists"})
	default:
		log.Printf("blog request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "blog_request_failed"})
	}
}
