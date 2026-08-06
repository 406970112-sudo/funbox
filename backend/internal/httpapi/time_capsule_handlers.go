package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"my-first-expo-app/backend/internal/realtime"
	"my-first-expo-app/backend/internal/timecapsule"
)

func registerTimeCapsuleRoutes(mux *http.ServeMux, api *Server) {
	if api.timeCapsuleStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/time-capsule/home", api.withAuth(api.withAPIPipeline(api.handleTimeCapsuleHome)))
	mux.HandleFunc("POST /api/v1/time-capsules", api.withAuth(api.withAPIPipeline(api.handleCreateTimeCapsule)))
	mux.HandleFunc("GET /api/v1/time-capsules/{capsuleID}", api.withAuth(api.withAPIPipeline(api.handleGetTimeCapsule)))
	mux.HandleFunc("PATCH /api/v1/time-capsules/{capsuleID}", api.withAuth(api.withAPIPipeline(api.handleUpdateTimeCapsule)))
	mux.HandleFunc("DELETE /api/v1/time-capsules/{capsuleID}", api.withAuth(api.withAPIPipeline(api.handleDeleteTimeCapsule)))
	mux.HandleFunc("POST /api/v1/time-capsules/{capsuleID}/contents", api.withAuth(api.withAPIPipeline(api.handleAddTimeCapsuleContent)))
	mux.HandleFunc("PATCH /api/v1/time-capsules/{capsuleID}/contents/{contentID}", api.withAuth(api.withAPIPipeline(api.handleUpdateTimeCapsuleContent)))
	mux.HandleFunc("DELETE /api/v1/time-capsules/{capsuleID}/contents/{contentID}", api.withAuth(api.withAPIPipeline(api.handleDeleteTimeCapsuleContent)))
	mux.HandleFunc("POST /api/v1/time-capsules/{capsuleID}/media", api.withAuth(api.withTimeCapsuleUploadPipeline(api.handleUploadTimeCapsuleMedia)))
	mux.HandleFunc("POST /api/v1/time-capsules/{capsuleID}/accept", api.withAuth(api.withAPIPipeline(api.handleAcceptTimeCapsuleInvite)))
	mux.HandleFunc("POST /api/v1/time-capsules/{capsuleID}/decline", api.withAuth(api.withAPIPipeline(api.handleDeclineTimeCapsuleInvite)))
	mux.HandleFunc("POST /api/v1/time-capsules/{capsuleID}/exit", api.withAuth(api.withAPIPipeline(api.handleExitTimeCapsule)))
	mux.HandleFunc("POST /api/v1/time-capsules/{capsuleID}/seal", api.withAuth(api.withAPIPipeline(api.handleSealTimeCapsule)))
	mux.HandleFunc("POST /api/v1/time-capsules/{capsuleID}/archive", api.withAuth(api.withAPIPipeline(api.handleArchiveTimeCapsule)))
	mux.HandleFunc("GET /api/v1/time-capsule/sources/birthday", api.withAuth(api.withAPIPipeline(api.handleTimeCapsuleBirthdaySource)))
	mux.HandleFunc("GET /api/v1/time-capsule/sources/days-left", api.withAuth(api.withAPIPipeline(api.handleTimeCapsuleDaysLeftSources)))
	mux.HandleFunc("GET /api/v1/time-capsule/sources/focus", api.withAuth(api.withAPIPipeline(api.handleTimeCapsuleFocusSources)))
	mux.HandleFunc("GET /api/v1/time-capsule/notifications", api.withAuth(api.withAPIPipeline(api.handleTimeCapsuleNotifications)))
	mux.HandleFunc("POST /api/v1/time-capsule/notifications/read", api.withAuth(api.withAPIPipeline(api.handleMarkTimeCapsuleNotificationsRead)))
	mux.HandleFunc("GET /time-capsule-media/{fileName}", api.handleServeTimeCapsuleMedia)
}

