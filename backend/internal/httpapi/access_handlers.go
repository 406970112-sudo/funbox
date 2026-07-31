package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/roles"
)

type updateFeatureRolesRequest struct {
	Roles []roles.Role `json:"roles"`
}

type updateFeatureGrantRequest struct {
	Granted  bool   `json:"granted"`
	Username string `json:"username"`
}

func (s *Server) handleVisibleFeatures(w http.ResponseWriter, r *http.Request) {
	if s.accessStore == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "access_store_unavailable"})
		return
	}

	userID := ""
	role := roles.Normal
	if account, ok := authenticatedUserFromContext(r.Context()); ok {
		userID = account.ID
		role = account.Role
	}
	ids, err := s.accessStore.VisibleFeatureIDs(r.Context(), userID, role)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_features_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"featureIds": ids})
}

func (s *Server) handleAdminFeatures(w http.ResponseWriter, r *http.Request) {
	features, err := s.accessStore.ListFeatures(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_features_failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"features": features})
}

func (s *Server) handleUpdateFeatureRoles(w http.ResponseWriter, r *http.Request) {
	var request updateFeatureRolesRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	featureID := strings.TrimSpace(r.PathValue("featureID"))
	if err := s.accessStore.UpdateRolePermissions(r.Context(), featureID, request.Roles); err != nil {
		if errors.Is(err, access.ErrFeatureNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "feature_not_found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "update_feature_roles_failed"})
		return
	}
	s.handleAdminFeatures(w, r)
}

func (s *Server) handleUpdateFeatureGrant(w http.ResponseWriter, r *http.Request) {
	var request updateFeatureGrantRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	featureID := strings.TrimSpace(r.PathValue("featureID"))
	if err := s.accessStore.SetUserGrant(
		r.Context(),
		featureID,
		request.Username,
		request.Granted,
	); err != nil {
		switch {
		case errors.Is(err, access.ErrFeatureNotFound):
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "feature_not_found"})
		case errors.Is(err, access.ErrUserNotFound):
			writeJSON(w, http.StatusNotFound, map[string]any{"error": "user_not_found"})
		default:
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "update_feature_grant_failed"})
		}
		return
	}
	s.handleAdminFeatures(w, r)
}

func (s *Server) withAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		account, ok := authenticatedUserFromContext(r.Context())
		if !ok || account.Role != roles.Admin || s.accessStore == nil {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "admin_required"})
			return
		}
		next.ServeHTTP(w, r)
	}
}

func (s *Server) withOptionalAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authorization := strings.TrimSpace(r.Header.Get("Authorization"))
		if authorization == "" {
			next.ServeHTTP(w, r)
			return
		}

		parts := strings.Fields(authorization)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		account, err := s.authService.AuthenticateToken(r.Context(), parts[1])
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		ctx := contextWithAuthenticatedUser(r.Context(), account)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}
