package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/user"
)

const maxAdminRoleChangeReasonLength = 100

type updateAdminUserRoleRequest struct {
	ExpectedRole roles.Role `json:"expectedRole"`
	Reason       string     `json:"reason"`
	Role         roles.Role `json:"role"`
}

type adminUserSummaryResponse struct {
	AvatarURL      string     `json:"avatarUrl"`
	CreatedAt      string     `json:"createdAt"`
	DisplayName    string     `json:"displayName"`
	ID             string     `json:"id"`
	MaskedUsername string     `json:"maskedUsername"`
	Role           roles.Role `json:"role"`
	UpdatedAt      string     `json:"updatedAt"`
}

type adminUserDetailResponse struct {
	AvatarURL   string     `json:"avatarUrl"`
	CreatedAt   string     `json:"createdAt"`
	DisplayName string     `json:"displayName"`
	ID          string     `json:"id"`
	Role        roles.Role `json:"role"`
	UpdatedAt   string     `json:"updatedAt"`
	Username    string     `json:"username"`
}

type adminUserRoleChangeResponse struct {
	CreatedAt              string     `json:"createdAt"`
	FromRole               roles.Role `json:"fromRole"`
	ID                     string     `json:"id"`
	OperatorDisplayName    string     `json:"operatorDisplayName"`
	OperatorID             string     `json:"operatorId"`
	OperatorMaskedUsername string     `json:"operatorMaskedUsername"`
	Reason                 string     `json:"reason"`
	ToRole                 roles.Role `json:"toRole"`
}

func (s *Server) handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := adminPagination(w, r, 20)
	if !ok {
		return
	}
	role := roles.Role(strings.TrimSpace(r.URL.Query().Get("role")))
	if role != "" && !roles.IsValid(role) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_role"})
		return
	}

	result, err := s.authService.ListUsers(r.Context(), user.ListOptions{
		Limit:  limit,
		Offset: offset,
		Query:  r.URL.Query().Get("q"),
		Role:   role,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_users_failed"})
		return
	}

	users := make([]adminUserSummaryResponse, 0, len(result.Users))
	for _, account := range result.Users {
		users = append(users, s.adminUserSummary(account))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"limit":  limit,
		"offset": offset,
		"total":  result.Total,
		"users":  users,
	})
}

func (s *Server) handleAdminUser(w http.ResponseWriter, r *http.Request) {
	account, err := s.authService.GetUserByID(r.Context(), strings.TrimSpace(r.PathValue("userID")))
	if err != nil {
		s.writeAdminUserError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": s.adminUserDetail(account)})
}

func (s *Server) handleUpdateAdminUserRole(w http.ResponseWriter, r *http.Request) {
	operator, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}

	var request updateAdminUserRoleRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	if utf8.RuneCountInString(strings.TrimSpace(request.Reason)) > maxAdminRoleChangeReasonLength {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "role_change_reason_invalid"})
		return
	}

	updated, changed, err := s.authService.UpdateUserRole(
		r.Context(),
		strings.TrimSpace(r.PathValue("userID")),
		operator.ID,
		request.ExpectedRole,
		request.Role,
		request.Reason,
	)
	if err != nil {
		s.writeAdminUserError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"changed": changed,
		"user":    s.adminUserDetail(updated),
	})
}

func (s *Server) handleAdminUserRoleChanges(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.PathValue("userID"))
	if _, err := s.authService.GetUserByID(r.Context(), userID); err != nil {
		s.writeAdminUserError(w, err)
		return
	}
	limit, offset, ok := adminPagination(w, r, 10)
	if !ok {
		return
	}

	result, err := s.authService.ListUserRoleChanges(r.Context(), userID, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "list_role_changes_failed"})
		return
	}
	changes := make([]adminUserRoleChangeResponse, 0, len(result.Changes))
	for _, change := range result.Changes {
		changes = append(changes, adminUserRoleChangeResponse{
			CreatedAt:              change.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			FromRole:               change.FromRole,
			ID:                     change.ID,
			OperatorDisplayName:    change.OperatorDisplayName,
			OperatorID:             change.OperatorUserID,
			OperatorMaskedUsername: maskUsername(change.OperatorUsername),
			Reason:                 change.Reason,
			ToRole:                 change.ToRole,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"changes": changes,
		"limit":   limit,
		"offset":  offset,
		"total":   result.Total,
	})
}

func (s *Server) adminUserSummary(account user.User) adminUserSummaryResponse {
	public := s.publicUser(account)
	return adminUserSummaryResponse{
		AvatarURL:      public.AvatarURL,
		CreatedAt:      account.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		DisplayName:    account.DisplayName,
		ID:             account.ID,
		MaskedUsername: maskUsername(account.Username),
		Role:           account.Role,
		UpdatedAt:      account.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func (s *Server) adminUserDetail(account user.User) adminUserDetailResponse {
	public := s.publicUser(account)
	return adminUserDetailResponse{
		AvatarURL:   public.AvatarURL,
		CreatedAt:   account.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		DisplayName: account.DisplayName,
		ID:          account.ID,
		Role:        account.Role,
		UpdatedAt:   account.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		Username:    account.Username,
	}
}

func (s *Server) writeAdminUserError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrRoleInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_role"})
	case errors.Is(err, user.ErrProtectedAdminRole):
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "protected_admin_role"})
	case errors.Is(err, user.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "user_not_found"})
	case errors.Is(err, user.ErrRoleChanged):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "role_changed"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "admin_user_request_failed"})
	}
}

func adminPagination(w http.ResponseWriter, r *http.Request, defaultLimit int) (int, int, bool) {
	limit, err := parseNonNegativeInt(r.URL.Query().Get("limit"), defaultLimit)
	if err != nil || limit < 1 || limit > 100 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_pagination"})
		return 0, 0, false
	}
	offset, err := parseNonNegativeInt(r.URL.Query().Get("offset"), 0)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_pagination"})
		return 0, 0, false
	}
	return limit, offset, true
}

func parseNonNegativeInt(value string, fallback int) (int, error) {
	if strings.TrimSpace(value) == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return 0, errors.New("value must be a non-negative integer")
	}
	return parsed, nil
}

func maskUsername(username string) string {
	runes := []rune(strings.TrimSpace(username))
	if len(runes) == 11 {
		return string(runes[:3]) + "****" + string(runes[7:])
	}
	if len(runes) <= 2 {
		return strings.Repeat("*", len(runes))
	}
	return string(runes[:1]) + strings.Repeat("*", len(runes)-2) + string(runes[len(runes)-1:])
}
