package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"my-first-expo-app/backend/internal/novelagent"
)

type novelAgentMessageRequest struct {
	Message         string `json:"message"`
	ExpectedVersion int    `json:"expectedVersion"`
}

type novelAgentApproveRequest struct {
	ExpectedVersion int `json:"expectedVersion"`
}

func registerNovelAgentRoutes(mux *http.ServeMux, api *Server) {
	mux.HandleFunc("GET /api/v1/novel-agent/config", api.withAPIPipeline(api.handleNovelAgentConfig))
	mux.HandleFunc("POST /api/v1/novel-agent/workflows", api.withAuth(api.withAPIPipeline(api.handleNovelAgentCreate)))
	mux.HandleFunc("GET /api/v1/novel-agent/workflows/{workflowID}", api.withAuth(api.withAPIPipeline(api.handleNovelAgentGet)))
	mux.HandleFunc("POST /api/v1/novel-agent/workflows/{workflowID}/a/messages", api.withAuth(api.withAPIPipeline(api.handleNovelAgentMessage)))
	mux.HandleFunc("POST /api/v1/novel-agent/workflows/{workflowID}/a/approve", api.withAuth(api.withAPIPipeline(api.handleNovelAgentApprove)))
	mux.HandleFunc("POST /api/v1/novel-agent/workflows/{workflowID}/b/write", api.withAuth(api.withAPIPipeline(api.handleNovelAgentWrite)))
	mux.HandleFunc("POST /api/v1/novel-agent/workflows/{workflowID}/c/review", api.withAuth(api.withAPIPipeline(api.handleNovelAgentReview)))
	mux.HandleFunc("POST /api/v1/novel-agent/workflows/{workflowID}/b/revise", api.withAuth(api.withAPIPipeline(api.handleNovelAgentRevise)))
}

func (s *Server) handleNovelAgentConfig(w http.ResponseWriter, _ *http.Request) {
	available := s.novelAgentService != nil && s.novelAgentService.Available()
	writeJSON(w, http.StatusOK, map[string]any{
		"demo":     true,
		"real":     available,
		"enabled":  available,
		"provider": s.cfg.NovelAgent.Provider,
		"models": map[string]string{
			"planner":  s.cfg.NovelAgent.ModelA,
			"writer":   s.cfg.NovelAgent.ModelB,
			"reviewer": s.cfg.NovelAgent.ModelC,
		},
	})
}

func (s *Server) handleNovelAgentCreate(w http.ResponseWriter, r *http.Request) {
	service, ok := s.novelAgentReady(w)
	if !ok {
		return
	}
	ownerID, ok := novelAgentOwnerID(w, r)
	if !ok {
		return
	}
	var input novelagent.WorkflowInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	workflow, err := service.Create(r.Context(), ownerID, input)
	if err != nil {
		writeNovelAgentError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"workflow": workflow})
}

func (s *Server) handleNovelAgentGet(w http.ResponseWriter, r *http.Request) {
	service, ok := s.novelAgentReady(w)
	if !ok {
		return
	}
	ownerID, ok := novelAgentOwnerID(w, r)
	if !ok {
		return
	}
	workflow, err := service.Get(r.Context(), ownerID, r.PathValue("workflowID"))
	if err != nil {
		writeNovelAgentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workflow": workflow})
}

func (s *Server) handleNovelAgentMessage(w http.ResponseWriter, r *http.Request) {
	service, ownerID, workflowID, ok := s.novelAgentRequestContext(w, r)
	if !ok {
		return
	}
	var input novelAgentMessageRequest
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	workflow, err := service.MessageA(r.Context(), ownerID, workflowID, input.Message, input.ExpectedVersion)
	if err != nil {
		writeNovelAgentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workflow": workflow})
}

func (s *Server) handleNovelAgentApprove(w http.ResponseWriter, r *http.Request) {
	service, ownerID, workflowID, ok := s.novelAgentRequestContext(w, r)
	if !ok {
		return
	}
	var input novelAgentApproveRequest
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	workflow, err := service.ApproveA(r.Context(), ownerID, workflowID, input.ExpectedVersion)
	if err != nil {
		writeNovelAgentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workflow": workflow})
}

func (s *Server) handleNovelAgentWrite(w http.ResponseWriter, r *http.Request) {
	service, ownerID, workflowID, ok := s.novelAgentRequestContext(w, r)
	if !ok {
		return
	}
	var input novelagent.WriteInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	workflow, err := service.WriteB(r.Context(), ownerID, workflowID, input)
	if err != nil {
		writeNovelAgentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workflow": workflow})
}

func (s *Server) handleNovelAgentReview(w http.ResponseWriter, r *http.Request) {
	service, ownerID, workflowID, ok := s.novelAgentRequestContext(w, r)
	if !ok {
		return
	}
	var input novelagent.ReviewInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	workflow, err := service.ReviewC(r.Context(), ownerID, workflowID, input)
	if err != nil {
		writeNovelAgentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workflow": workflow})
}

func (s *Server) handleNovelAgentRevise(w http.ResponseWriter, r *http.Request) {
	service, ownerID, workflowID, ok := s.novelAgentRequestContext(w, r)
	if !ok {
		return
	}
	var input novelagent.RevisionInput
	if err := decodeJSONBody(r, &input); err != nil {
		writeRequestBodyError(w, err)
		return
	}
	workflow, err := service.ReviseB(r.Context(), ownerID, workflowID, input)
	if err != nil {
		writeNovelAgentError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"workflow": workflow})
}

func (s *Server) novelAgentRequestContext(w http.ResponseWriter, r *http.Request) (*novelagent.Service, string, string, bool) {
	service, ok := s.novelAgentReady(w)
	if !ok {
		return nil, "", "", false
	}
	ownerID, ok := novelAgentOwnerID(w, r)
	if !ok {
		return nil, "", "", false
	}
	return service, ownerID, r.PathValue("workflowID"), true
}

func (s *Server) novelAgentReady(w http.ResponseWriter) (*novelagent.Service, bool) {
	if s.novelAgentService == nil || !s.novelAgentService.Available() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "novel_agent_unavailable"})
		return nil, false
	}
	return s.novelAgentService, true
}

func novelAgentOwnerID(w http.ResponseWriter, r *http.Request) (string, bool) {
	account, ok := authenticatedUserFromContext(r.Context())
	if !ok || strings.TrimSpace(account.ID) == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return "", false
	}
	return account.ID, true
}

func writeNovelAgentError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	publicError := "novel_agent_request_failed"
	switch {
	case errors.Is(err, novelagent.ErrNotFound):
		status = http.StatusNotFound
		publicError = "not_found"
	case errors.Is(err, novelagent.ErrConflict):
		status = http.StatusConflict
		publicError = "conflict"
	case strings.Contains(err.Error(), "required"), strings.Contains(err.Error(), "not available"), strings.Contains(err.Error(), "exceeds"), strings.Contains(err.Error(), "requires"):
		status = http.StatusBadRequest
		publicError = "invalid_request"
	case strings.Contains(err.Error(), "unavailable"):
		status = http.StatusServiceUnavailable
		publicError = "novel_agent_unavailable"
	}
	payload := map[string]any{"error": publicError}
	if status == http.StatusBadRequest {
		payload["detail"] = err.Error()
	}
	writeJSON(w, status, payload)
}
