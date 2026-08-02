package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"my-first-expo-app/backend/internal/resourcesearch"
)

type resourceSearchService interface {
	Resolve(context.Context, string) (resourcesearch.ResolvedResult, error)
	Search(context.Context, string, string) (resourcesearch.SourceResult, error)
	Sources(context.Context) ([]resourcesearch.PublicSource, error)
	ListSources(context.Context, resourcesearch.SourceFilter) ([]resourcesearch.PublicSource, error)
	GetSource(context.Context, string) (resourcesearch.Source, error)
	CreateSource(context.Context, string, resourcesearch.SourceInput) (resourcesearch.Source, error)
	UpdateSource(context.Context, string, string, resourcesearch.SourceInput) (resourcesearch.Source, error)
	SetSourceEnabled(context.Context, string, string, bool) (resourcesearch.Source, error)
	DeleteSource(context.Context, string, string) (resourcesearch.Source, error)
	HealthCheck(context.Context, string, string) (resourcesearch.HealthResult, error)
	HealthCheckURL(context.Context, string, int64, string) (resourcesearch.HealthResult, error)
	HealthCheckAll(context.Context) ([]resourcesearch.HealthResult, error)
	TestSearch(context.Context, string, string, string) (resourcesearch.TestResult, error)
	TestSearchInput(context.Context, string, resourcesearch.SourceInput, string) (resourcesearch.TestResult, error)
	Stats(context.Context, int) (resourcesearch.AdminStats, error)
	Store() *resourcesearch.Store
}

func registerResourceSearchRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("GET /api/v1/resource-search/sources", api.withRateLimitedAPIPipeline("resource-search", api.handleResourceSearchSources))
	mux.HandleFunc("GET /api/v1/resource-search/search", api.withRateLimitedAPIPipeline("resource-search", api.handleResourceSearch))
	mux.HandleFunc("POST /api/v1/resource-search/results/{resultID}/resolve", api.withRateLimitedAPIPipeline("resource-search", api.handleResolveResourceResult))
	registerResourceSearchAdminRoutes(mux, api)
}

func registerResourceSearchAdminRoutes(mux *http.ServeMux, api *Server) {
	adminJSON := func(handler http.HandlerFunc) http.HandlerFunc {
		return api.withAuth(api.withAdmin(api.withAPIPipeline(handler)))
	}
	mux.HandleFunc("GET /api/v1/admin/resource-search/sources", adminJSON(api.handleListAdminResourceSearchSources))
	mux.HandleFunc("POST /api/v1/admin/resource-search/sources", adminJSON(api.handleCreateAdminResourceSearchSource))
	mux.HandleFunc("PATCH /api/v1/admin/resource-search/sources/{sourceID}", adminJSON(api.handleUpdateAdminResourceSearchSource))
	mux.HandleFunc("DELETE /api/v1/admin/resource-search/sources/{sourceID}", adminJSON(api.handleDeleteAdminResourceSearchSource))
	mux.HandleFunc("POST /api/v1/admin/resource-search/sources/{sourceID}/health-check", adminJSON(api.handleAdminResourceSearchHealthCheck))
	mux.HandleFunc("POST /api/v1/admin/resource-search/health-checks", adminJSON(api.handleAdminResourceSearchHealthChecks))
	mux.HandleFunc("POST /api/v1/admin/resource-search/sources/{sourceID}/test-search", adminJSON(api.handleAdminResourceSearchTestSearch))
	mux.HandleFunc("GET /api/v1/admin/resource-search/audit-logs", adminJSON(api.handleAdminResourceSearchAuditLogs))
	mux.HandleFunc("GET /api/v1/admin/resource-search/stats", adminJSON(api.handleAdminResourceSearchStats))
}

func (s *Server) handleResourceSearchSources(w http.ResponseWriter, r *http.Request) {
	sources, err := s.resourceSearchService.Sources(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "resource_search_sources_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": sources})
}

