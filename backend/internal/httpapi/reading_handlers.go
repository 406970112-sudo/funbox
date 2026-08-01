package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/reading"
)

func registerReadingRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("GET /api/v1/reading/books", api.withOptionalAuth(api.withAPIPipeline(api.handleListReadingBooks)))
	mux.HandleFunc("GET /api/v1/reading/books/{bookID}", api.withOptionalAuth(api.withAPIPipeline(api.handleGetReadingBook)))
	mux.HandleFunc("GET /api/v1/reading/books/{bookID}/chapters", api.withOptionalAuth(api.withAPIPipeline(api.handleListReadingChapters)))
	mux.HandleFunc("GET /api/v1/reading/books/{bookID}/chapters/{chapterID}", api.withOptionalAuth(api.withAPIPipeline(api.handleGetReadingChapter)))
	mux.HandleFunc("GET /api/v1/reading/bookshelf", api.withAuth(api.withAPIPipeline(api.handleListReadingBookshelf)))
	mux.HandleFunc("PUT /api/v1/reading/bookshelf/{bookID}", api.withAuth(api.withAPIPipeline(api.handleAddReadingBookshelf)))
	mux.HandleFunc("DELETE /api/v1/reading/bookshelf/{bookID}", api.withAuth(api.withAPIPipeline(api.handleRemoveReadingBookshelf)))
	mux.HandleFunc("PUT /api/v1/reading/progress/{bookID}", api.withAuth(api.withAPIPipeline(api.handleSaveReadingProgress)))
	mux.HandleFunc("GET /api/v1/reading/bookmarks", api.withAuth(api.withAPIPipeline(api.handleListReadingBookmarks)))
	mux.HandleFunc("POST /api/v1/reading/bookmarks", api.withAuth(api.withAPIPipeline(api.handleCreateReadingBookmark)))
	mux.HandleFunc("DELETE /api/v1/reading/bookmarks/{bookmarkID}", api.withAuth(api.withAPIPipeline(api.handleDeleteReadingBookmark)))
}

func (s *Server) handleListReadingBooks(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	books, err := s.readingService.ListBooks(r.Context(), reading.BookFilter{
		Query:    r.URL.Query().Get("q"),
		Category: r.URL.Query().Get("category"),
	})
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"books": books})
}

func (s *Server) handleGetReadingBook(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	book, err := s.readingService.GetBook(r.Context(), strings.TrimSpace(r.PathValue("bookID")))
	if err != nil {
		writeReadingError(w, err)
		return
	}
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		if inBookshelf, err := s.readingService.Store().IsInBookshelf(r.Context(), account.ID, book.ID); err == nil {
			book.InBookshelf = inBookshelf
		}
		if progress, err := s.readingService.Store().GetProgress(r.Context(), account.ID, book.ID); err == nil {
			book.Progress = &progress
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"book": book})
}

func (s *Server) handleListReadingChapters(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	chapters, err := s.readingService.ListChapters(r.Context(), strings.TrimSpace(r.PathValue("bookID")))
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chapters": chapters})
}

func (s *Server) handleGetReadingChapter(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	userID := "anonymous"
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
	}
	content, err := s.readingService.GetChapterContent(r.Context(), strings.TrimSpace(r.PathValue("bookID")), strings.TrimSpace(r.PathValue("chapterID")), userID)
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, content)
}

func (s *Server) handleListReadingBookshelf(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	books, err := s.readingService.Store().ListBookshelf(r.Context(), account.ID, time.Now().UTC())
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"books": books})
}

func (s *Server) handleAddReadingBookshelf(w http.ResponseWriter, r *http.Request) {
	s.setReadingBookshelf(w, r, true)
}

func (s *Server) handleRemoveReadingBookshelf(w http.ResponseWriter, r *http.Request) {
	s.setReadingBookshelf(w, r, false)
}

func (s *Server) setReadingBookshelf(w http.ResponseWriter, r *http.Request, added bool) {
	if !s.ensureReadingService(w) {
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	bookID := strings.TrimSpace(r.PathValue("bookID"))
	if _, err := s.readingService.GetBook(r.Context(), bookID); err != nil {
		writeReadingError(w, err)
		return
	}
	if err := s.readingService.Store().SetBookshelf(r.Context(), account.ID, bookID, added, time.Now().UTC()); err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "inBookshelf": added})
}

type saveReadingProgressRequest struct {
	ChapterID       string    `json:"chapterId"`
	ChapterProgress float64   `json:"chapterProgress"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

func (s *Server) handleSaveReadingProgress(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	var request saveReadingProgressRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	bookID := strings.TrimSpace(r.PathValue("bookID"))
	if _, err := s.readingService.GetChapterContent(r.Context(), bookID, strings.TrimSpace(request.ChapterID), account.ID); err != nil {
		writeReadingError(w, err)
		return
	}
	if request.UpdatedAt.IsZero() {
		request.UpdatedAt = time.Now().UTC()
	}
	progress := reading.ReadingProgress{UserID: account.ID, BookID: bookID, ChapterID: strings.TrimSpace(request.ChapterID), ChapterProgress: request.ChapterProgress, UpdatedAt: request.UpdatedAt}
	if err := s.readingService.Store().SaveProgress(r.Context(), progress); err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, progress)
}

func (s *Server) handleListReadingBookmarks(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	bookmarks, err := s.readingService.Store().ListBookmarks(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("bookId")))
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"bookmarks": bookmarks})
}

type createReadingBookmarkRequest struct {
	BookID    string  `json:"bookId"`
	ChapterID string  `json:"chapterId"`
	Position  float64 `json:"position"`
	Note      string  `json:"note"`
}

func (s *Server) handleCreateReadingBookmark(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	var request createReadingBookmarkRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	if _, err := s.readingService.GetChapterContent(r.Context(), strings.TrimSpace(request.BookID), strings.TrimSpace(request.ChapterID), account.ID); err != nil {
		writeReadingError(w, err)
		return
	}
	bookmark, err := s.readingService.Store().CreateBookmark(r.Context(), reading.Bookmark{UserID: account.ID, BookID: strings.TrimSpace(request.BookID), ChapterID: strings.TrimSpace(request.ChapterID), Position: request.Position, Note: request.Note, CreatedAt: time.Now().UTC()})
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, bookmark)
}

func (s *Server) handleDeleteReadingBookmark(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	if err := s.readingService.Store().DeleteBookmark(r.Context(), account.ID, strings.TrimSpace(r.PathValue("bookmarkID"))); err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) ensureReadingService(w http.ResponseWriter) bool {
	if s.readingService != nil {
		return true
	}
	writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "reading_unavailable"})
	return false
}

func writeReadingError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, reading.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "reading_not_found"})
	case errors.Is(err, reading.ErrContentUnavailable), errors.Is(err, reading.ErrRightsRequired):
		writeJSON(w, http.StatusGone, map[string]any{"error": "reading_content_unavailable"})
	case errors.Is(err, reading.ErrLibraryDisabled):
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "reading_library_disabled"})
	case errors.Is(err, reading.ErrProviderUnavailable):
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "reading_provider_unavailable"})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "reading_request_failed", "detail": err.Error()})
	}
}
