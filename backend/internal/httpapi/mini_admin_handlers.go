package httpapi

import (
	"errors"
	"net/http"
	"slices"
	"strings"

	"my-first-expo-app/backend/internal/feedback"
	"my-first-expo-app/backend/internal/miniadmin"
	"my-first-expo-app/backend/internal/user"
)

const miniAdminPrefix = "/api/v1/mini-admin/"

func registerMiniAdminRoutes(mux *http.ServeMux, api *Server) {
	register := func(pattern, permission string, handler http.HandlerFunc) {
		mux.HandleFunc(pattern, api.withAuth(api.withMiniAdmin(permission, api.withAPIPipeline(handler))))
	}
	register("GET /api/v1/mini-admin/session", "", api.handleMiniAdminSession)
	register("GET /api/v1/mini-admin/summary", "", api.handleMiniAdminSummary)
	register("GET /api/v1/mini-admin/users", miniadmin.UsersRead, api.handleAdminUsers)
	register("GET /api/v1/mini-admin/users/{userID}", miniadmin.UsersRead, api.handleAdminUser)
	register("PUT /api/v1/mini-admin/users/{userID}/role", miniadmin.UsersRole, api.handleUpdateAdminUserRole)
	register("GET /api/v1/mini-admin/users/{userID}/role-changes", miniadmin.UsersRead, api.handleAdminUserRoleChanges)
	register("GET /api/v1/mini-admin/feedback", miniadmin.FeedbackManage, api.handleListFeedback)
	register("GET /api/v1/mini-admin/feedback/{feedbackID}", miniadmin.FeedbackManage, api.handleMiniAdminFeedback)
	register("POST /api/v1/mini-admin/feedback/{feedbackID}/resolve", miniadmin.FeedbackManage, api.handleResolveFeedback)
	register("GET /api/v1/mini-admin/feedback/{feedbackID}/images/{imageID}", miniadmin.FeedbackManage, api.handleFeedbackImage)
	register("GET /api/v1/mini-admin/features", miniadmin.FeaturesManage, api.handleMiniFeatures)
	register("PUT /api/v1/mini-admin/features/{featureID}", miniadmin.FeaturesManage, api.handleUpdateMiniFeature)
	register("GET /api/v1/mini-admin/grants", "owner", api.handleListMiniAdminGrants)
	register("GET /api/v1/mini-admin/grants/{userID}", "owner", api.handleMiniAdminGrant)
	register("PUT /api/v1/mini-admin/grants/{userID}", "owner", api.handleUpdateMiniAdminGrant)
	register("GET /api/v1/mini-admin/grant-changes", "owner", api.handleMiniAdminGrantChanges)
	mux.HandleFunc("GET /api/v1/miniprogram/features", api.withOptionalAuth(api.withAPIPipeline(api.handleMiniFeatures)))
}

func isMiniAdminRequest(r *http.Request) bool {
	return strings.HasPrefix(r.URL.Path, miniAdminPrefix)
}

func (s *Server) withMiniAdmin(permission string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if s.authService.MiniAdmin() == nil {
			writeMiniAdminError(w, nil)
			return
		}
		if permission != "" {
			account, _ := authenticatedUserFromContext(r.Context())
			grant, err := s.authService.MiniAdmin().GetGrant(r.Context(), account.ID)
			if err != nil {
				writeMiniAdminError(w, err)
				return
			}
			if !grant.Owner && !slices.Contains(grant.Permissions, permission) {
				writeJSON(w, http.StatusForbidden, map[string]any{"error": "mini_admin_forbidden"})
				return
			}
		}
		next(w, r)
	}
}

func (s *Server) handleMiniAdminSession(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	grant, err := s.authService.MiniAdmin().GetGrant(r.Context(), account.ID)
	if err != nil {
		writeMiniAdminError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"owner":       grant.Owner,
		"permissions": grant.Permissions,
		"userId":      account.ID,
		"displayName": account.DisplayName,
	})
}

