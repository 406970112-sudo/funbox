package httpapi

import (
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/diary"
)

type diaryPasswordBody struct {
	Action  string `json:"action"`
	Current string `json:"current"`
	New     string `json:"new"`
}

func registerDiaryRoutes(mux *http.ServeMux, api *Server) {
	if api.diaryService == nil {
		return
	}
	mux.HandleFunc("POST /api/v1/diary/notebooks", api.withAuth(api.withAPIPipeline(api.handleCreateDiaryNotebook)))
	mux.HandleFunc("GET /api/v1/diary/notebooks", api.withAuth(api.withAPIPipeline(api.handleListDiaryNotebooks)))
	mux.HandleFunc("GET /api/v1/diary/notebooks/{notebookID}", api.withAuth(api.withAPIPipeline(api.handleGetDiaryNotebook)))
	mux.HandleFunc("PATCH /api/v1/diary/notebooks/{notebookID}", api.withAuth(api.withAPIPipeline(api.handleUpdateDiaryNotebook)))
	mux.HandleFunc("DELETE /api/v1/diary/notebooks/{notebookID}", api.withAuth(api.withAPIPipeline(api.handleDeleteDiaryNotebook)))
	mux.HandleFunc("POST /api/v1/diary/notebooks/{notebookID}/password", api.withAuth(api.withAPIPipeline(api.handleDiaryPassword)))
	mux.HandleFunc("POST /api/v1/diary/notebooks/{notebookID}/unlock", api.withAuth(api.withRateLimitedAPIPipeline("diary-unlock", api.handleDiaryUnlock)))
	mux.HandleFunc("POST /api/v1/diary/notebooks/{notebookID}/lock", api.withAuth(api.withAPIPipeline(api.handleDiaryLock)))
	mux.HandleFunc("GET /api/v1/diary/notebooks/{notebookID}/entries", api.withAuth(api.withAPIPipeline(api.handleGetDiaryEntry)))
	mux.HandleFunc("PUT /api/v1/diary/notebooks/{notebookID}/entries/{date}", api.withAuth(api.withAPIPipeline(api.handleUpsertDiaryEntry)))
	mux.HandleFunc("DELETE /api/v1/diary/notebooks/{notebookID}/entries/{date}", api.withAuth(api.withAPIPipeline(api.handleDeleteDiaryEntry)))
	mux.HandleFunc("GET /api/v1/diary/notebooks/{notebookID}/calendar", api.withAuth(api.withAPIPipeline(api.handleDiaryCalendar)))
	mux.HandleFunc("GET /api/v1/diary/notebooks/{notebookID}/search", api.withAuth(api.withAPIPipeline(api.handleDiarySearch)))
	mux.HandleFunc("GET /api/v1/diary/notebooks/{notebookID}/stats", api.withAuth(api.withAPIPipeline(api.handleDiaryStats)))
	mux.HandleFunc("GET /api/v1/diary/notebooks/{notebookID}/export", api.withAuth(api.withAPIPipeline(api.handleDiaryExport)))
	mux.HandleFunc("POST /api/v1/diary/notebooks/{notebookID}/entries/{date}/media", api.withAuth(api.withDiaryUploadPipeline(api.handleDiaryMediaUpload)))
	mux.HandleFunc("DELETE /api/v1/diary/notebooks/{notebookID}/media/{mediaID}", api.withAuth(api.withAPIPipeline(api.handleDiaryMediaDelete)))
	mux.HandleFunc("GET /api/v1/diary/notebooks/{notebookID}/media/{mediaID}", api.withAuth(api.handleDiaryMediaServe))
}

func (s *Server) withDiaryUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "diary-upload") {
			return
		}
		maxBytes := s.cfg.Storage.MaxDiaryImageBytes
		maxImages := s.cfg.Storage.MaxDiaryImages
		if maxBytes <= 0 {
			maxBytes = diary.MaxImageBytes
		}
		if maxImages <= 0 {
			maxImages = diary.MaxDiaryImages
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes*int64(maxImages)+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleCreateDiaryNotebook(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input diary.NotebookInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.diaryService.Store().CreateNotebook(r.Context(), account.ID, input)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"notebook": s.diaryNotebookResponse(item)})
}

