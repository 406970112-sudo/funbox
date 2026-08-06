package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/leftovermanager"
)

func registerLeftoverManagerRoutes(mux *http.ServeMux, api *Server) {
	if api.leftoverManagerStore == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/leftover-manager/home", api.withAuth(api.withAPIPipeline(api.handleLeftoverHome)))
	mux.HandleFunc("GET /api/v1/leftover-manager/items", api.withAuth(api.withAPIPipeline(api.handleLeftoverItems)))
	mux.HandleFunc("POST /api/v1/leftover-manager/items", api.withAuth(api.withAPIPipeline(api.handleCreateLeftoverItem)))
	mux.HandleFunc("GET /api/v1/leftover-manager/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleGetLeftoverItem)))
	mux.HandleFunc("PATCH /api/v1/leftover-manager/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleUpdateLeftoverItem)))
	mux.HandleFunc("DELETE /api/v1/leftover-manager/items/{itemID}", api.withAuth(api.withAPIPipeline(api.handleDeleteLeftoverItem)))
	mux.HandleFunc("POST /api/v1/leftover-manager/items/{itemID}/reheat", api.withAuth(api.withAPIPipeline(api.handleReheatLeftoverItem)))
	mux.HandleFunc("POST /api/v1/leftover-manager/items/{itemID}/eat", api.withAuth(api.withAPIPipeline(api.handleEatLeftoverItem)))
	mux.HandleFunc("POST /api/v1/leftover-manager/items/{itemID}/discard", api.withAuth(api.withAPIPipeline(api.handleDiscardLeftoverItem)))
	mux.HandleFunc("POST /api/v1/leftover-manager/items/{itemID}/photos", api.withAuth(api.withLeftoverUploadPipeline(api.handleUploadLeftoverPhoto)))
	mux.HandleFunc("DELETE /api/v1/leftover-manager/items/{itemID}/photos/{photoID}", api.withAuth(api.withAPIPipeline(api.handleDeleteLeftoverPhoto)))
	mux.HandleFunc("GET /api/v1/leftover-manager/items/{itemID}/events", api.withAuth(api.withAPIPipeline(api.handleLeftoverEvents)))
	mux.HandleFunc("GET /api/v1/leftover-manager/suggestions", api.withAuth(api.withAPIPipeline(api.handleLeftoverSuggestions)))
	mux.HandleFunc("GET /api/v1/leftover-manager/recipes/{recipeID}", api.withAuth(api.withAPIPipeline(api.handleLeftoverRecipe)))
	mux.HandleFunc("GET /api/v1/leftover-manager/history", api.withAuth(api.withAPIPipeline(api.handleLeftoverHistory)))
	mux.HandleFunc("GET /api/v1/leftover-manager/settings", api.withAuth(api.withAPIPipeline(api.handleGetLeftoverSettings)))
	mux.HandleFunc("PUT /api/v1/leftover-manager/settings", api.withAuth(api.withAPIPipeline(api.handleUpdateLeftoverSettings)))
	mux.HandleFunc("GET /api/v1/leftover-manager/export", api.withAuth(api.withAPIPipeline(api.handleLeftoverExport)))
	mux.HandleFunc("DELETE /api/v1/leftover-manager/data", api.withAuth(api.withAPIPipeline(api.handleClearLeftoverData)))
	mux.HandleFunc("GET /leftover-media/", api.withAuth(api.handleServeLeftoverMedia))
}

func (s *Server) withLeftoverUploadPipeline(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "origin_not_allowed"})
			return
		}
		if !s.allowRateLimitedRequest(w, r, "leftover-upload") {
			return
		}
		maxBytes := s.cfg.Storage.MaxLeftoverImageBytes
		maxImages := s.cfg.Storage.MaxLeftoverImages
		if maxBytes <= 0 {
			maxBytes = 5 << 20
		}
		if maxImages <= 0 {
			maxImages = 3
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBytes*int64(maxImages)+(1<<20))
		next.ServeHTTP(w, r)
	}
}

func (s *Server) handleLeftoverHome(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	home, err := s.leftoverManagerStore.Home(r.Context(), account.ID)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	for i := range home.Priority {
		home.Priority[i].CoverPhotoURL = s.publicLeftoverPhotoURL(home.Priority[i].CoverPhotoURL)
	}
	writeJSON(w, http.StatusOK, home)
}

