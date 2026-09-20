package novelagent

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/config"
)

type fakeProvider struct {
	responses []string
	seen      []GenerateRequest
}

func (p *fakeProvider) Generate(_ context.Context, request GenerateRequest) (GenerateResponse, error) {
	p.seen = append(p.seen, request)
	if len(p.responses) == 0 {
		return GenerateResponse{}, errors.New("fake provider exhausted")
	}
	content := p.responses[0]
	p.responses = p.responses[1:]
	return GenerateResponse{Content: content, Model: "fake-model", TotalTokens: 9}, nil
}

func TestServiceRequiresApprovalBeforeBAndCompletesRealLoop(t *testing.T) {
	provider := &fakeProvider{responses: []string{
		`{"reply":"方案已经形成，请确认。","ready":true,"questions":[],"reference":{"title":"样例","referenceBible":{"structure":"三幕","pacing":"稳","motifs":["雾"]},"referenceStyleProfile":{"enabled":["节奏"],"dimensions":[],"safetyNote":"不复制"},"enabledDimensions":["节奏"]},"outline":{"hook":"钩子","logline":"一个人寻找旧信","setting":"海边","cast":[],"beats":["发现线索"],"chapters":[{"label":"第一章","count":1}],"referenceNote":"抽象借鉴","mustKeep":["旧信"],"mustAvoid":["复刻"],"approvalStatus":"待用户确认"}}`,
		`{"draft":{"title":"第一章","subtitle":"旧信","paragraphs":["他打开了信。"],"wordCount":7,"revision":1,"sceneId":"scene-1","activeRevisionId":"rev-1","sourceHook":"钩子","styleApplied":"克制","styleDimensions":["节奏"]}}`,
		`{"review":{"round":1,"pass":true,"score":92,"summary":"通过","route":"PASS","issues":[],"issueDetails":[],"checkResults":[]}}`,
	}}
	service := newTestService(t, provider, 0)
	workflow, err := service.Create(context.Background(), "user-1", WorkflowInput{Premise: "寻找旧信"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := service.WriteB(context.Background(), "user-1", workflow.ID, WriteInput{}); err == nil {
		t.Fatal("WriteB() succeeded before approval")
	}
	workflow, err = service.MessageA(context.Background(), "user-1", workflow.ID, "请形成方案", workflow.Version)
	if err != nil {
		t.Fatalf("MessageA() error = %v", err)
	}
	if workflow.Status != StatusReady || workflow.DraftPlan == nil {
		t.Fatalf("MessageA() returned unexpected state: %#v", workflow)
	}
	workflow, err = service.ApproveA(context.Background(), "user-1", workflow.ID, workflow.Version)
	if err != nil {
		t.Fatalf("ApproveA() error = %v", err)
	}
	workflow, err = service.WriteB(context.Background(), "user-1", workflow.ID, WriteInput{SceneID: "scene-1"})
	if err != nil || workflow.Status != StatusReviewing {
		t.Fatalf("WriteB() = %#v, error = %v", workflow, err)
	}
	workflow, err = service.ReviewC(context.Background(), "user-1", workflow.ID, ReviewInput{ExpectedVersion: workflow.Version})
	if err != nil || workflow.Status != StatusCompleted || workflow.Review == nil || !workflow.Review.Pass {
		t.Fatalf("ReviewC() = %#v, error = %v", workflow, err)
	}
	logs, err := service.store.ListCallLogs(context.Background(), "user-1", workflow.ID)
	if err != nil || len(logs) != 3 {
		t.Fatalf("call logs = %#v, error = %v", logs, err)
	}
}

func TestServiceRetriesMalformedJSONAndPersistsFailureWhenExhausted(t *testing.T) {
	provider := &fakeProvider{responses: []string{"not-json", "still-not-json"}}
	service := newTestService(t, provider, 1)
	workflow, err := service.Create(context.Background(), "user-1", WorkflowInput{Premise: "测试重试"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	updated, err := service.MessageA(context.Background(), "user-1", workflow.ID, "形成方案", workflow.Version)
	if err == nil || updated.Status != StatusFailed {
		t.Fatalf("MessageA() = %#v, error = %v, want persisted failure", updated, err)
	}
	logs, logErr := service.store.ListCallLogs(context.Background(), "user-1", workflow.ID)
	if logErr != nil || len(logs) != 2 || logs[0].Status != "failed" {
		t.Fatalf("retry call logs = %#v, error = %v", logs, logErr)
	}
}

func TestServiceRejectsStaleVersion(t *testing.T) {
	provider := &fakeProvider{}
	service := newTestService(t, provider, 0)
	workflow, err := service.Create(context.Background(), "user-1", WorkflowInput{Premise: "版本"})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	_, err = service.MessageA(context.Background(), "user-1", workflow.ID, "过期消息", workflow.Version+1)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("MessageA() error = %v, want ErrConflict", err)
	}
}

func newTestService(t *testing.T, provider Provider, retries int) *Service {
	t.Helper()
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	service := NewService(store, provider, "fake", config.NovelAgentConfig{MaxRetries: retries, MaxInputBytes: 10000})
	service.sleep = func(context.Context, time.Duration) error { return nil }
	return service
}

func mustJSON(value any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