func (s *Server) handleMiniAdminSummary(w http.ResponseWriter, r *http.Request) {
	account, _ := authenticatedUserFromContext(r.Context())
	grant, err := s.authService.MiniAdmin().GetGrant(r.Context(), account.ID)
	if err != nil {
		writeMiniAdminError(w, err)
		return
	}
	if !grant.Owner && len(grant.Permissions) == 0 {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "mini_admin_forbidden"})
		return
	}
	has := func(permission string) bool {
		return grant.Owner || slices.Contains(grant.Permissions, permission)
	}
	intPtr := func(value int) *int { return &value }

	type summaryPayload struct {
		PendingFeedback     *int `json:"pendingFeedback,omitempty"`
		ProcessingFeedback  *int `json:"processingFeedback,omitempty"`
		FeaturesTotal       *int `json:"featuresTotal,omitempty"`
		FeaturesDisabled    *int `json:"featuresDisabled,omitempty"`
		FeaturesMaintenance *int `json:"featuresMaintenance,omitempty"`
		UsersTotal          *int `json:"usersTotal,omitempty"`
		GrantsTotal         *int `json:"grantsTotal,omitempty"`
	}
	var summary summaryPayload

	if has(miniadmin.FeedbackManage) && s.feedbackService != nil {
		if page, err := s.feedbackService.List(r.Context(), feedback.ListOptions{Status: "pending", Limit: 1}); err == nil {
			summary.PendingFeedback = intPtr(page.Total)
		}
		if page, err := s.feedbackService.List(r.Context(), feedback.ListOptions{Status: "processing", Limit: 1}); err == nil {
			summary.ProcessingFeedback = intPtr(page.Total)
		}
	}
	if has(miniadmin.FeaturesManage) {
		if features, err := s.authService.MiniAdmin().ListFeatures(r.Context()); err == nil {
			disabled, maintenance := 0, 0
			for _, feature := range features {
				if !feature.Enabled {
					disabled++
				} else if feature.Maintenance {
					maintenance++
				}
			}
			summary.FeaturesTotal = intPtr(len(features))
			summary.FeaturesDisabled = intPtr(disabled)
			summary.FeaturesMaintenance = intPtr(maintenance)
		}
	}
	if has(miniadmin.UsersRead) {
		if result, err := s.authService.ListUsers(r.Context(), user.ListOptions{Limit: 1}); err == nil {
			summary.UsersTotal = intPtr(result.Total)
		}
	}
	if grant.Owner {
		if _, total, err := s.authService.MiniAdmin().ListGrants(r.Context(), 1, 0); err == nil {
			summary.GrantsTotal = intPtr(total)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"summary": summary})
}

func (s *Server) handleListMiniAdminGrants(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := adminPagination(w, r, 50)
	if !ok {
		return
	}
	grants, total, err := s.authService.MiniAdmin().ListGrants(r.Context(), limit, offset)
	if err != nil {
		writeMiniAdminError(w, err)
		return
	}
	type grantSummary struct {
		miniadmin.Grant
		User adminUserSummaryResponse `json:"user"`
	}
	summaries := make([]grantSummary, 0, len(grants))
	for _, grant := range grants {
		account, err := s.authService.GetUserByID(r.Context(), grant.UserID)
		if err != nil {
			writeMiniAdminError(w, err)
			return
		}
		summaries = append(summaries, grantSummary{Grant: grant, User: s.adminUserSummary(account)})
	}
	writeJSON(w, http.StatusOK, map[string]any{"grants": summaries, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) handleUpdateMiniAdminGrant(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Permissions []string `json:"permissions"`
	}
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if request.Permissions == nil {
		writeMiniAdminError(w, miniadmin.ErrPermissionInvalid)
		return
	}
	operator, _ := authenticatedUserFromContext(r.Context())
	grant, err := s.authService.MiniAdmin().UpdateGrant(r.Context(), operator.ID, strings.TrimSpace(r.PathValue("userID")), request.Permissions)
	if err != nil {
		writeMiniAdminError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"grant": grant})
}

func (s *Server) handleMiniAdminGrant(w http.ResponseWriter, r *http.Request) {
	grant, err := s.authService.MiniAdmin().GetGrant(r.Context(), r.PathValue("userID"))
	if err != nil {
		writeMiniAdminError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"grant": grant})
}