func (s *Server) handleListDiaryNotebooks(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.diaryService.Store().ListNotebooks(r.Context(), account.ID)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, s.diaryNotebookResponse(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"notebooks": result})
}

func (s *Server) handleGetDiaryNotebook(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.diaryService.Store().GetNotebook(r.Context(), account.ID, r.PathValue("notebookID"))
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notebook": s.diaryNotebookResponse(item)})
}

func (s *Server) handleUpdateDiaryNotebook(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input diary.NotebookInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.diaryService.Store().UpdateNotebook(r.Context(), account.ID, r.PathValue("notebookID"), input)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notebook": s.diaryNotebookResponse(item)})
}

func (s *Server) handleDeleteDiaryNotebook(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	notebookID := r.PathValue("notebookID")
	notebook, err := s.diaryService.Store().GetNotebook(r.Context(), account.ID, notebookID)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	if notebook.HasPassword {
		if _, ok := s.requireDiaryUnlock(w, r, account.ID, notebookID); !ok {
			return
		}
	}
	if err := s.diaryService.Store().DeleteNotebook(r.Context(), account.ID, notebookID); err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleDiaryPassword(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var body diaryPasswordBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.diaryService.Store().SetPassword(
		r.Context(),
		account.ID,
		r.PathValue("notebookID"),
		diary.PasswordInput{Action: body.Action, Current: body.Current, New: body.New},
	)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notebook": s.diaryNotebookResponse(item)})
}

func (s *Server) handleDiaryUnlock(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var body diaryUnlockBody
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	token, err := s.diaryService.Store().Unlock(
		r.Context(),
		account.ID,
		r.PathValue("notebookID"),
		body.Password,
	)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"unlockToken":      token,
		"expiresInSeconds": 1800,
	})
}

type diaryUnlockBody struct {
	Password string `json:"password"`
}

