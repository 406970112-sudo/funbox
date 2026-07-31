package httpapi

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"

	"my-first-expo-app/backend/internal/auth"
	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/user"
)

const maxAvatarDimension = 4096

type authenticatedUserContextKey struct{}

type credentialsRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type registerRequest struct {
	Username         string `json:"username"`
	Password         string `json:"password"`
	DisplayName      string `json:"displayName"`
	SecurityQuestion string `json:"securityQuestion"`
	SecurityAnswer   string `json:"securityAnswer"`
}

type recoveryQuestionRequest struct {
	Username string `json:"username"`
}

type recoveryAnswerRequest struct {
	Username       string `json:"username"`
	SecurityAnswer string `json:"securityAnswer"`
}

type recoveryResetRequest struct {
	RecoveryToken string `json:"recoveryToken"`
	NewPassword   string `json:"newPassword"`
}

type updateProfileRequest struct {
	DisplayName string `json:"displayName"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type authUserResponse struct {
	AvatarURL   string     `json:"avatarUrl"`
	CreatedAt   string     `json:"createdAt"`
	DisplayName string     `json:"displayName"`
	ID          string     `json:"id"`
	Role        roles.Role `json:"role"`
	Username    string     `json:"username"`
}

type sessionResponse struct {
	AccessToken string           `json:"accessToken"`
	User        authUserResponse `json:"user"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var request registerRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}

	session, err := s.authService.Register(
		r.Context(),
		request.Username,
		request.Password,
		request.DisplayName,
		request.SecurityQuestion,
		request.SecurityAnswer,
	)
	if err != nil {
		s.writeAuthError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, s.sessionResponse(session))
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var request credentialsRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}

	session, err := s.authService.Login(r.Context(), request.Username, request.Password)
	if err != nil {
		s.writeAuthError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, s.sessionResponse(session))
}

func (s *Server) handleRecoveryQuestion(w http.ResponseWriter, r *http.Request) {
	var request recoveryQuestionRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}

	question, err := s.authService.PasswordRecoveryQuestion(r.Context(), request.Username)
	if err != nil {
		s.writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"securityQuestion": question})
}

func (s *Server) handleRecoveryAnswer(w http.ResponseWriter, r *http.Request) {
	var request recoveryAnswerRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}

	recoveryToken, err := s.authService.VerifyRecoveryAnswer(
		r.Context(),
		request.Username,
		request.SecurityAnswer,
	)
	if err != nil {
		s.writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"recoveryToken": recoveryToken})
}

func (s *Server) handleRecoveryReset(w http.ResponseWriter, r *http.Request) {
	var request recoveryResetRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}

	if err := s.authService.ResetPasswordWithRecoveryToken(
		r.Context(),
		request.RecoveryToken,
		request.NewPassword,
	); err != nil {
		s.writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": s.publicUser(account)})
}

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}

	var request updateProfileRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}

	updated, err := s.authService.UpdateDisplayName(r.Context(), account.ID, request.DisplayName)
	if err != nil {
		s.writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": s.publicUser(updated)})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}

	var request changePasswordRequest
	if err := decodeJSONBody(r, &request); err != nil {
		writeRequestBodyError(w, err)
		return
	}

	session, err := s.authService.ChangePassword(
		r.Context(),
		account.ID,
		request.CurrentPassword,
		request.NewPassword,
	)
	if err != nil {
		s.writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.sessionResponse(session))
}

func (s *Server) handleUploadAvatar(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}

	maxBytes := s.cfg.Storage.MaxAvatarBytes
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+(1<<20))
	if err := r.ParseMultipartForm(maxBytes); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_avatar_upload"})
		return
	}

	upload, _, err := r.FormFile("avatar")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "avatar_required"})
		return
	}
	defer upload.Close()

	contents, err := io.ReadAll(io.LimitReader(upload, maxBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "avatar_read_failed"})
		return
	}
	if int64(len(contents)) > maxBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "avatar_too_large"})
		return
	}

	extension, err := validateAvatar(contents)
	if err != nil {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"error": "avatar_type_invalid"})
		return
	}

	if err := os.MkdirAll(s.cfg.Storage.AvatarDir, 0o755); err != nil {
		log.Printf("create avatar directory failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "avatar_save_failed"})
		return
	}

	fileName := fmt.Sprintf("%s-%s%s", account.ID, uuid.NewString(), extension)
	filePath := filepath.Join(s.cfg.Storage.AvatarDir, fileName)
	if err := writeFileAtomically(filePath, contents); err != nil {
		log.Printf("save avatar failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "avatar_save_failed"})
		return
	}

	updated, previousAvatar, err := s.authService.UpdateAvatar(r.Context(), account.ID, fileName)
	if err != nil {
		_ = os.Remove(filePath)
		s.writeAuthError(w, err)
		return
	}

	if previousAvatar != "" && previousAvatar != fileName {
		_ = os.Remove(filepath.Join(s.cfg.Storage.AvatarDir, filepath.Base(previousAvatar)))
	}

	writeJSON(w, http.StatusOK, map[string]any{"user": s.publicUser(updated)})
}

func (s *Server) handleServeAvatar(w http.ResponseWriter, r *http.Request) {
	fileName := filepath.Base(strings.TrimPrefix(r.URL.Path, "/avatars/"))
	if fileName == "." || fileName == "" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}

	filePath := filepath.Join(s.cfg.Storage.AvatarDir, fileName)
	if _, err := os.Stat(filePath); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "file_not_found"})
		return
	}

	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, filePath)
}

