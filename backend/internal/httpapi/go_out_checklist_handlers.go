package httpapi

import (
	"encoding/csv"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"my-first-expo-app/backend/internal/gooutchecklist"
)

func registerGoOutChecklistRoutes(mux *http.ServeMux, api *Server) {
	if api.goOutChecklistService == nil {
		return
	}
	mux.HandleFunc("GET /api/v1/go-out-checklist/home", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistHome)))
	mux.HandleFunc("GET /api/v1/go-out-checklist/items", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistListItems)))
	mux.HandleFunc("POST /api/v1/go-out-checklist/items", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistCreateItem)))
	mux.HandleFunc("PATCH /api/v1/go-out-checklist/items/{id}", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistUpdateItem)))
	mux.HandleFunc("DELETE /api/v1/go-out-checklist/items/{id}", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistDeleteItem)))
	mux.HandleFunc("GET /api/v1/go-out-checklist/scenes", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistListScenes)))
	mux.HandleFunc("POST /api/v1/go-out-checklist/scenes", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistCreateScene)))
	mux.HandleFunc("PUT /api/v1/go-out-checklist/scenes/{id}", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistUpdateScene)))
	mux.HandleFunc("DELETE /api/v1/go-out-checklist/scenes/{id}", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistDeleteScene)))
	mux.HandleFunc("GET /api/v1/go-out-checklist/templates", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistTemplates)))
	mux.HandleFunc("POST /api/v1/go-out-checklist/templates/{id}/apply", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistApplyTemplate)))
	mux.HandleFunc("GET /api/v1/go-out-checklist/settings", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistGetSettings)))
	mux.HandleFunc("PUT /api/v1/go-out-checklist/settings", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistSaveSettings)))
	mux.HandleFunc("GET /api/v1/go-out-checklist/history", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistHistory)))
	mux.HandleFunc("POST /api/v1/go-out-checklist/completions", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistAddCompletion)))
	mux.HandleFunc("DELETE /api/v1/go-out-checklist/completions/{id}", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistDeleteCompletion)))
	mux.HandleFunc("GET /api/v1/go-out-checklist/weather/health", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistWeatherHealth)))
	mux.HandleFunc("GET /api/v1/go-out-checklist/cities", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistCities)))
	mux.HandleFunc("GET /api/v1/go-out-checklist/export", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistExport)))
	mux.HandleFunc("DELETE /api/v1/go-out-checklist/data", api.withAuth(api.withAPIPipeline(api.handleGoOutChecklistClearData)))
}

func (s *Server) handleGoOutChecklistHome(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	response, err := s.goOutChecklistService.Home(r.Context(), account.ID, strings.TrimSpace(r.URL.Query().Get("sceneId")))
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleGoOutChecklistListItems(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	items, err := s.goOutChecklistService.ListItems(r.Context(), account.ID)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) handleGoOutChecklistCreateItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input gooutchecklist.ItemInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.goOutChecklistService.CreateItem(r.Context(), account.ID, input)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) handleGoOutChecklistUpdateItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input gooutchecklist.ItemInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	item, err := s.goOutChecklistService.UpdateItem(r.Context(), account.ID, r.PathValue("id"), input)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) handleGoOutChecklistDeleteItem(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.goOutChecklistService.DeleteItem(r.Context(), account.ID, r.PathValue("id")); err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleGoOutChecklistListScenes(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	scenes, sceneItems, err := s.goOutChecklistService.ListScenes(r.Context(), account.ID)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"scenes": scenes, "sceneItems": sceneItems})
}

func (s *Server) handleGoOutChecklistCreateScene(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input gooutchecklist.SceneInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	scene, err := s.goOutChecklistService.CreateScene(r.Context(), account.ID, input)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, scene)
}

func (s *Server) handleGoOutChecklistUpdateScene(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input gooutchecklist.SceneInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	scene, err := s.goOutChecklistService.UpdateScene(r.Context(), account.ID, r.PathValue("id"), input)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, scene)
}

func (s *Server) handleGoOutChecklistDeleteScene(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.goOutChecklistService.DeleteScene(r.Context(), account.ID, r.PathValue("id")); err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleGoOutChecklistTemplates(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"templates": s.goOutChecklistService.Templates()})
}

func (s *Server) handleGoOutChecklistApplyTemplate(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	scene, err := s.goOutChecklistService.ApplyTemplate(r.Context(), account.ID, r.PathValue("id"))
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, scene)
}

func (s *Server) handleGoOutChecklistGetSettings(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	payload, err := s.goOutChecklistService.GetSettings(r.Context(), account.ID)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) handleGoOutChecklistSaveSettings(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var payload gooutchecklist.SettingsPayload
	if err := decodeJSONBody(r, &payload); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	saved, err := s.goOutChecklistService.SaveSettings(r.Context(), account.ID, payload)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) handleGoOutChecklistHistory(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	response, err := s.goOutChecklistService.History(r.Context(), account.ID)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleGoOutChecklistAddCompletion(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	var input gooutchecklist.CompletionInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	completion, err := s.goOutChecklistService.AddCompletion(r.Context(), account.ID, input)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, completion)
}

func (s *Server) handleGoOutChecklistDeleteCompletion(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.goOutChecklistService.DeleteCompletion(r.Context(), account.ID, r.PathValue("id")); err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleGoOutChecklistWeatherHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.goOutChecklistService.WeatherHealth(r.Context()))
}

func (s *Server) handleGoOutChecklistCities(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "go_out_checklist_city_query_required"})
		return
	}
	results, err := s.goOutChecklistService.SearchCities(r.Context(), query)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) handleGoOutChecklistExport(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	state, err := s.goOutChecklistService.GetState(r.Context(), account.ID)
	if err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "csv" {
		writeGoOutChecklistCSV(w, state)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) handleGoOutChecklistClearData(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	if err := s.goOutChecklistService.ClearData(r.Context(), account.ID); err != nil {
		s.writeGoOutChecklistError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func writeGoOutChecklistCSV(w http.ResponseWriter, state gooutchecklist.State) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="go-out-checklist.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"type", "id", "name", "icon", "scene", "checkedAt", "result"})
	for _, item := range state.Items {
		_ = writer.Write([]string{"item", item.ID, item.Name, item.Icon, string(item.ItemType), "", ""})
	}
	for _, scene := range state.Scenes {
		_ = writer.Write([]string{"scene", scene.ID, scene.Name, scene.Icon, "", "", ""})
	}
	for _, completion := range state.Completions {
		_ = writer.Write([]string{
			"completion",
			completion.ID,
			completion.SceneName,
			strconv.Itoa(len(completion.ConfirmedItems)),
			completion.SceneID,
			completion.CheckedAt,
			completion.ResultText,
		})
	}
	writer.Flush()
}

func (s *Server) writeGoOutChecklistError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, gooutchecklist.ErrInvalidInput):
		log.Printf("go out checklist invalid input: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "go_out_checklist_invalid_input"})
	case errors.Is(err, gooutchecklist.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "go_out_checklist_not_found"})
	default:
		log.Printf("go out checklist error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error"})
	}
}