func (s *Server) handleDiaryLock(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	token := strings.TrimSpace(r.Header.Get("X-Diary-Unlock-Token"))
	if err := s.diaryService.Store().Lock(r.Context(), account.ID, r.PathValue("notebookID"), token); err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleGetDiaryEntry(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	notebookID := r.PathValue("notebookID")
	date := strings.TrimSpace(r.URL.Query().Get("date"))
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	dataKey, ok := s.requireDiaryUnlock(w, r, account.ID, notebookID)
	if !ok {
		return
	}
	item, err := s.diaryService.Store().GetEntry(r.Context(), account.ID, notebookID, date, dataKey)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": s.diaryEntryResponse(item)})
}

func (s *Server) handleUpsertDiaryEntry(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	notebookID := r.PathValue("notebookID")
	date := r.PathValue("date")
	dataKey, ok := s.requireDiaryUnlock(w, r, account.ID, notebookID)
	if !ok {
		return
	}
	var input diary.EntryInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.diaryService.Store().UpsertEntry(r.Context(), account.ID, notebookID, date, input, dataKey)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": s.diaryEntryResponse(item)})
}

func (s *Server) handleDeleteDiaryEntry(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	notebookID := r.PathValue("notebookID")
	if _, ok := s.requireDiaryUnlock(w, r, account.ID, notebookID); !ok {
		return
	}
	if err := s.diaryService.Store().DeleteEntry(r.Context(), account.ID, notebookID, r.PathValue("date")); err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleDiaryCalendar(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	month := strings.TrimSpace(r.URL.Query().Get("month"))
	if month == "" {
		month = time.Now().Format("2006-01")
	}
	snapshot, err := s.diaryService.Store().Calendar(r.Context(), account.ID, r.PathValue("notebookID"), month)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleDiarySearch(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	notebookID := r.PathValue("notebookID")
	dataKey, ok := s.requireDiaryUnlock(w, r, account.ID, notebookID)
	if !ok {
		return
	}
	items, err := s.diaryService.Store().Search(
		r.Context(),
		account.ID,
		notebookID,
		r.URL.Query().Get("q"),
		dataKey,
		parseDiaryLimit(r),
	)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, s.diaryEntryResponse(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": result})
}

func (s *Server) handleDiaryStats(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	stats, err := s.diaryService.Store().Stats(r.Context(), account.ID, r.PathValue("notebookID"))
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) handleDiaryExport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	notebookID := r.PathValue("notebookID")
	notebook, err := s.diaryService.Store().GetNotebook(r.Context(), account.ID, notebookID)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	dataKey, ok := s.requireDiaryUnlock(w, r, account.ID, notebookID)
	if !ok {
		return
	}
	entries, err := s.diaryService.Store().ExportEntries(r.Context(), account.ID, notebookID, dataKey)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	var builder strings.Builder
	fmt.Fprintf(&builder, "# 日记本：%s\n\n", notebook.Name)
	for _, entry := range entries {
		fmt.Fprintf(&builder, "## %s\n\n", entry.EntryDate)
		if entry.Mood != "" || entry.Weather != "" {
			fmt.Fprintf(&builder, "心情：%s  天气：%s\n\n", moodLabel(entry.Mood), weatherLabel(entry.Weather))
		}
		if entry.Title != "" {
			fmt.Fprintf(&builder, "### %s\n\n", entry.Title)
		}
		builder.WriteString(entry.Content)
		builder.WriteString("\n\n")
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=diary-%s.md", notebookID))
	_, _ = w.Write([]byte(builder.String()))
}

func (s *Server) handleDiaryMediaUpload(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	notebookID := r.PathValue("notebookID")
	date := r.PathValue("date")
	dataKey, ok := s.requireDiaryUnlock(w, r, account.ID, notebookID)
	if !ok {
		return
	}
	maxBytes := s.cfg.Storage.MaxDiaryImageBytes
	if maxBytes <= 0 {
		maxBytes = diary.MaxImageBytes
	}
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_diary_upload"})
		return
	}
	uploads := make([]diary.Upload, 0, len(r.MultipartForm.File["images"]))
	for _, header := range r.MultipartForm.File["images"] {
		file, err := header.Open()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "diary_image_read_failed"})
			return
		}
		defer file.Close()
		uploads = append(uploads, diary.Upload{Reader: file})
	}
	entry, err := s.diaryService.AddMedia(r.Context(), account.ID, notebookID, date, uploads, dataKey)
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entry": s.diaryEntryResponse(entry)})
}

func (s *Server) handleDiaryMediaDelete(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	notebookID := r.PathValue("notebookID")
	if _, ok := s.requireDiaryUnlock(w, r, account.ID, notebookID); !ok {
		return
	}
	if _, err := s.diaryService.DeleteMedia(r.Context(), account.ID, notebookID, r.PathValue("mediaID")); err != nil {
		s.writeDiaryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleDiaryMediaServe(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	notebookID := r.PathValue("notebookID")
	if _, ok := s.requireDiaryUnlock(w, r, account.ID, notebookID); !ok {
		return
	}
	media, err := s.diaryService.Store().GetMedia(r.Context(), account.ID, notebookID, r.PathValue("mediaID"))
	if err != nil {
		s.writeDiaryError(w, err)
		return
	}
	file, err := os.Open(s.diaryService.MediaPath(media))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "diary_media_not_found"})
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "read_diary_media_failed"})
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Type", media.ContentType)
	http.ServeContent(w, r, media.StoredName, info.ModTime(), file)
}