func (s *Server) handleMiniAdminGrantChanges(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := adminPagination(w, r, 20)
	if !ok {
		return
	}
	changes, total, err := s.authService.MiniAdmin().ListGrantChanges(r.Context(), limit, offset)
	if err != nil {
		writeMiniAdminError(w, err)
		return
	}
	type grantChangeResponse struct {
		miniadmin.GrantChange
		UserDisplayName     string `json:"userDisplayName,omitempty"`
		OperatorDisplayName string `json:"operatorDisplayName,omitempty"`
	}
	nameCache := make(map[string]string)
	lookupName := func(id string) string {
		id = strings.TrimSpace(id)
		if id == "" {
			return ""
		}
		if cached, exists := nameCache[id]; exists {
			return cached
		}
		account, err := s.authService.GetUserByID(r.Context(), id)
		if err != nil {
			nameCache[id] = ""
			return ""
		}
		nameCache[id] = account.DisplayName
		return account.DisplayName
	}
	enriched := make([]grantChangeResponse, 0, len(changes))
	for _, change := range changes {
		enriched = append(enriched, grantChangeResponse{
			GrantChange:         change,
			UserDisplayName:     lookupName(change.UserID),
			OperatorDisplayName: lookupName(change.OperatorID),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"changes": enriched, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) handleMiniFeatures(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.authService.MiniAdmin() == nil {
		writeMiniAdminError(w, nil)
		return
	}
	features, err := s.authService.MiniAdmin().ListFeatures(r.Context())
	if err != nil {
		writeMiniAdminError(w, err)
		return
	}
	account, _ := authenticatedUserFromContext(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"features": features, "viewerRole": account.Role})
}

func (s *Server) handleUpdateMiniFeature(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Enabled           *bool    `json:"enabled"`
		VisiblePlacements []string `json:"visiblePlacements"`
		Audience          string   `json:"audience"`
		Maintenance       *bool    `json:"maintenance"`
		Revision          *int     `json:"revision"`
	}
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if request.Enabled == nil || request.Maintenance == nil || request.Revision == nil || *request.Revision < 0 {
		writeMiniAdminError(w, miniadmin.ErrFeatureInvalid)
		return
	}
	operator, _ := authenticatedUserFromContext(r.Context())
	feature, err := s.authService.MiniAdmin().UpdateFeature(r.Context(), r.PathValue("featureID"), operator.ID, *request.Revision, miniadmin.FeatureSettings{
		Enabled: *request.Enabled, VisiblePlacements: request.VisiblePlacements, Audience: request.Audience, Maintenance: *request.Maintenance,
	})
	if err != nil {
		writeMiniAdminError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"feature": feature})
}

func (s *Server) handleMiniAdminFeedback(w http.ResponseWriter, r *http.Request) {
	if s.feedbackService == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "feedback_unavailable"})
		return
	}
	item, err := s.feedbackService.Get(r.Context(), r.PathValue("feedbackID"))
	if err != nil {
		s.writeFeedbackError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": s.feedbackItemResponse(item, miniAdminPrefix+"feedback")})
}

func (s *Server) allowMiniFeature(w http.ResponseWriter, r *http.Request, id string) bool {
	if s.authService.MiniAdmin() == nil {
		writeMiniAdminError(w, nil)
		return false
	}
	feature, err := s.authService.MiniAdmin().GetFeature(r.Context(), id)
	if err != nil {
		writeMiniAdminError(w, err)
		return false
	}
	account, _ := authenticatedUserFromContext(r.Context())
	if feature.Maintenance {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "mini_feature_maintenance"})
		return false
	}
	if !feature.Allows(account.Role) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "mini_feature_restricted"})
		return false
	}
	return true
}

func writeMiniAdminError(w http.ResponseWriter, err error) {
	status, code := http.StatusInternalServerError, "mini_admin_request_failed"
	switch {
	case err == nil:
		status, code = http.StatusServiceUnavailable, "mini_admin_unavailable"
	case errors.Is(err, miniadmin.ErrNotOwner), errors.Is(err, miniadmin.ErrOwnerProtected):
		status, code = http.StatusForbidden, "mini_admin_forbidden"
	case errors.Is(err, miniadmin.ErrFeatureInvalid), errors.Is(err, miniadmin.ErrPermissionInvalid):
		status, code = http.StatusBadRequest, "invalid_mini_admin_settings"
	case errors.Is(err, miniadmin.ErrFeatureNotFound):
		status, code = http.StatusNotFound, "feature_not_found"
	case errors.Is(err, miniadmin.ErrUserNotFound), errors.Is(err, user.ErrNotFound):
		status, code = http.StatusNotFound, "user_not_found"
	case errors.Is(err, miniadmin.ErrFeatureChanged):
		status, code = http.StatusConflict, "feature_changed"
	}
	writeJSON(w, status, map[string]any{"error": code})
}