func (s *Server) withTimeCapsuleUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "time-capsule-upload") {
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, (20<<20)+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleTimeCapsuleHome(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if _, err := s.timeCapsuleStore.OpenDue(r.Context(), time.Now().UTC()); err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	home, err := s.timeCapsuleStore.ListHome(r.Context(), account.ID)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, home)
}

func (s *Server) handleCreateTimeCapsule(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input timecapsule.CapsuleInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	created, err := s.timeCapsuleStore.CreateCapsule(r.Context(), account.ID, input)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	if input.Mode == timecapsule.ModeJoint && input.FriendID != "" {
		s.realtimeHub.Publish(input.FriendID, realtime.Event{
			Type: "time_capsule.invited",
			Data: map[string]any{"capsuleId": created.ID, "title": created.Title},
		})
	}
	writeJSON(w, http.StatusCreated, map[string]any{"capsule": created})
}

func (s *Server) handleGetTimeCapsule(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if _, err := s.timeCapsuleStore.OpenDue(r.Context(), time.Now().UTC()); err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	capsule, err := s.timeCapsuleStore.GetCapsule(r.Context(), account.ID, r.PathValue("capsuleID"))
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	members, err := s.timeCapsuleStore.ListMembers(r.Context(), account.ID, capsule.ID)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	contents, err := s.timeCapsuleStore.ListContents(r.Context(), account.ID, capsule.ID, false)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	s.enrichTimeCapsuleContents(account.ID, contents)
	writeJSON(w, http.StatusOK, map[string]any{
		"capsule":  capsule,
		"members":  members,
		"contents": contents,
	})
}

func (s *Server) handleUpdateTimeCapsule(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input timecapsule.CapsuleInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	updated, err := s.timeCapsuleStore.UpdateCapsule(r.Context(), account.ID, r.PathValue("capsuleID"), input)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"capsule": updated})
}

func (s *Server) handleDeleteTimeCapsule(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.timeCapsuleStore.DeleteCapsule(r.Context(), account.ID, r.PathValue("capsuleID")); err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleAddTimeCapsuleContent(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input timecapsule.ContentInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.timeCapsuleStore.AddContent(r.Context(), account.ID, r.PathValue("capsuleID"), input)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"content": item})
}

func (s *Server) handleUpdateTimeCapsuleContent(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input timecapsule.ContentInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.timeCapsuleStore.UpdateContent(r.Context(), account.ID, r.PathValue("capsuleID"), r.PathValue("contentID"), input)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"content": item})
}

