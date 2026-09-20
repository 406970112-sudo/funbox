package novelagent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"my-first-expo-app/backend/internal/config"
)

type Service struct {
	store        *Store
	provider     Provider
	providerName string
	cfg          config.NovelAgentConfig
	now          func() time.Time
	sleep        func(context.Context, time.Duration) error
}

func NewService(store *Store, provider Provider, providerName string, cfg config.NovelAgentConfig) *Service {
	return &Service{
		store:        store,
		provider:     provider,
		providerName: strings.TrimSpace(providerName),
		cfg:          cfg,
		now:          time.Now,
		sleep:        sleepWithContext,
	}
}

func (s *Service) Available() bool {
	return s != nil && s.cfg.Enabled && s.provider != nil
}

func (s *Service) Create(ctx context.Context, ownerID string, input WorkflowInput) (Workflow, error) {
	if err := s.validateInput(input); err != nil {
		return Workflow{}, err
	}
	now := s.now().UTC()
	return s.store.Create(ctx, Workflow{
		ID:        uuid.NewString(),
		OwnerID:   ownerID,
		Status:    StatusPlanning,
		Version:   1,
		Input:     input,
		AMessages: []Message{},
		CreatedAt: now,
		UpdatedAt: now,
	})
}

func (s *Service) Get(ctx context.Context, ownerID string, workflowID string) (Workflow, error) {
	return s.store.Get(ctx, ownerID, workflowID)
}

func (s *Service) MessageA(ctx context.Context, ownerID string, workflowID string, message string, expectedVersion int) (Workflow, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return Workflow{}, fmt.Errorf("message is required")
	}
	workflow, err := s.store.Get(ctx, ownerID, workflowID)
	if err != nil {
		return Workflow{}, err
	}
	if err := checkExpectedVersion(workflow, expectedVersion); err != nil {
		return Workflow{}, err
	}
	if workflow.Status != StatusPlanning && workflow.Status != StatusReady && workflow.Status != StatusFailed {
		return Workflow{}, fmt.Errorf("A discussion is not available in status %s", workflow.Status)
	}
	workflow.AMessages = append(workflow.AMessages, Message{Role: "user", Content: message, CreatedAt: s.now().UTC()})
	workflow.LastError = ""
	workflow, err = s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
	if err != nil {
		return Workflow{}, err
	}

	var output PlannerOutput
	_, attempts, generateErr := s.generateJSON(ctx, workflow, RolePlanner, GenerateRequest{
		Role:         RolePlanner,
		SystemPrompt: plannerSystemPrompt(),
		UserPrompt:   plannerUserPrompt(workflow.Input, workflow.AMessages),
	}, func(content string) error {
		output = PlannerOutput{}
		if err := DecodeJSON(content, &output); err != nil {
			return err
		}
		return validatePlannerOutput(output)
	})
	workflow.Attempts += attempts
	if generateErr != nil {
		workflow.Status = StatusFailed
		workflow.LastError = safeError(generateErr)
		failed, updateErr := s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
		if updateErr != nil {
			return Workflow{}, updateErr
		}
		return failed, generateErr
	}
	workflow.AMessages = append(workflow.AMessages, Message{Role: "assistant", Content: output.Reply, CreatedAt: s.now().UTC()})
	workflow.DraftPlan = &Plan{
		Reference:   output.Reference,
		Outline:     output.Outline,
		PlanVersion: workflow.Version,
	}
	if output.Ready {
		workflow.Status = StatusReady
	} else {
		workflow.Status = StatusPlanning
	}
	workflow.LastError = ""
	return s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
}

func (s *Service) ApproveA(ctx context.Context, ownerID string, workflowID string, expectedVersion int) (Workflow, error) {
	workflow, err := s.store.Get(ctx, ownerID, workflowID)
	if err != nil {
		return Workflow{}, err
	}
	if err := checkExpectedVersion(workflow, expectedVersion); err != nil {
		return Workflow{}, err
	}
	if workflow.Status != StatusReady || workflow.DraftPlan == nil {
		return Workflow{}, fmt.Errorf("A plan is not ready for approval")
	}
	approved := *workflow.DraftPlan
	now := s.now().UTC()
	approved.ApprovedAt = &now
	approved.PlanVersion = workflow.Version
	approved.Outline.ApprovalStatus = "已确认"
	workflow.ApprovedPlan = &approved
	workflow.Status = StatusApproved
	workflow.LastError = ""
	return s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
}

