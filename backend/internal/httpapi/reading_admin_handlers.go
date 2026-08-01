package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/reading"
)

func registerAdminReadingRoutes(mux *http.ServeMux, api *Server) {
	adminJSON := func(handler http.HandlerFunc) http.HandlerFunc {
		guarded := func(w http.ResponseWriter, r *http.Request) {
			if !api.ensureReadingService(w) {
				return
			}
			handler(w, r)
		}
		return api.withAuth(api.withAdmin(api.withAPIPipeline(guarded)))
	}
	mux.HandleFunc("GET /api/v1/admin/reading/books", adminJSON(api.handleListAdminReadingBooks))
	mux.HandleFunc("GET /api/v1/admin/reading/books/{bookID}/chapters", adminJSON(api.handleListAdminReadingChapters))
	mux.HandleFunc("GET /api/v1/admin/reading/books/{bookID}/chapters/{chapterID}", adminJSON(api.handleGetAdminReadingChapter))
	mux.HandleFunc("POST /api/v1/admin/reading/imports", api.withAuth(api.withAdmin(api.withReadingUploadPipeline(api.handleAdminReadingImport))))
	mux.HandleFunc("GET /api/v1/admin/reading/imports/{importID}", adminJSON(api.handleGetAdminReadingImport))
	mux.HandleFunc("PATCH /api/v1/admin/reading/books/{bookID}", adminJSON(api.handlePatchAdminReadingBook))
	mux.HandleFunc("PATCH /api/v1/admin/reading/books/{bookID}/chapters/{chapterID}", adminJSON(api.handlePatchAdminReadingChapter))
	mux.HandleFunc("POST /api/v1/admin/reading/books/{bookID}/publish", adminJSON(api.handlePublishAdminReadingBook))
	mux.HandleFunc("POST /api/v1/admin/reading/books/{bookID}/hide", adminJSON(api.handleHideAdminReadingBook))
	mux.HandleFunc("POST /api/v1/admin/reading/books/{bookID}/remove", adminJSON(api.handleRemoveAdminReadingBook))
	mux.HandleFunc("GET /api/v1/admin/reading/provider-sync-runs", adminJSON(api.handleListAdminReadingSyncRuns))
	mux.HandleFunc("POST /api/v1/admin/reading/providers/{providerKey}/sync", adminJSON(api.handleAdminReadingProviderSync))
}

func (s *Server) handleListAdminReadingBooks(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	filter := reading.BookFilter{Query: r.URL.Query().Get("q")}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		filter.Status = reading.PublishStatus(status)
	}
	books, err := s.readingService.Store().ListBooks(r.Context(), filter, time.Now().UTC())
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"books": books})
}

func (s *Server) handleAdminReadingImport(w http.ResponseWriter, r *http.Request) {
	if !s.ensureReadingService(w) {
		return
	}
	if s.readingImporter == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "reading_import_unavailable"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "reading_file_required"})
		return
	}
	defer file.Close()
	account, _ := authenticatedUserFromContext(r.Context())
	result, err := s.readingImporter.Import(r.Context(), file, header.Filename, account.ID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "reading_import_failed", "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) handleListAdminReadingChapters(w http.ResponseWriter, r *http.Request) {
	chapters, err := s.readingService.Store().ListChapters(r.Context(), strings.TrimSpace(r.PathValue("bookID")))
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chapters": chapters})
}

func (s *Server) handleGetAdminReadingChapter(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	content, err := s.readingService.GetAdminChapterContent(r.Context(), strings.TrimSpace(r.PathValue("bookID")), strings.TrimSpace(r.PathValue("chapterID")), account.ID)
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, content)
}

func (s *Server) handleGetAdminReadingImport(w http.ResponseWriter, r *http.Request) {
	job, err := s.readingService.Store().GetImportJob(r.Context(), strings.TrimSpace(r.PathValue("importID")))
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, job)
}