func (s *Server) handleDeleteTimeCapsuleContent(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.timeCapsuleStore.DeleteContent(r.Context(), account.ID, r.PathValue("capsuleID"), r.PathValue("contentID")); err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleUploadTimeCapsuleMedia(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	capsuleID := r.PathValue("capsuleID")
	if err := r.ParseMultipartForm(20 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_multipart"})
		return
	}
	kind := strings.TrimSpace(r.FormValue("kind"))
	if kind != timecapsule.ContentPhoto && kind != timecapsule.ContentVoice {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_media_kind"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing_file"})
		return
	}
	defer file.Close()

	extension := strings.ToLower(filepath.Ext(header.Filename))
	mimeType := strings.TrimSpace(header.Header.Get("Content-Type"))
	maxBytes := int64(5 << 20)
	if kind == timecapsule.ContentVoice {
		maxBytes = 20 << 20
	}
	if header.Size > maxBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "file_too_large"})
		return
	}
	contents, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "file_read_failed"})
		return
	}
	if int64(len(contents)) > maxBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "file_too_large"})
		return
	}
	allowedImage := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true}
	allowedVoice := map[string]bool{".m4a": true, ".wav": true, ".mp3": true}
	if kind == timecapsule.ContentPhoto && !allowedImage[extension] {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unsupported_file_type"})
		return
	}
	if kind == timecapsule.ContentVoice && !allowedVoice[extension] {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unsupported_file_type"})
		return
	}
	if mimeType == "" {
		if kind == timecapsule.ContentPhoto {
			mimeType = "image/jpeg"
		} else {
			mimeType = "audio/mpeg"
		}
	}

	width, height := 0, 0
	if kind == timecapsule.ContentPhoto {
		if config, _, decodeErr := image.DecodeConfig(strings.NewReader(string(contents))); decodeErr == nil {
			width = config.Width
			height = config.Height
		}
	}
	durationMS := 0
	if raw := strings.TrimSpace(r.FormValue("durationMs")); raw != "" {
		durationMS, _ = strconv.Atoi(raw)
	}

	dir := filepath.Join(s.cfg.Storage.TimeCapsuleDir, capsuleID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("create time capsule media directory failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "media_save_failed"})
		return
	}
	fileName := fmt.Sprintf("%s-%s%s", account.ID, uuid.NewString(), extension)
	filePath := filepath.Join(dir, fileName)
	if err := writeFileAtomically(filePath, contents); err != nil {
		log.Printf("save time capsule media failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "media_save_failed"})
		return
	}
	media, err := s.timeCapsuleStore.AddMedia(r.Context(), account.ID, capsuleID, timecapsule.MediaInput{
		Kind:       kind,
		FileName:   fileName,
		MimeType:   mimeType,
		ByteSize:   int64(len(contents)),
		Width:      width,
		Height:     height,
		DurationMS: durationMS,
	})
	if err != nil {
		_ = os.Remove(filePath)
		s.writeTimeCapsuleError(w, err)
		return
	}
	media.FilePath = ""
	draftURL := s.publicTimeCapsuleMediaURL(s.signTimeCapsuleMedia(fileName, capsuleID, account.ID))
	writeJSON(w, http.StatusCreated, map[string]any{"media": media, "draftUrl": draftURL})
}

func (s *Server) handleAcceptTimeCapsuleInvite(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	updated, err := s.timeCapsuleStore.AcceptInvite(r.Context(), account.ID, r.PathValue("capsuleID"))
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	s.realtimeHub.Publish(updated.CreatorID, realtime.Event{
		Type: "time_capsule.accepted",
		Data: map[string]any{"capsuleId": updated.ID, "title": updated.Title},
	})
	writeJSON(w, http.StatusOK, map[string]any{"capsule": updated})
}

func (s *Server) handleDeclineTimeCapsuleInvite(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.timeCapsuleStore.DeclineInvite(r.Context(), account.ID, r.PathValue("capsuleID")); err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleExitTimeCapsule(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.timeCapsuleStore.ExitCapsule(r.Context(), account.ID, r.PathValue("capsuleID")); err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleSealTimeCapsule(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	capsule, err := s.timeCapsuleStore.Seal(r.Context(), account.ID, r.PathValue("capsuleID"))
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	members, err := s.timeCapsuleStore.ListMembers(r.Context(), account.ID, capsule.ID)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	for _, member := range members {
		s.realtimeHub.Publish(member.UserID, realtime.Event{
			Type: "time_capsule.sealed",
			Data: map[string]any{"capsuleId": capsule.ID, "title": capsule.Title},
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"capsule": capsule})
}

func (s *Server) handleArchiveTimeCapsule(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	capsule, err := s.timeCapsuleStore.Archive(r.Context(), account.ID, r.PathValue("capsuleID"))
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"capsule": capsule})
}

func (s *Server) handleTimeCapsuleBirthdaySource(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	birthday, err := s.timeCapsuleStore.ListBirthdaySource(r.Context(), account.ID)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"birthday": birthday})
}

func (s *Server) handleTimeCapsuleDaysLeftSources(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.timeCapsuleStore.ListDaysLeftSources(r.Context(), account.ID)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": items})
}

func (s *Server) handleTimeCapsuleFocusSources(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.timeCapsuleStore.ListFocusSources(r.Context(), account.ID)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": items})
}