func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authorization := strings.TrimSpace(r.Header.Get("Authorization"))
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

		ctx := context.WithValue(r.Context(), authenticatedUserContextKey{}, account)
		next.ServeHTTP(w, r.WithContext(ctx))
	}
}

func authenticatedUserFromContext(ctx context.Context) (user.User, bool) {
	account, ok := ctx.Value(authenticatedUserContextKey{}).(user.User)
	return account, ok
}

func contextWithAuthenticatedUser(ctx context.Context, account user.User) context.Context {
	return context.WithValue(ctx, authenticatedUserContextKey{}, account)
}

func (s *Server) sessionResponse(session auth.Session) sessionResponse {
	return sessionResponse{
		AccessToken: session.AccessToken,
		User:        s.publicUser(session.User),
	}
}

func (s *Server) publicUser(account user.User) authUserResponse {
	avatarURL := ""
	if account.AvatarFile != "" {
		avatarURL = "/avatars/" + account.AvatarFile
		if baseURL := strings.TrimRight(strings.TrimSpace(s.cfg.Server.PublicBaseURL), "/"); baseURL != "" {
			avatarURL = baseURL + avatarURL
		}
	}

	return authUserResponse{
		AvatarURL:   avatarURL,
		CreatedAt:   account.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		DisplayName: account.DisplayName,
		ID:          account.ID,
		Role:        account.Role,
		Username:    account.Username,
	}
}

func (s *Server) writeAuthError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrUsernameInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "username_invalid"})
	case errors.Is(err, auth.ErrPasswordInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "password_invalid"})
	case errors.Is(err, auth.ErrDisplayNameInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "display_name_invalid"})
	case errors.Is(err, auth.ErrSecurityQuestionInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "security_question_invalid"})
	case errors.Is(err, auth.ErrSecurityAnswerInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "security_answer_invalid"})
	case errors.Is(err, auth.ErrUsernameTaken):
		writeJSON(w, http.StatusConflict, map[string]any{"error": "username_taken"})
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid_credentials"})
	case errors.Is(err, auth.ErrCurrentPasswordInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "current_password_invalid"})
	case errors.Is(err, auth.ErrRecoveryUnavailable):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "recovery_unavailable"})
	case errors.Is(err, auth.ErrRecoveryAnswerInvalid):
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "recovery_answer_invalid"})
	case errors.Is(err, auth.ErrRecoveryLocked):
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "recovery_locked"})
	case errors.Is(err, auth.ErrRecoveryTokenInvalid):
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "recovery_token_invalid"})
	case errors.Is(err, user.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "user_not_found"})
	default:
		log.Printf("auth request failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_server_error"})
	}
}

func writeRequestBodyError(w http.ResponseWriter, err error) {
	statusCode := http.StatusBadRequest
	if errors.Is(err, ErrRequestTooLarge) {
		statusCode = http.StatusRequestEntityTooLarge
	}
	writeJSON(w, statusCode, map[string]any{"error": "invalid_request_body"})
}

func validateAvatar(contents []byte) (string, error) {
	contentType := http.DetectContentType(contents)
	extension := ""
	switch contentType {
	case "image/jpeg":
		extension = ".jpg"
	case "image/png":
		extension = ".png"
	default:
		return "", errors.New("unsupported avatar type")
	}

	dimensions, _, err := image.DecodeConfig(bytes.NewReader(contents))
	if err != nil {
		return "", fmt.Errorf("decode avatar: %w", err)
	}
	if dimensions.Width < 1 || dimensions.Height < 1 ||
		dimensions.Width > maxAvatarDimension || dimensions.Height > maxAvatarDimension {
		return "", errors.New("avatar dimensions are invalid")
	}

	return extension, nil
}

func writeFileAtomically(filePath string, contents []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(filePath), ".avatar-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)

	if _, err := temporary.Write(contents); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, filePath)
}