func (s *Server) handleResourceSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.Join(strings.Fields(r.URL.Query().Get("q")), " ")
	sourceID := strings.TrimSpace(r.URL.Query().Get("source"))
	if query == "" || len([]rune(query)) > 100 || sourceID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_search_invalid"})
		return
	}

	result, err := s.resourceSearchService.Search(r.Context(), sourceID, query)
	if err != nil {
		if errors.Is(err, resourcesearch.ErrSourceNotFound) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_search_invalid"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"detail": err.Error(),
			"error":  "resource_search_invalid",
		})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleResolveResourceResult(w http.ResponseWriter, r *http.Request) {
	resultID := strings.TrimSpace(r.PathValue("resultID"))
	if resultID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_result_invalid"})
		return
	}

	result, err := s.resourceSearchService.Resolve(r.Context(), resultID)
	if err != nil {
		if errors.Is(err, resourcesearch.ErrResultNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "resource_result_expired"})
			return
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "resource_result_resolve_failed"})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleListAdminResourceSearchSources(w http.ResponseWriter, r *http.Request) {
	filter := resourcesearch.SourceFilter{
		Query:    r.URL.Query().Get("q"),
		Category: r.URL.Query().Get("category"),
		Status:   r.URL.Query().Get("status"),
	}
	sources, err := s.resourceSearchService.ListSources(r.Context(), filter)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "resource_search_sources_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sources": sources})
}

type resourceSearchSourceRequest struct {
	Name              string `json:"name"`
	Description       string `json:"description"`
	Category          string `json:"category"`
	HomepageURL       string `json:"homepageUrl"`
	SearchURLTemplate string `json:"searchUrlTemplate"`
	Mode              string `json:"mode"`
	AdapterKey        string `json:"adapterKey"`
	LogoType          string `json:"logoType"`
	LogoText          string `json:"logoText"`
	LogoBackground    string `json:"logoBackground"`
	LogoColor         string `json:"logoColor"`
	LogoImagePath     string `json:"logoImagePath"`
	DefaultSelected   bool   `json:"defaultSelected"`
	Enabled           bool   `json:"enabled"`
	SortOrder         int    `json:"sortOrder"`
	MaxResults        int    `json:"maxResults"`
	TimeoutMS         int64  `json:"timeoutMs"`
	CacheTTLMS        int64  `json:"cacheTtlMs"`
	TestQuery         string `json:"testQuery"`
}

func (s *Server) handleCreateAdminResourceSearchSource(w http.ResponseWriter, r *http.Request) {
	var request resourceSearchSourceRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	input, err := sourceRequestToInput(request)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_source_invalid", "detail": err.Error()})
		return
	}
	if input.Enabled {
		if err := s.verifySourceBeforeSave(r, account.ID, input, request.TestQuery); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_source_verification_failed", "detail": err.Error()})
			return
		}
	}
	source, err := s.resourceSearchService.CreateSource(r.Context(), account.ID, input)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_source_create_failed", "detail": err.Error()})
		return
	}
	s.writeResourceSearchAudit(r, "source_create", source.ID, "", resourceSearchJSON(source), "success", "")
	writeJSON(w, http.StatusCreated, map[string]any{"source": source})
}

func (s *Server) handleUpdateAdminResourceSearchSource(w http.ResponseWriter, r *http.Request) {
	sourceID := strings.TrimSpace(r.PathValue("sourceID"))
	if sourceID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_source_invalid"})
		return
	}
	before, err := s.resourceSearchService.GetSource(r.Context(), sourceID)
	if err != nil {
		if errors.Is(err, resourcesearch.ErrSourceNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "resource_source_not_found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "resource_source_get_failed"})
		return
	}

	var request resourceSearchSourceRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	input, err := sourceRequestToInput(request)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_source_invalid", "detail": err.Error()})
		return
	}
	if input.Enabled {
		if err := s.verifySourceBeforeSave(r, account.ID, input, request.TestQuery); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_source_verification_failed", "detail": err.Error()})
			return
		}
	}
	source, err := s.resourceSearchService.UpdateSource(r.Context(), account.ID, sourceID, input)
	if err != nil {
		if errors.Is(err, resourcesearch.ErrSourceNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "resource_source_not_found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_source_update_failed", "detail": err.Error()})
		return
	}
	s.writeResourceSearchAudit(r, "source_update", sourceID, resourceSearchJSON(before), resourceSearchJSON(source), "success", "")
	writeJSON(w, http.StatusOK, map[string]any{"source": source})
}