func (s *Server) handleTimeCapsuleNotifications(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.timeCapsuleStore.ListNotifications(r.Context(), account.ID, 50)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notifications": items})
}

func (s *Server) handleMarkTimeCapsuleNotificationsRead(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.timeCapsuleStore.MarkNotificationsRead(r.Context(), account.ID, body.IDs); err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleServeTimeCapsuleMedia(w http.ResponseWriter, r *http.Request) {
	fileName := filepath.Base(r.PathValue("fileName"))
	if fileName == "." || fileName == "" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	capsuleID, userID, ok := s.validateTimeCapsuleMediaToken(fileName, r.URL.Query().Get("token"))
	if !ok {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "invalid_media_token"})
		return
	}
	media, err := s.timeCapsuleStore.GetMediaByFileName(r.Context(), fileName)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	if media.CapsuleID != capsuleID {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "invalid_media_token"})
		return
	}
	capsule, err := s.timeCapsuleStore.GetCapsule(r.Context(), userID, media.CapsuleID)
	if err != nil {
		s.writeTimeCapsuleError(w, err)
		return
	}
	if capsule.Status == timecapsule.StatusSealed || (capsule.Status == timecapsule.StatusDraft && media.UserID != userID) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "media_not_available"})
		return
	}
	filePath := filepath.Join(s.cfg.Storage.TimeCapsuleDir, media.CapsuleID, filepath.Base(media.FilePath))
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

func (s *Server) enrichTimeCapsuleContents(userID string, items []timecapsule.ContentWithMedia) {
	for i := range items {
		if items[i].MediaID != "" && items[i].FileName != "" {
			items[i].MediaURL = s.publicTimeCapsuleMediaURL(
				s.signTimeCapsuleMedia(items[i].FileName, items[i].CapsuleID, userID),
			)
		}
	}
}

func (s *Server) writeTimeCapsuleError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, timecapsule.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "time_capsule_not_found"})
	case errors.Is(err, timecapsule.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "time_capsule_forbidden"})
	case errors.Is(err, timecapsule.ErrInvalidInput):
		log.Printf("time capsule invalid input: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "time_capsule_invalid_input"})
	default:
		log.Printf("time capsule error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}

func (s *Server) timeCapsuleMediaSecret() []byte {
	secret := strings.TrimSpace(s.cfg.Auth.TimeCapsuleSecret)
	if secret == "" {
		secret = "funbox-time-capsule-media-secret"
	}
	return []byte(secret)
}

func (s *Server) signTimeCapsuleMedia(fileName, capsuleID, userID string) string {
	expires := time.Now().Add(30 * time.Minute).Unix()
	payload := fmt.Sprintf("%s:%s:%d", capsuleID, userID, expires)
	mac := hmac.New(sha256.New, s.timeCapsuleMediaSecret())
	_, _ = mac.Write([]byte(payload + ":" + fileName))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return "/time-capsule-media/" + url.PathEscape(fileName) + "?token=" +
		url.QueryEscape(base64.RawURLEncoding.EncodeToString([]byte(payload))+"."+signature)
}

func (s *Server) validateTimeCapsuleMediaToken(fileName, token string) (string, string, bool) {
	if strings.TrimSpace(token) == "" {
		return "", "", false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return "", "", false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", "", false
	}
	fields := strings.Split(string(payload), ":")
	if len(fields) != 3 {
		return "", "", false
	}
	expires, err := strconv.ParseInt(fields[2], 10, 64)
	if err != nil || time.Now().Unix() > expires {
		return "", "", false
	}
	mac := hmac.New(sha256.New, s.timeCapsuleMediaSecret())
	_, _ = mac.Write([]byte(string(payload) + ":" + fileName))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return "", "", false
	}
	return fields[0], fields[1], true
}

func (s *Server) publicTimeCapsuleMediaURL(path string) string {
	if baseURL := strings.TrimRight(s.cfg.Server.PublicBaseURL, "/"); baseURL != "" {
		return baseURL + path
	}
	return path
}