type contentRightsRequest struct {
	Licensor   string    `json:"licensor"`
	Scope      string    `json:"scope"`
	ProofNote  string    `json:"proofNote"`
	ValidFrom  time.Time `json:"validFrom"`
	ValidUntil time.Time `json:"validUntil"`
}

type patchAdminReadingBookRequest struct {
	Title        *string               `json:"title"`
	Author       *string               `json:"author"`
	Intro        *string               `json:"intro"`
	CoverURL     *string               `json:"coverUrl"`
	Category     *string               `json:"category"`
	SerialStatus *string               `json:"serialStatus"`
	AllowOffline *bool                 `json:"allowOffline"`
	Rights       *contentRightsRequest `json:"rights"`
}

func (s *Server) handlePatchAdminReadingBook(w http.ResponseWriter, r *http.Request) {
	var request patchAdminReadingBookRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	patch := reading.BookPatch{Title: request.Title, Author: request.Author, Intro: request.Intro, CoverURL: request.CoverURL,
		Category: request.Category, SerialStatus: request.SerialStatus, AllowOffline: request.AllowOffline}
	if request.Rights != nil {
		patch.Rights = &reading.ContentRights{BookID: strings.TrimSpace(r.PathValue("bookID")), Licensor: request.Rights.Licensor,
			Scope: request.Rights.Scope, ProofNote: request.Rights.ProofNote, ValidFrom: request.Rights.ValidFrom,
			ValidUntil: request.Rights.ValidUntil, ReviewedBy: account.ID, ReviewedAt: time.Now().UTC()}
	}
	book, err := s.readingService.Store().UpdateBook(r.Context(), strings.TrimSpace(r.PathValue("bookID")), patch, account.ID, time.Now().UTC())
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"book": book})
}

type patchAdminReadingChapterRequest struct {
	Title     string `json:"title"`
	SortOrder int    `json:"sortOrder"`
}

func (s *Server) handlePatchAdminReadingChapter(w http.ResponseWriter, r *http.Request) {
	var request patchAdminReadingChapterRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	chapter, err := s.readingService.Store().UpdateChapter(r.Context(), strings.TrimSpace(r.PathValue("bookID")), strings.TrimSpace(r.PathValue("chapterID")), request.Title, request.SortOrder)
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chapter": chapter})
}

func (s *Server) handlePublishAdminReadingBook(w http.ResponseWriter, r *http.Request) {
	s.updateAdminReadingStatus(w, r, reading.StatusPublished)
}

func (s *Server) handleHideAdminReadingBook(w http.ResponseWriter, r *http.Request) {
	s.updateAdminReadingStatus(w, r, reading.StatusHidden)
}

func (s *Server) handleRemoveAdminReadingBook(w http.ResponseWriter, r *http.Request) {
	s.updateAdminReadingStatus(w, r, reading.StatusRemoved)
}

func (s *Server) updateAdminReadingStatus(w http.ResponseWriter, r *http.Request, status reading.PublishStatus) {
	account, _ := authenticatedUserFromContext(r.Context())
	bookID := strings.TrimSpace(r.PathValue("bookID"))
	if err := s.readingService.Store().UpdatePublishStatus(r.Context(), bookID, status, account.ID, time.Now().UTC()); err != nil {
		if errors.Is(err, reading.ErrRightsRequired) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "reading_rights_required"})
			return
		}
		writeReadingError(w, err)
		return
	}
	book, err := s.readingService.Store().GetBook(r.Context(), bookID)
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"book": book})
}

func (s *Server) handleListAdminReadingSyncRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := s.readingService.Store().ListSyncRuns(r.Context(), 30)
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

func (s *Server) handleAdminReadingProviderSync(w http.ResponseWriter, r *http.Request) {
	providerKey := strings.TrimSpace(r.PathValue("providerKey"))
	if providerKey == "" || providerKey != s.readingService.ProviderKey() {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "reading_provider_not_found"})
		return
	}
	run, err := s.readingService.SyncProvider(r.Context(), "manual")
	if err != nil {
		writeReadingError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}