func (s *Server) handleLeftoverItems(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.leftoverManagerStore.ListItems(r.Context(), account.ID)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	for i := range items {
		items[i].CoverPhotoURL = s.publicLeftoverPhotoURL(items[i].CoverPhotoURL)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleCreateLeftoverItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input leftovermanager.ItemInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.leftoverManagerStore.CreateItem(r.Context(), account.ID, input)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	item.CoverPhotoURL = s.publicLeftoverPhotoURL(item.CoverPhotoURL)
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGetLeftoverItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	detail, err := s.leftoverManagerStore.GetItemDetail(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	detail.CoverPhotoURL = s.publicLeftoverPhotoURL(detail.CoverPhotoURL)
	for i := range detail.Photos {
		detail.Photos[i].FileURL = s.publicLeftoverPhotoURL(detail.Photos[i].FileURL)
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *Server) handleUpdateLeftoverItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input leftovermanager.ItemInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.leftoverManagerStore.UpdateItem(r.Context(), account.ID, r.PathValue("itemID"), input)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	item.CoverPhotoURL = s.publicLeftoverPhotoURL(item.CoverPhotoURL)
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDeleteLeftoverItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	itemID := r.PathValue("itemID")
	item, err := s.leftoverManagerStore.GetItem(r.Context(), account.ID, itemID)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	if err := s.leftoverManagerStore.DeleteItem(r.Context(), account.ID, itemID); err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	_ = item
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleReheatLeftoverItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.leftoverManagerStore.Reheat(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	item.CoverPhotoURL = s.publicLeftoverPhotoURL(item.CoverPhotoURL)
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleEatLeftoverItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	item, err := s.leftoverManagerStore.MarkEaten(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	item.CoverPhotoURL = s.publicLeftoverPhotoURL(item.CoverPhotoURL)
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleDiscardLeftoverItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.leftoverManagerStore.MarkDiscarded(r.Context(), account.ID, r.PathValue("itemID"), input.Reason)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	item.CoverPhotoURL = s.publicLeftoverPhotoURL(item.CoverPhotoURL)
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleUploadLeftoverPhoto(w http.ResponseWriter, r *http.Request) {
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
	allowed := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".heic": true}
	if !allowed[ext] {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unsupported_file_type"})
		return
	}
	if header.Size > s.cfg.Storage.MaxLeftoverImageBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "file_too_large"})
		return
	}
	relativeDir := filepath.Join(account.ID, "photos")
	dir := filepath.Join(s.cfg.Storage.LeftoverDir, relativeDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	fileName := fmt.Sprintf("%d-%s%s", time.Now().UnixNano(), shortID(), ext)
	target := filepath.Join(dir, fileName)
	out, err := os.Create(target)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	if _, err := io.Copy(out, file); err != nil {
		_ = out.Close()
		_ = os.Remove(target)
		s.writeLeftoverManagerError(w, err)
		return
	}
	_ = out.Close()
	relativeURL := "/leftover-media/" + relativeDir + "/" + fileName
	photo, err := s.leftoverManagerStore.AddPhoto(r.Context(), account.ID, r.PathValue("itemID"), relativeURL)
	if err != nil {
		_ = os.Remove(target)
		s.writeLeftoverManagerError(w, err)
		return
	}
	photo.FileURL = s.publicLeftoverPhotoURL(photo.FileURL)
	writeJSON(w, http.StatusCreated, photo)
}

func (s *Server) handleDeleteLeftoverPhoto(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	itemID := r.PathValue("itemID")
	photoID := r.PathValue("photoID")
	photo, err := s.leftoverManagerStore.GetPhoto(r.Context(), account.ID, photoID)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	if photo.ItemID != itemID {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "leftover_manager_not_found"})
		return
	}
	if err := s.leftoverManagerStore.DeletePhoto(r.Context(), account.ID, itemID, photoID); err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	s.removeLeftoverPhotoFile(photo.FileURL)
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleLeftoverEvents(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	events, err := s.leftoverManagerStore.ListEvents(r.Context(), account.ID, r.PathValue("itemID"))
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events})
}

func (s *Server) handleLeftoverSuggestions(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	home, err := s.leftoverManagerStore.Home(r.Context(), account.ID)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestions": home.Suggestions, "serverNow": home.ServerNow})
}

func (s *Server) handleLeftoverRecipe(w http.ResponseWriter, r *http.Request) {
	recipe := leftovermanager.FindRecipe(r.PathValue("recipeID"))
	if recipe == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "leftover_manager_not_found"})
		return
	}
	writeJSON(w, http.StatusOK, recipe)
}