func (s *Service) WriteB(ctx context.Context, ownerID string, workflowID string, input WriteInput) (Workflow, error) {
	workflow, err := s.store.Get(ctx, ownerID, workflowID)
	if err != nil {
		return Workflow{}, err
	}
	if err := checkExpectedVersion(workflow, input.ExpectedVersion); err != nil {
		return Workflow{}, err
	}
	if workflow.ApprovedPlan == nil {
		return Workflow{}, fmt.Errorf("B requires an approved A plan")
	}
	if workflow.Status != StatusApproved && workflow.Status != StatusRevisionWriting && workflow.Status != StatusFailed {
		return Workflow{}, fmt.Errorf("B writing is not available in status %s", workflow.Status)
	}
	workflow.Status = StatusWriting
	workflow.LastError = ""
	workflow, err = s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
	if err != nil {
		return Workflow{}, err
	}

	var output WriterOutput
	_, attempts, generateErr := s.generateJSON(ctx, workflow, RoleWriter, GenerateRequest{
		Role:         RoleWriter,
		SystemPrompt: writerSystemPrompt(),
		UserPrompt:   writerUserPrompt(*workflow.ApprovedPlan, workflow.Input, input, workflow.Review),
	}, func(content string) error {
		output = WriterOutput{}
		if err := DecodeJSON(content, &output); err != nil {
			return err
		}
		return validateWriterOutput(output)
	})
	workflow.Attempts += attempts
	if generateErr != nil {
		workflow.Status = StatusFailed
		workflow.LastError = safeError(generateErr)
		failed, updateErr := s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
		if updateErr != nil {
			return Workflow{}, updateErr
		}
		return failed, generateErr
	}
	workflow.Draft = &output.Draft
	workflow.Status = StatusReviewing
	workflow.LastError = ""
	return s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
}

func (s *Service) ReviewC(ctx context.Context, ownerID string, workflowID string, input ReviewInput) (Workflow, error) {
	workflow, err := s.store.Get(ctx, ownerID, workflowID)
	if err != nil {
		return Workflow{}, err
	}
	if err := checkExpectedVersion(workflow, input.ExpectedVersion); err != nil {
		return Workflow{}, err
	}
	if workflow.ApprovedPlan == nil || workflow.Draft == nil {
		return Workflow{}, fmt.Errorf("C requires an approved plan and a draft")
	}
	if workflow.Status != StatusReviewing && workflow.Status != StatusCompleted && workflow.Status != StatusFailed {
		return Workflow{}, fmt.Errorf("C review is not available in status %s", workflow.Status)
	}
	var output ReviewerOutput
	_, attempts, generateErr := s.generateJSON(ctx, workflow, RoleReviewer, GenerateRequest{
		Role:         RoleReviewer,
		SystemPrompt: reviewerSystemPrompt(),
		UserPrompt:   reviewerUserPrompt(*workflow.ApprovedPlan, *workflow.Draft),
	}, func(content string) error {
		output = ReviewerOutput{}
		if err := DecodeJSON(content, &output); err != nil {
			return err
		}
		return validateReviewerOutput(output)
	})
	workflow.Attempts += attempts
	if generateErr != nil {
		workflow.Status = StatusFailed
		workflow.LastError = safeError(generateErr)
		failed, updateErr := s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
		if updateErr != nil {
			return Workflow{}, updateErr
		}
		return failed, generateErr
	}
	workflow.Review = &output.Review
	workflow.LastError = ""
	workflow.Status = statusForReview(output.Review)
	return s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
}

func (s *Service) ReviseB(ctx context.Context, ownerID string, workflowID string, input RevisionInput) (Workflow, error) {
	input.Feedback = strings.TrimSpace(input.Feedback)
	if input.Feedback == "" {
		return Workflow{}, fmt.Errorf("feedback is required")
	}
	workflow, err := s.store.Get(ctx, ownerID, workflowID)
	if err != nil {
		return Workflow{}, err
	}
	if err := checkExpectedVersion(workflow, input.ExpectedVersion); err != nil {
		return Workflow{}, err
	}
	if workflow.ApprovedPlan == nil || workflow.Draft == nil {
		return Workflow{}, fmt.Errorf("B revision requires an approved plan and a draft")
	}
	workflow.Status = StatusRevisionWriting
	workflow.LastError = ""
	workflow, err = s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
	if err != nil {
		return Workflow{}, err
	}

	var output WriterOutput
	_, attempts, generateErr := s.generateJSON(ctx, workflow, RoleWriter, GenerateRequest{
		Role:         RoleWriter,
		SystemPrompt: writerSystemPrompt(),
		UserPrompt:   revisionUserPrompt(*workflow.ApprovedPlan, *workflow.Draft, input),
	}, func(content string) error {
		output = WriterOutput{}
		if err := DecodeJSON(content, &output); err != nil {
			return err
		}
		return validateWriterOutput(output)
	})
	workflow.Attempts += attempts
	if generateErr != nil {
		workflow.Status = StatusFailed
		workflow.LastError = safeError(generateErr)
		failed, updateErr := s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
		if updateErr != nil {
			return Workflow{}, updateErr
		}
		return failed, generateErr
	}
	if output.Draft.Revision <= workflow.Draft.Revision {
		output.Draft.Revision = workflow.Draft.Revision + 1
	}
	workflow.Draft = &output.Draft
	workflow.Status = StatusReviewing
	workflow.LastError = ""
	return s.store.Update(ctx, ownerID, workflowID, workflow.Version, workflow)
}