func (s *Server) handleDeleteAdminResourceSearchSource(w http.ResponseWriter, r *http.Request) {
	sourceID := strings.TrimSpace(r.PathValue("sourceID"))
	account, _ := authenticatedUserFromContext(r.Context())
	source, err := s.resourceSearchService.DeleteSource(r.Context(), account.ID, sourceID)
	if err != nil {
		switch {
		case errors.Is(err, resourcesearch.ErrSourceNotFound):
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "resource_source_not_found"})
		case errors.Is(err, resourcesearch.ErrSourceInUse):
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_source_in_use"})
		default:
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "resource_source_delete_failed"})
		}
		return
	}
	s.writeResourceSearchAudit(r, "source_delete", sourceID, resourceSearchJSON(source), "", "success", "")
	writeJSON(w, http.StatusOK, map[string]any{"source": source, "deleted": true})
}

func (s *Server) handleAdminResourceSearchHealthCheck(w http.ResponseWriter, r *http.Request) {
	sourceID := strings.TrimSpace(r.PathValue("sourceID"))
	result, err := s.resourceSearchService.HealthCheck(r.Context(), sourceID, "manual")
	if err != nil {
		if errors.Is(err, resourcesearch.ErrSourceNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "resource_source_not_found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "resource_search_health_failed"})
		return
	}
	s.writeResourceSearchAudit(r, "health_check", sourceID, "", resourceSearchJSON(result), "success", "")
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAdminResourceSearchHealthChecks(w http.ResponseWriter, r *http.Request) {
	results, err := s.resourceSearchService.HealthCheckAll(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "resource_search_health_failed"})
		return
	}
	s.writeResourceSearchAudit(r, "health_check_all", "", "", resourceSearchJSON(map[string]int{"count": len(results)}), "success", "")
	writeJSON(w, http.StatusOK, map[string]any{"checks": results})
}

func (s *Server) handleAdminResourceSearchTestSearch(w http.ResponseWriter, r *http.Request) {
	sourceID := strings.TrimSpace(r.PathValue("sourceID"))
	var request struct {
		Query string `json:"query"`
	}
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	result, err := s.resourceSearchService.TestSearch(r.Context(), account.ID, sourceID, request.Query)
	if err != nil {
		if errors.Is(err, resourcesearch.ErrSourceNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "resource_source_not_found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "resource_search_test_failed", "detail": err.Error()})
		return
	}
	s.writeResourceSearchAudit(r, "test_search", sourceID, "", resourceSearchJSON(result), "success", "")
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleAdminResourceSearchAuditLogs(w http.ResponseWriter, r *http.Request) {
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 20)
	offset := parsePositiveInt(r.URL.Query().Get("offset"), 0)
	offset = max(0, offset)
	page, err := s.resourceSearchService.Store().ListAuditLogs(
		r.Context(),
		limit,
		offset,
		r.URL.Query().Get("action"),
		r.URL.Query().Get("operator"),
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "resource_search_audit_failed"})
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleAdminResourceSearchStats(w http.ResponseWriter, r *http.Request) {
	days := parsePositiveInt(r.URL.Query().Get("days"), 7)
	if days > 90 {
		days = 90
	}
	stats, err := s.resourceSearchService.Stats(r.Context(), days)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "resource_search_stats_failed"})
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) verifySourceBeforeSave(r *http.Request, operatorID string, input resourcesearch.SourceInput, testQuery string) error {
	health, err := s.resourceSearchService.HealthCheckURL(r.Context(), input.HomepageURL, input.TimeoutMS, "save")
	if err != nil {
		return err
	}
	if health.Status == resourcesearch.StatusError || health.Status == resourcesearch.StatusTimeout || health.Status == resourcesearch.StatusUnavailable {
		return errors.New("站点真实检测未通过：" + health.Message)
	}
	if input.Mode != resourcesearch.SourceModeAggregate {
		return nil
	}
	if strings.TrimSpace(testQuery) == "" {
		testQuery = "测试"
	}
	result, err := s.resourceSearchService.TestSearchInput(r.Context(), operatorID, input, testQuery)
	if err != nil {
		return err
	}
	if result.Status == resourcesearch.StatusError ||
		result.Status == resourcesearch.StatusTimeout ||
		result.Status == resourcesearch.StatusRestricted ||
		result.Status == resourcesearch.StatusUnavailable {
		return errors.New("真实试搜未通过：" + result.Message)
	}
	return nil
}

