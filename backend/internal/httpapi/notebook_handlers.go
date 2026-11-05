package httpapi

import (
	"bytes"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/notebook"
)

func registerNotebookRoutes(mux *http.ServeMux, api *Server) {
	if api.notebookService == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/notebook/security", api.withAuth(api.withAPIPipeline(api.handleNotebookSecurity)))
	mux.HandleFunc("POST /api/v1/notebook/security/password", api.withAuth(api.withAPIPipeline(api.handleNotebookPassword)))
	mux.HandleFunc("POST /api/v1/notebook/security/unlock", api.withAuth(api.withRateLimitedAPIPipeline("notebook-unlock", api.handleNotebookUnlock)))
	mux.HandleFunc("POST /api/v1/notebook/security/lock", api.withAuth(api.withAPIPipeline(api.handleNotebookLock)))
	mux.HandleFunc("POST /api/v1/notebook/security/reset", api.withAuth(api.withAPIPipeline(api.handleNotebookReset)))
	mux.HandleFunc("GET /api/v1/notebook/books", api.withAuth(api.withAPIPipeline(api.handleListNotebookBooks)))
	mux.HandleFunc("POST /api/v1/notebook/books", api.withAuth(api.withAPIPipeline(api.handleCreateNotebookBook)))
	mux.HandleFunc("PATCH /api/v1/notebook/books/{bookID}", api.withAuth(api.withAPIPipeline(api.handleUpdateNotebookBook)))
	mux.HandleFunc("DELETE /api/v1/notebook/books/{bookID}", api.withAuth(api.withAPIPipeline(api.handleDeleteNotebookBook)))
	mux.HandleFunc("GET /api/v1/notebook/notes", api.withAuth(api.withAPIPipeline(api.handleListNotebookNotes)))
	mux.HandleFunc("POST /api/v1/notebook/notes", api.withAuth(api.withAPIPipeline(api.handleCreateNotebookNote)))
	mux.HandleFunc("GET /api/v1/notebook/notes/{noteID}", api.withAuth(api.withAPIPipeline(api.handleGetNotebookNote)))
	mux.HandleFunc("PATCH /api/v1/notebook/notes/{noteID}", api.withAuth(api.withAPIPipeline(api.handleUpdateNotebookNote)))
	mux.HandleFunc("DELETE /api/v1/notebook/notes/{noteID}", api.withAuth(api.withAPIPipeline(api.handleDeleteNotebookNote)))
	mux.HandleFunc("POST /api/v1/notebook/notes/{noteID}/media", api.withAuth(api.withNotebookMediaPipeline(api.handleUploadNotebookMedia)))
	mux.HandleFunc("GET /api/v1/notebook/media/{mediaID}", api.withAuth(api.handleServeNotebookMedia))
	mux.HandleFunc("DELETE /api/v1/notebook/media/{mediaID}", api.withAuth(api.withAPIPipeline(api.handleDeleteNotebookMedia)))
}

func (s *Server) withNotebookMediaPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "notebook-media") {
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, notebook.MaxAudioBytes+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleNotebookSecurity(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	status, err := s.notebookService.Store().SecurityStatus(r.Context(), account.ID, notebookUnlockToken(r))
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"security": status})
}

func (s *Server) handleNotebookPassword(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input notebook.PasswordInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	status, err := s.notebookService.Store().SetPassword(r.Context(), account.ID, input)
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"security": status})
}

func (s *Server) handleNotebookUnlock(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := decodeJSONBody(r, &body); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	token, expiresIn, err := s.notebookService.Store().Unlock(r.Context(), account.ID, body.Password)
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"unlockToken":      token,
		"expiresInSeconds": expiresIn,
	})
}

func (s *Server) handleNotebookLock(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	s.notebookService.Store().Lock(account.ID, notebookUnlockToken(r))
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleNotebookReset(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input notebook.ResetInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if err := s.notebookService.ResetEncryption(r.Context(), account.ID, input.Confirm); err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func notebookUnlockToken(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get("X-Notebook-Unlock-Token"))
}

func (s *Server) notebookDataKey(r *http.Request, userID string) []byte {
	token := notebookUnlockToken(r)
	if token == "" {
		return nil
	}
	dataKey, err := s.notebookService.Store().GetDataKey(userID, token)
	if err != nil {
		return nil
	}
	return dataKey
}

func (s *Server) handleListNotebookBooks(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	books, err := s.notebookService.Store().ListBooks(r.Context(), account.ID)
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"books": books})
}

func (s *Server) handleCreateNotebookBook(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input notebook.BookInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	book, err := s.notebookService.Store().CreateBook(r.Context(), account.ID, input)
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"book": book})
}

func (s *Server) handleUpdateNotebookBook(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input notebook.BookInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	book, err := s.notebookService.Store().UpdateBook(r.Context(), account.ID, r.PathValue("bookID"), input)
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"book": book})
}

