package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"my-first-expo-app/backend/internal/config"
	"my-first-expo-app/backend/internal/novelagent"
	"my-first-expo-app/backend/internal/user"
)

type handlerNovelAgentProvider struct {
	responses []string
}

func (p *handlerNovelAgentProvider) Generate(_ context.Context, _ novelagent.GenerateRequest) (novelagent.GenerateResponse, error) {
	response := p.responses[0]
	p.responses = p.responses[1:]
	return novelagent.GenerateResponse{Content: response, Model: "test-model"}, nil
}

func TestNovelAgentHandlersRequireAuthAndExposeSafeConfig(t *testing.T) {
	store, err := novelagent.OpenStore(":memory:")
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()
	service := novelagent.NewService(store, &handlerNovelAgentProvider{}, "fake", config.NovelAgentConfig{Enabled: false})
	api := &Server{novelAgentService: service, cfg: config.Config{NovelAgent: config.NovelAgentConfig{Provider: "deepseek", ModelA: "a", ModelB: "b", ModelC: "c"}}}

	configRecorder := httptest.NewRecorder()
	api.handleNovelAgentConfig(configRecorder, httptest.NewRequest(http.MethodGet, "/api/v1/novel-agent/config", nil))
	if configRecorder.Code != http.StatusOK {
		t.Fatalf("config status = %d", configRecorder.Code)
	}
	var configPayload map[string]any
	if err := json.NewDecoder(configRecorder.Body).Decode(&configPayload); err != nil {
		t.Fatalf("decode config: %v", err)
	}
	if configPayload["enabled"] != false {
		t.Fatal("config endpoint reported real mode enabled without service availability")
	}

	unauthorized := api.withAuth(api.handleNovelAgentCreate)
	unauthorizedRecorder := httptest.NewRecorder()
	unauthorized(unauthorizedRecorder, httptest.NewRequest(http.MethodPost, "/api/v1/novel-agent/workflows", bytes.NewBufferString(`{"premise":"x"}`)))
	if unauthorizedRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want 401", unauthorizedRecorder.Code)
	}
}

func TestNovelAgentHandlersKeepApprovalGateAndVersionConflicts(t *testing.T) {
	provider := &handlerNovelAgentProvider{responses: []string{
		`{"reply":"请确认方案","ready":true,"outline":{"logline":"一个人寻找旧信"}}`,
		`{"draft":{"title":"第一章","paragraphs":["正文"],"revision":1}}`,
		`{"review":{"pass":true,"score":90,"summary":"通过","route":"PASS"}}`,
	}}
	store, err := novelagent.OpenStore(":memory:")
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()
	service := novelagent.NewService(store, provider, "fake", config.NovelAgentConfig{Enabled: true})
	api := &Server{novelAgentService: service}
	ctx := contextWithAuthenticatedUser(context.Background(), user.User{ID: "user-1"})

	create := callNovelHandler(t, api.handleNovelAgentCreate, ctx, http.MethodPost, "/api/v1/novel-agent/workflows", `{"premise":"寻找旧信"}`)
	if create.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body=%s", create.Code, create.Body.String())
	}
	var createPayload struct {
		Workflow novelagent.Workflow `json:"workflow"`
	}
	decodeResponse(t, create, &createPayload)
	workflow := createPayload.Workflow

	writeBeforeApproval := callNovelHandler(t, api.handleNovelAgentWrite, ctx, http.MethodPost, "/api/v1/novel-agent/workflows/"+workflow.ID+"/b/write", `{"expectedVersion":1}`)
	if writeBeforeApproval.Code != http.StatusBadRequest {
		t.Fatalf("pre-approval B status = %d, want 400", writeBeforeApproval.Code)
	}

	message := callNovelHandler(t, api.handleNovelAgentMessage, ctx, http.MethodPost, "/api/v1/novel-agent/workflows/"+workflow.ID+"/a/messages", `{"message":"形成方案","expectedVersion":1}`)
	if message.Code != http.StatusOK {
		t.Fatalf("message status = %d, body=%s", message.Code, message.Body.String())
	}
	decodeResponse(t, message, &struct {
		Workflow novelagent.Workflow `json:"workflow"`
	}{})
	workflow, err = service.Get(context.Background(), "user-1", workflow.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	staleApprove := callNovelHandler(t, api.handleNovelAgentApprove, ctx, http.MethodPost, "/api/v1/novel-agent/workflows/"+workflow.ID+"/a/approve", `{"expectedVersion":1}`)
	if staleApprove.Code != http.StatusConflict {
		t.Fatalf("stale approve status = %d, want 409", staleApprove.Code)
	}
	approve := callNovelHandler(t, api.handleNovelAgentApprove, ctx, http.MethodPost, "/api/v1/novel-agent/workflows/"+workflow.ID+"/a/approve", `{"expectedVersion":3}`)
	if approve.Code != http.StatusOK {
		t.Fatalf("approve status = %d, body=%s", approve.Code, approve.Body.String())
	}
	decodeResponse(t, approve, &struct {
		Workflow novelagent.Workflow `json:"workflow"`
	}{})
	workflow, err = service.Get(context.Background(), "user-1", workflow.ID)
	if err != nil {
		t.Fatalf("Get() after approve error = %v", err)
	}

	write := callNovelHandler(t, api.handleNovelAgentWrite, ctx, http.MethodPost, "/api/v1/novel-agent/workflows/"+workflow.ID+"/b/write", `{"sceneId":"scene-1","expectedVersion":4}`)
	if write.Code != http.StatusOK {
		t.Fatalf("write status = %d, body=%s", write.Code, write.Body.String())
	}
	workflow, err = service.Get(context.Background(), "user-1", workflow.ID)
	if err != nil {
		t.Fatalf("Get() after write error = %v", err)
	}
	review := callNovelHandler(t, api.handleNovelAgentReview, ctx, http.MethodPost, "/api/v1/novel-agent/workflows/"+workflow.ID+"/c/review", `{"expectedVersion":6}`)
	if review.Code != http.StatusOK {
		t.Fatalf("review status = %d, body=%s", review.Code, review.Body.String())
	}
}

func callNovelHandler(t *testing.T, handler http.HandlerFunc, ctx context.Context, method string, path string, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body)).WithContext(ctx)
	parts := strings.Split(strings.Trim(path, "/"), "/")
	for index, part := range parts {
		if part == "workflows" && index+1 < len(parts) {
			request.SetPathValue("workflowID", parts[index+1])
			break
		}
	}
	handler(recorder, request)
	return recorder
}

func decodeResponse(t *testing.T, recorder *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.NewDecoder(recorder.Body).Decode(target); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, recorder.Body.String())
	}
}