func sourceRequestToInput(request resourceSearchSourceRequest) (resourcesearch.SourceInput, error) {
	mode := resourcesearch.SourceMode(strings.TrimSpace(request.Mode))
	if mode == "" {
		mode = resourcesearch.SourceModeDirect
	}
	adapterKey := strings.TrimSpace(request.AdapterKey)
	if adapterKey == "" {
		if mode == resourcesearch.SourceModeAggregate {
			adapterKey = "laoer_sse"
		} else if strings.TrimSpace(request.SearchURLTemplate) != "" {
			adapterKey = "direct_link"
		} else {
			adapterKey = "homepage_only"
		}
	}
	maxResults := request.MaxResults
	if maxResults == 0 {
		maxResults = 20
	}
	timeoutMS := request.TimeoutMS
	if timeoutMS == 0 {
		timeoutMS = 12000
	}
	cacheTTLMS := request.CacheTTLMS
	if cacheTTLMS == 0 {
		cacheTTLMS = 120000
	}
	logoType := strings.TrimSpace(request.LogoType)
	if logoType == "" {
		logoType = "text"
	}
	return resourcesearch.SourceInput{
		Name:              strings.TrimSpace(request.Name),
		Description:       strings.TrimSpace(request.Description),
		Category:          strings.TrimSpace(request.Category),
		HomepageURL:       strings.TrimSpace(request.HomepageURL),
		SearchURLTemplate: strings.TrimSpace(request.SearchURLTemplate),
		Mode:              mode,
		AdapterKey:        adapterKey,
		LogoType:          logoType,
		LogoText:          strings.TrimSpace(request.LogoText),
		LogoBackground:    strings.TrimSpace(request.LogoBackground),
		LogoColor:         strings.TrimSpace(request.LogoColor),
		LogoImagePath:     strings.TrimSpace(request.LogoImagePath),
		DefaultSelected:   request.DefaultSelected,
		Enabled:           request.Enabled,
		SortOrder:         request.SortOrder,
		MaxResults:        maxResults,
		TimeoutMS:         timeoutMS,
		CacheTTLMS:        cacheTTLMS,
	}, nil
}

func (s *Server) writeResourceSearchAudit(r *http.Request, action, sourceID, before, after, result, message string) {
	if s.resourceSearchService.Store() == nil {
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	operatorName := account.DisplayName
	if operatorName == "" {
		operatorName = account.Username
	}
	_ = s.resourceSearchService.Store().AddAudit(r.Context(), resourcesearch.AuditLog{
		OperatorID:   account.ID,
		OperatorName: operatorName,
		Action:       action,
		SourceID:     sourceID,
		Before:       before,
		After:        after,
		Result:       result,
		Message:      message,
		CreatedAt:    nowUTC(),
	})
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func nowUTC() time.Time {
	return time.Now().UTC()
}

func resourceSearchJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(encoded)
}
