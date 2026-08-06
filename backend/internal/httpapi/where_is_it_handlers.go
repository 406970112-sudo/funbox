package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/whereisit"
)

func registerWhereIsItRoutes(mux *http.ServeMux, api *Server) {
	if api.whereIsItStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/where-is-it/summary", api.withAuth(api.withAPIPipeline(api.handleWhereIsItSummary)))
	mux.HandleFunc("GET /api/v1/where-is-it/items", api.withAuth(api.withAPIPipeline(api.handleWhereIsItItems)))
	mux.HandleFunc("POST /api/v1/where-is-it/items", api.withAuth(api.withAPIPipeline(api.handleCreateWhereIsItItem)))
	mux.HandleFunc("GET /api/v1/where-is-it/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleGetWhereIsItItem)))
	mux.HandleFunc("PATCH /api/v1/where-is-it/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleUpdateWhereIsItItem)))
	mux.HandleFunc("DELETE /api/v1/where-is-it/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleDeleteWhereIsItItem)))
	mux.HandleFunc("POST /api/v1/where-is-it/items/{itemID}/photos", api.withAuth(api.withWhereIsItUploadPipeline(api.handleUploadWhereIsItPhoto)))
	mux.HandleFunc("DELETE /api/v1/where-is-it/items/{itemID}/photos/{photoID}", api.withAuth(api.withAPIPipeline(api.handleDeleteWhereIsItPhoto)))
	mux.HandleFunc("POST /api/v1/where-is-it/items/{itemID}/move", api.withAuth(api.withAPIPipeline(api.handleMoveWhereIsItItem)))
	mux.HandleFunc("POST /api/v1/where-is-it/items/{itemID}/confirm", api.withAuth(api.withAPIPipeline(api.handleConfirmWhereIsItItem)))
	mux.HandleFunc("GET /api/v1/where-is-it/items/{itemID}/history", api.withAuth(api.withAPIPipeline(api.handleWhereIsItHistory)))
	mux.HandleFunc("GET /api/v1/where-is-it/rooms", api.withAuth(api.withAPIPipeline(api.handleWhereIsItRooms)))
	mux.HandleFunc("POST /api/v1/where-is-it/rooms", api.withAuth(api.withAPIPipeline(api.handleCreateWhereIsItRoom)))
	mux.HandleFunc("PATCH /api/v1/where-is-it/rooms/{roomID}", api.withAuth(api.withAPIPipeline(api.handleUpdateWhereIsItRoom)))
	mux.HandleFunc("DELETE /api/v1/where-is-it/rooms/{roomID}", api.withAuth(api.withAPIPipeline(api.handleDeleteWhereIsItRoom)))
	mux.HandleFunc("GET /api/v1/where-is-it/search-history", api.withAuth(api.withAPIPipeline(api.handleWhereIsItSearchHistory)))
	mux.HandleFunc("DELETE /api/v1/where-is-it/search-history", api.withAuth(api.withAPIPipeline(api.handleClearWhereIsItSearchHistory)))
	mux.HandleFunc("GET /api/v1/where-is-it/export", api.withAuth(api.withAPIPipeline(api.handleWhereIsItExport)))
	mux.HandleFunc("GET /where-is-it-media/", api.withAuth(api.handleServeWhereIsItMedia))
}

func (s *Server) withWhereIsItUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "where-is-it-upload") {
			return
		}
		maxBytes := s.cfg.Storage.MaxWhereIsItImageBytes
		if maxBytes <= 0 {
			maxBytes = 5 << 20
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleWhereIsItSummary(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	summary, err := s.whereIsItStore.Summary(r.Context(), account.ID)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handleWhereIsItItems(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query != "" {
		_ = s.whereIsItStore.RecordSearch(r.Context(), account.ID, query)
	}
	items, err := s.whereIsItStore.ListItems(r.Context(), account.ID, whereisit.ItemFilter{
		RoomID:   strings.TrimSpace(r.URL.Query().Get("roomId")),
		Category: strings.TrimSpace(r.URL.Query().Get("category")),
		Query:    query,
		Status:   strings.TrimSpace(r.URL.Query().Get("status")),
		Sort:     strings.TrimSpace(r.URL.Query().Get("sort")),
	})
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	for i := range items {
		items[i].CoverPhotoURL = s.publicWhereIsItPhotoURL(items[i].CoverPhotoURL)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateWhereIsItItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input whereisit.ItemInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.whereIsItStore.CreateItem(r.Context(), account.ID, input)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetWhereIsItItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	detail, err := s.whereIsItStore.GetItemDetail(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	detail.CoverPhotoURL = s.publicWhereIsItPhotoURL(detail.CoverPhotoURL)
	for i := range detail.Photos {
		detail.Photos[i].FileURL = s.publicWhereIsItPhotoURL(detail.Photos[i].FileURL)
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handleUpdateWhereIsItItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input whereisit.ItemInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.whereIsItStore.UpdateItem(r.Context(), account.ID, r.PathValue("itemID"), input)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteWhereIsItItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.whereIsItStore.DeleteItem(r.Context(), account.ID, r.PathValue("itemID")); err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleUploadWhereIsItPhoto(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_multipart"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "missing_file"})
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".heic": true}[ext] {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unsupported_file_type"})
		return
	}
	if header.Size > s.cfg.Storage.MaxWhereIsItImageBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "file_too_large"})
		return
	}
	dir := filepath.Join(s.cfg.Storage.WhereIsItDir, account.ID, "photos")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	fileName := fmt.Sprintf("%d-%s%s", time.Now().UnixNano(), shortID(), ext)
	target := filepath.Join(dir, fileName)
	out, err := os.Create(target)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	if _, err := io.Copy(out, file); err != nil {
		_ = out.Close()
		_ = os.Remove(target)
		s.writeWhereIsItError(w, err)
		return
	}
	_ = out.Close()
	relativeURL := "/where-is-it-media/" + account.ID + "/photos/" + fileName
	kind := strings.TrimSpace(r.FormValue("kind"))
	if kind == "" {
		kind = "photo"
	}
	takenAt := int64(0)
	if value := strings.TrimSpace(r.FormValue("takenAt")); value != "" {
		if parsed, parseErr := time.Parse(time.RFC3339, value); parseErr == nil {
			takenAt = parsed.Unix()
		}
	}
	photo, err := s.whereIsItStore.AddPhoto(r.Context(), account.ID, r.PathValue("itemID"), relativeURL, kind, takenAt, r.FormValue("cover") == "true")
	if err != nil {
		_ = os.Remove(target)
		s.writeWhereIsItError(w, err)
		return
	}
	photo.FileURL = s.publicWhereIsItPhotoURL(photo.FileURL)
	writeJSON(w, http.StatusCreated, photo)
}

func (s *Server) handleDeleteWhereIsItPhoto(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	itemID := r.PathValue("itemID")
	photoID := r.PathValue("photoID")
	photo, err := s.whereIsItStore.GetPhoto(r.Context(), account.ID, photoID)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	if photo.ItemID != itemID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "where_is_it_not_found"})
		return
	}
	if err := s.whereIsItStore.DeletePhoto(r.Context(), account.ID, itemID, photoID); err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	s.removeWhereIsItPhotoFile(photo.FileURL)
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleMoveWhereIsItItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input whereisit.MoveInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.whereIsItStore.MoveItem(r.Context(), account.ID, r.PathValue("itemID"), input)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleConfirmWhereIsItItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.whereIsItStore.ConfirmItem(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleWhereIsItHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	events, err := s.whereIsItStore.ListHistory(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) handleWhereIsItRooms(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	rooms, err := s.whereIsItStore.EnsureDefaultRooms(r.Context(), account.ID)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rooms": rooms})
}

func (s *Server) handleCreateWhereIsItRoom(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input whereisit.RoomInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	room, err := s.whereIsItStore.CreateRoom(r.Context(), account.ID, input)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, room)
}

func (s *Server) handleUpdateWhereIsItRoom(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input whereisit.RoomInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	room, err := s.whereIsItStore.UpdateRoom(r.Context(), account.ID, r.PathValue("roomID"), input)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, room)
}

func (s *Server) handleDeleteWhereIsItRoom(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.whereIsItStore.DeleteRoom(r.Context(), account.ID, r.PathValue("roomID")); err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleWhereIsItSearchHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	queries, err := s.whereIsItStore.ListSearchHistory(r.Context(), account.ID)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"queries": queries})
}

func (s *Server) handleClearWhereIsItSearchHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.whereIsItStore.ClearSearchHistory(r.Context(), account.ID); err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleWhereIsItExport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	snapshot, err := s.whereIsItStore.Export(r.Context(), account.ID)
	if err != nil {
		s.writeWhereIsItError(w, err)
		return
	}
	if strings.TrimSpace(r.URL.Query().Get("format")) == "csv" {
		var builder strings.Builder
		builder.WriteString("name,room,locationDetail,category,nearbyHint,note,tags,photoCount,lastSeenAt,createdAt,updatedAt\n")
		for _, item := range snapshot.Items {
			lastSeen := ""
			if item.LastSeenAt != nil {
				lastSeen = item.LastSeenAt.Format(time.RFC3339)
			}
			fields := []string{csvField(item.Name), csvField(item.RoomName), csvField(item.LocationDetail),
				csvField(item.Category), csvField(item.NearbyHint), csvField(item.Note),
				csvField(strings.Join(item.Tags, "、")), fmt.Sprint(item.PhotoCount),
				csvField(lastSeen), item.CreatedAt.Format(time.RFC3339), item.UpdatedAt.Format(time.RFC3339)}
			builder.WriteString(strings.Join(fields, ","))
			builder.WriteString("\n")
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="where-is-it-export.csv"`)
		_, _ = w.Write([]byte(builder.String()))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="where-is-it-export.json"`)
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleServeWhereIsItMedia(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	relative := strings.TrimPrefix(r.URL.Path, "/where-is-it-media/")
	parts := strings.SplitN(relative, "/", 2)
	if len(parts) != 2 || parts[0] != account.ID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	filePath := filepath.Join(s.cfg.Storage.WhereIsItDir, account.ID, "photos", filepath.Base(parts[1]))
	file, err := os.Open(filePath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	defer file.Close()
	info, _ := file.Stat()
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}

func (s *Server) writeWhereIsItError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, whereisit.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "where_is_it_not_found"})
	case errors.Is(err, whereisit.ErrRoomNotEmpty):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "where_is_it_room_not_empty"})
	case errors.Is(err, whereisit.ErrInvalidInput):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "where_is_it_invalid_input"})
	default:
		log.Printf("where is it request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "where_is_it_request_failed"})
	}
}

func (s *Server) publicWhereIsItPhotoURL(relativeURL string) string {
	if relativeURL == "" || strings.HasPrefix(relativeURL, "http") {
		return relativeURL
	}
	if baseURL := strings.TrimRight(s.cfg.Server.PublicBaseURL, "/"); baseURL != "" {
		return baseURL + relativeURL
	}
	return relativeURL
}

func (s *Server) removeWhereIsItPhotoFile(relativeURL string) {
	if !strings.HasPrefix(relativeURL, "/where-is-it-media/") {
		return
	}
	parts := strings.SplitN(strings.TrimPrefix(relativeURL, "/where-is-it-media/"), "/", 2)
	if len(parts) == 2 {
		_ = os.Remove(filepath.Join(s.cfg.Storage.WhereIsItDir, parts[0], "photos", filepath.Base(parts[1])))
	}
}