func (s *Server) handleDeleteNotebookBook(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.notebookService.Store().DeleteBook(r.Context(), account.ID, r.PathValue("bookID")); err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleListNotebookNotes(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	favorite := r.URL.Query().Get("favorite") == "1" || strings.EqualFold(r.URL.Query().Get("favorite"), "true")
	result, err := s.notebookService.Store().ListNotes(r.Context(), account.ID, notebook.NoteFilter{
		BookID:   strings.TrimSpace(r.URL.Query().Get("bookId")),
		Query:    r.URL.Query().Get("q"),
		Tag:      r.URL.Query().Get("tag"),
		Favorite: favorite,
		Limit:    parseNotebookLimit(r),
		Offset:   parseNotebookOffset(r),
	})
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	for i := range result.Notes {
		result.Notes[i] = s.notebookNoteResponse(result.Notes[i])
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleCreateNotebookNote(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input notebook.NoteInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	note, err := s.notebookService.Store().CreateNoteWithDataKey(r.Context(), account.ID, input, s.notebookDataKey(r, account.ID))
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"note": s.notebookNoteResponse(note)})
}

func (s *Server) handleGetNotebookNote(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	noteID := r.PathValue("noteID")
	var note notebook.Note
	var err error
	if dataKey := s.notebookDataKey(r, account.ID); len(dataKey) > 0 {
		note, err = s.notebookService.Store().GetNoteWithDataKey(r.Context(), account.ID, noteID, dataKey)
	} else {
		note, err = s.notebookService.Store().GetNote(r.Context(), account.ID, noteID)
	}
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"note": s.notebookNoteResponse(note)})
}

func (s *Server) handleUpdateNotebookNote(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var patch notebook.NotePatch
	if err := decodeJSONBody(r, &patch); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	note, err := s.notebookService.UpdateNote(r.Context(), account.ID, r.PathValue("noteID"), patch, s.notebookDataKey(r, account.ID))
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"note": s.notebookNoteResponse(note)})
}

func (s *Server) handleDeleteNotebookNote(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.notebookService.Store().DeleteNote(r.Context(), account.ID, r.PathValue("noteID")); err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleUploadNotebookMedia(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := r.ParseMultipartForm(notebook.MaxAudioBytes + (1 << 20)); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	kind := strings.TrimSpace(r.FormValue("kind"))
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "file_required"})
		return
	}
	defer file.Close()
	media, err := s.notebookService.UploadMedia(r.Context(), account.ID, r.PathValue("noteID"), kind, header.Filename, file, s.notebookDataKey(r, account.ID))
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"media": s.notebookMediaResponse(media)})
}

func (s *Server) handleDeleteNotebookMedia(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.notebookService.DeleteMedia(r.Context(), account.ID, r.PathValue("mediaID"), s.notebookDataKey(r, account.ID)); err != nil {
		s.writeNotebookError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleServeNotebookMedia(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	media, contents, err := s.notebookService.ReadMedia(r.Context(), account.ID, r.PathValue("mediaID"), s.notebookDataKey(r, account.ID))
	if err != nil {
		s.writeNotebookError(w, err)
		return
	}
	w.Header().Set("Content-Type", media.ContentType)
	w.Header().Set("Content-Disposition", "inline")
	if media.Encrypted {
		w.Header().Set("Cache-Control", "private, no-store")
	} else {
		w.Header().Set("Cache-Control", "private, max-age=300")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, media.ID, media.CreatedAt, bytes.NewReader(contents))
}

func (s *Server) notebookNoteResponse(note notebook.Note) notebook.Note {
	if note.Media == nil {
		note.Media = []notebook.Media{}
	}
	for i := range note.Media {
		note.Media[i] = s.notebookMediaResponse(note.Media[i])
	}
	return note
}

func (s *Server) notebookMediaResponse(media notebook.Media) notebook.Media {
	media.URL = notebook.MediaURL(media)
	return media
}

func (s *Server) writeNotebookError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, notebook.ErrBookNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "notebook_book_not_found"})
	case errors.Is(err, notebook.ErrNoteNotFound), errors.Is(err, notebook.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "notebook_note_not_found"})
	case errors.Is(err, notebook.ErrBookNameExists):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "notebook_book_name_exists"})
	case errors.Is(err, notebook.ErrBookNotEmpty):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "notebook_book_not_empty"})
	case errors.Is(err, notebook.ErrBookLimitReached):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "notebook_book_limit_reached"})
	case errors.Is(err, notebook.ErrMediaLimitReached):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "notebook_media_limit_reached"})
	case errors.Is(err, notebook.ErrMediaTooLarge):
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "notebook_media_too_large"})
	case errors.Is(err, notebook.ErrMediaTypeInvalid):
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "notebook_media_type_invalid"})
	case errors.Is(err, notebook.ErrLocked):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "notebook_note_locked"})
	case errors.Is(err, notebook.ErrPasswordMismatch):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "notebook_note_password_mismatch"})
	case errors.Is(err, notebook.ErrPasswordInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "notebook_note_password_invalid"})
	case errors.Is(err, notebook.ErrPasswordNotSet):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "notebook_note_password_not_set"})
	case errors.Is(err, notebook.ErrPasswordAlreadySet):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "notebook_note_password_already_set"})
	case errors.Is(err, notebook.ErrResetConfirmation):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "notebook_reset_confirmation_invalid"})
	case errors.Is(err, notebook.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "notebook_invalid_input"})
	default:
		log.Printf("notebook handler error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "notebook_internal_error"})
	}
}

func parseNotebookLimit(r *http.Request) int {
	value, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("limit")))
	if err != nil || value <= 0 {
		return notebook.DefaultPageSize
	}
	if value > notebook.MaxPageSize {
		return notebook.MaxPageSize
	}
	return value
}

func parseNotebookOffset(r *http.Request) int {
	value, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("offset")))
	if err != nil || value < 0 {
		return 0
	}
	return value
}
