package httpapi

import (
	"net/http"
	"strings"
)

type wechatCodeRequest struct {
	Code string `json:"code"`
}

func (s *Server) decodeWeChatCode(w http.ResponseWriter, r *http.Request) (string, bool) {
	var input wechatCodeRequest
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return "", false
	}
	code := strings.TrimSpace(input.Code)
	if code == "" || len(code) > 512 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "wechat_code_invalid"})
		return "", false
	}
	return code, true
}

func (s *Server) handleWeChatLogin(w http.ResponseWriter, r *http.Request) {
	code, ok := s.decodeWeChatCode(w, r)
	if !ok {
		return
	}
	session, err := s.authService.LoginWeChat(r.Context(), code)
	if err != nil {
		s.writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.sessionResponse(session))
}

func (s *Server) handleBindWeChat(w http.ResponseWriter, r *http.Request) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	code, ok := s.decodeWeChatCode(w, r)
	if !ok {
		return
	}
	updated, err := s.authService.BindWeChat(r.Context(), account.ID, code)
	if err != nil {
		s.writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": s.publicUser(updated)})
}