func (s *Service) generateJSON(ctx context.Context, workflow Workflow, role Role, request GenerateRequest, decode func(string) error) (GenerateResponse, int, error) {
	if s.provider == nil {
		return GenerateResponse{}, 0, fmt.Errorf("novel agent provider is unavailable")
	}
	attempts := s.cfg.MaxRetries + 1
	if attempts < 1 {
		attempts = 1
	}
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		started := s.now()
		response, err := s.provider.Generate(ctx, request)
		if err == nil {
			err = decode(response.Content)
		}
		status := "success"
		if err != nil {
			status = "failed"
		}
		logErr := s.store.AppendCallLog(ctx, CallLog{
			WorkflowID:       workflow.ID,
			OwnerID:          workflow.OwnerID,
			Role:             role,
			Provider:         s.providerName,
			Model:            response.Model,
			Status:           status,
			Attempt:          attempt,
			LatencyMillis:    s.now().Sub(started).Milliseconds(),
			PromptTokens:     response.PromptTokens,
			CompletionTokens: response.CompletionTokens,
			TotalTokens:      response.TotalTokens,
			Error:            errorText(err),
		})
		if logErr != nil && err == nil {
			err = fmt.Errorf("record model call: %w", logErr)
		}
		if err == nil {
			return response, attempt, nil
		}
		lastErr = err
		if attempt < attempts {
			if err := s.sleep(ctx, time.Duration(100*(1<<(attempt-1)))*time.Millisecond); err != nil {
				return GenerateResponse{}, attempt, err
			}
		}
	}
	return GenerateResponse{}, attempts, lastErr
}

func (s *Service) validateInput(input WorkflowInput) error {
	if strings.TrimSpace(input.Premise) == "" {
		return fmt.Errorf("premise is required")
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return fmt.Errorf("encode workflow input: %w", err)
	}
	if s.cfg.MaxInputBytes > 0 && int64(len(encoded)) > s.cfg.MaxInputBytes {
		return fmt.Errorf("workflow input exceeds %d bytes", s.cfg.MaxInputBytes)
	}
	return nil
}

func checkExpectedVersion(workflow Workflow, expectedVersion int) error {
	if expectedVersion > 0 && workflow.Version != expectedVersion {
		return ErrConflict
	}
	return nil
}

func validatePlannerOutput(output PlannerOutput) error {
	if strings.TrimSpace(output.Reply) == "" {
		return fmt.Errorf("planner response reply is required")
	}
	if strings.TrimSpace(output.Outline.Logline) == "" {
		return fmt.Errorf("planner response outline.logline is required")
	}
	return nil
}

func validateWriterOutput(output WriterOutput) error {
	if strings.TrimSpace(output.Draft.Title) == "" || len(output.Draft.Paragraphs) == 0 {
		return fmt.Errorf("writer response draft is incomplete")
	}
	return nil
}

func validateReviewerOutput(output ReviewerOutput) error {
	if strings.TrimSpace(output.Review.Route) == "" {
		return fmt.Errorf("reviewer response review.route is required")
	}
	switch output.Review.Route {
	case "PASS", "B_REWRITE", "REOPEN_PLANNING", "HUMAN_REVIEW":
		return nil
	default:
		return fmt.Errorf("reviewer response has unsupported route %q", output.Review.Route)
	}
}

func statusForReview(review Review) WorkflowStatus {
	switch review.Route {
	case "B_REWRITE":
		return StatusRevisionWriting
	case "REOPEN_PLANNING":
		return StatusReopenPlanning
	case "HUMAN_REVIEW":
		return StatusFailed
	default:
		return StatusCompleted
	}
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return safeError(err)
}

func safeError(err error) string {
	if err == nil {
		return ""
	}
	return strings.TrimSpace(err.Error())
}

func plannerSystemPrompt() string {
	return "你是小说结构策划 Agent A。与用户讨论原创架构，只有在 ready=true 时才表示方案可以确认。只返回符合约定 JSON 的结构化结果，不输出 Markdown。"
}

func plannerUserPrompt(input WorkflowInput, messages []Message) string {
	body, _ := json.Marshal(map[string]any{"input": input, "messages": messages})
	return string(body)
}

func writerSystemPrompt() string {
	return "你是小说写作 Agent B。只能依据已确认的 approvedPlan 和当前章节/场景上下文写作，不得改变世界观、人物关系或章节结果。只返回符合约定 JSON 的结构化结果，不输出 Markdown。"
}

func writerUserPrompt(plan Plan, input WorkflowInput, write WriteInput, review *Review) string {
	body, _ := json.Marshal(map[string]any{"plan": plan, "input": input, "write": write, "previousReview": review})
	return string(body)
}

func revisionUserPrompt(plan Plan, draft Draft, input RevisionInput) string {
	body, _ := json.Marshal(map[string]any{"plan": plan, "draft": draft, "revision": input})
	return string(body)
}

func reviewerSystemPrompt() string {
	return "你是小说复核 Agent C。检查剧情质量、作者风格、原创性与安全风险，必须提供证据、位置、严重程度和路由。只返回符合约定 JSON 的结构化结果，不输出 Markdown。"
}

func reviewerUserPrompt(plan Plan, draft Draft) string {
	body, _ := json.Marshal(map[string]any{"plan": plan, "draft": draft})
	return string(body)
}