func (s *Server) requireDiaryUnlock(w http.ResponseWriter, r *http.Request, userID string, notebookID string) ([]byte, bool) {
	notebook, err := s.diaryService.Store().GetNotebook(r.Context(), userID, notebookID)
	if err != nil {
		s.writeDiaryError(w, err)
		return nil, false
	}
	if !notebook.HasPassword {
		return nil, true
	}
	token := strings.TrimSpace(r.Header.Get("X-Diary-Unlock-Token"))
	dataKey, err := s.diaryService.Store().GetDataKey(r.Context(), userID, notebookID, token)
	if err != nil {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "diary_locked"})
		return nil, false
	}
	return dataKey, true
}

func (s *Server) diaryNotebookResponse(item diary.Notebook) map[string]any {
	return map[string]any{
		"coverColor":      item.CoverColor,
		"createdAt":       item.CreatedAt.Format(time.RFC3339),
		"currentStreak":   item.CurrentStreak,
		"entryCount":      item.EntryCount,
		"hasPassword":     item.HasPassword,
		"id":              item.ID,
		"lastEntryDate":   item.LastEntryDate,
		"name":            item.Name,
		"passwordVersion": item.PasswordVersion,
		"reminderEnabled": item.ReminderEnabled,
		"reminderTime":    item.ReminderTime,
		"status":          item.Status,
		"updatedAt":       item.UpdatedAt.Format(time.RFC3339),
	}
}

func (s *Server) diaryEntryResponse(item diary.Entry) map[string]any {
	media := make([]map[string]any, 0, len(item.Media))
	for _, itemMedia := range item.Media {
		media = append(media, map[string]any{
			"contentType": itemMedia.ContentType,
			"height":      itemMedia.Height,
			"id":          itemMedia.ID,
			"url":         diary.MediaURL(item.NotebookID, itemMedia, s.cfg.Server.PublicBaseURL),
			"width":       itemMedia.Width,
		})
	}
	return map[string]any{
		"content":    item.Content,
		"createdAt":  item.CreatedAt.Format(time.RFC3339),
		"date":       item.EntryDate,
		"id":         item.ID,
		"media":      media,
		"mood":       item.Mood,
		"notebookId": item.NotebookID,
		"title":      item.Title,
		"updatedAt":  item.UpdatedAt.Format(time.RFC3339),
		"weather":    item.Weather,
	}
}

func parseDiaryLimit(r *http.Request) int {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > diary.MaxPageSize {
		return diary.DefaultPageSize
	}
	return limit
}

func moodLabel(mood string) string {
	switch mood {
	case "happy":
		return "开心"
	case "calm":
		return "平静"
	case "tired":
		return "疲惫"
	case "sad":
		return "难过"
	case "angry":
		return "生气"
	default:
		return "未记录"
	}
}

func weatherLabel(weather string) string {
	switch weather {
	case "sunny":
		return "晴"
	case "cloudy":
		return "多云"
	case "rainy":
		return "雨"
	case "windy":
		return "风"
	default:
		return "未记录"
	}
}

func (s *Server) writeDiaryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, diary.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "diary_not_found"})
	case errors.Is(err, diary.ErrForbidden):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
	case errors.Is(err, diary.ErrLocked):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "diary_locked"})
	case errors.Is(err, diary.ErrPasswordInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "diary_password_invalid"})
	case errors.Is(err, diary.ErrPasswordMismatch):
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "diary_password_mismatch"})
	case errors.Is(err, diary.ErrNoPassword):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "diary_no_password"})
	case errors.Is(err, diary.ErrPasswordSet):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "diary_password_already_set"})
	case errors.Is(err, diary.ErrDateInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "diary_date_invalid"})
	case errors.Is(err, diary.ErrImageTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "diary_image_too_large"})
	case errors.Is(err, diary.ErrImagesTooMany):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "diary_images_too_many"})
	case errors.Is(err, diary.ErrImageTypeInvalid):
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "diary_image_type_invalid"})
	case errors.Is(err, diary.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "diary_invalid_input"})
	default:
		log.Printf("diary request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "diary_request_failed"})
	}
}