func (s *Server) handleLeftoverHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	history, err := s.leftoverManagerStore.History(r.Context(), account.ID)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	for i := range history.Items {
		history.Items[i].CoverPhotoURL = s.publicLeftoverPhotoURL(history.Items[i].CoverPhotoURL)
	}
	writeJSON(w, http.StatusOK, history)
}

func (s *Server) handleGetLeftoverSettings(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	settings, err := s.leftoverManagerStore.GetSettings(r.Context(), account.ID)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleUpdateLeftoverSettings(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input leftovermanager.SettingsInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	settings, err := s.leftoverManagerStore.UpdateSettings(r.Context(), account.ID, input)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) handleLeftoverExport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	snapshot, err := s.leftoverManagerStore.Export(r.Context(), account.ID)
	if err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	for i := range snapshot.Items {
		snapshot.Items[i].CoverPhotoURL = s.publicLeftoverPhotoURL(snapshot.Items[i].CoverPhotoURL)
	}
	for i := range snapshot.Photos {
		snapshot.Photos[i].FileURL = s.publicLeftoverPhotoURL(snapshot.Photos[i].FileURL)
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="leftover-manager-export.csv"`)
		writeLeftoverCSV(w, snapshot)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="leftover-manager-export.json"`)
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) handleClearLeftoverData(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.leftoverManagerStore.ClearData(r.Context(), account.ID); err != nil {
		s.writeLeftoverManagerError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleServeLeftoverMedia(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	prefix := "/leftover-media/"
	raw := strings.TrimPrefix(r.URL.Path, prefix)
	parts := strings.Split(raw, "/")
	if len(parts) != 3 || parts[0] != account.ID || parts[1] != "photos" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}
	fileName := filepath.Base(parts[2])
	filePath := filepath.Join(s.cfg.Storage.LeftoverDir, account.ID, "photos", fileName)
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

func (s *Server) publicLeftoverPhotoURL(relativeURL string) string {
	if relativeURL == "" || strings.HasPrefix(relativeURL, "http://") || strings.HasPrefix(relativeURL, "https://") {
		return relativeURL
	}
	if baseURL := strings.TrimSpace(s.cfg.Server.PublicBaseURL); baseURL != "" {
		return strings.TrimRight(baseURL, "/") + relativeURL
	}
	return relativeURL
}

func (s *Server) removeLeftoverPhotoFile(relativeURL string) {
	prefix := "/leftover-media/"
	if !strings.HasPrefix(relativeURL, prefix) {
		return
	}
	parts := strings.Split(strings.TrimPrefix(relativeURL, prefix), "/")
	if len(parts) != 3 || parts[1] != "photos" {
		return
	}
	fileName := filepath.Base(parts[2])
	_ = os.Remove(filepath.Join(s.cfg.Storage.LeftoverDir, parts[0], "photos", fileName))
}

func (s *Server) writeLeftoverManagerError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, leftovermanager.ErrInvalidInput):
		log.Printf("leftover manager invalid input: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "leftover_manager_invalid_input"})
	case errors.Is(err, leftovermanager.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "leftover_manager_not_found"})
	default:
		log.Printf("leftover manager error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}

func writeLeftoverCSV(w http.ResponseWriter, snapshot leftovermanager.ExportSnapshot) {
	_, _ = io.WriteString(w, "id,name,sourceType,merchant,enteredFridgeAt,expectedConsumeAt,storedZone,remainingPercent,remainingText,reheatCount,tags,costCents,notes,status,eatenAt,discardedAt,discardReason,createdAt,updatedAt\n")
	for _, item := range snapshot.Items {
		line := []string{
			item.ID,
			csvField(item.Name),
			item.SourceType,
			csvField(item.Merchant),
			strconv.FormatInt(item.EnteredFridgeAt, 10),
			strconv.FormatInt(item.ExpectedConsumeAt, 10),
			item.StoredZone,
			strconv.Itoa(item.RemainingPercent),
			csvField(item.RemainingText),
			strconv.Itoa(item.ReheatCount),
			csvField(strings.Join(item.Tags, "、")),
			strconv.FormatInt(item.CostCents, 10),
			csvField(item.Notes),
			item.Status,
			nullableIntString(item.EatenAt),
			nullableIntString(item.DiscardedAt),
			csvField(item.DiscardReason),
			strconv.FormatInt(item.CreatedAt, 10),
			strconv.FormatInt(item.UpdatedAt, 10),
		}
		_, _ = io.WriteString(w, strings.Join(line, ",")+"\n")
	}
}

func nullableIntString(value *int64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}
