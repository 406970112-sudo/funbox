package novelagent

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

var (
	ErrNotFound = errors.New("novel agent workflow not found")
	ErrConflict = errors.New("novel agent workflow version conflict")
)

type Store struct {
	db *sql.DB
}

type CallLog struct {
	ID               string    `json:"id"`
	WorkflowID       string    `json:"workflowId"`
	OwnerID          string    `json:"-"`
	Role             Role      `json:"role"`
	Provider         string    `json:"provider"`
	Model            string    `json:"model"`
	Status           string    `json:"status"`
	Attempt          int       `json:"attempt"`
	LatencyMillis    int64     `json:"latencyMillis"`
	PromptTokens     int       `json:"promptTokens"`
	CompletionTokens int       `json:"completionTokens"`
	TotalTokens      int       `json:"totalTokens"`
	Error            string    `json:"error,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
}

func OpenStore(databasePath string) (*Store, error) {
	databasePath = strings.TrimSpace(databasePath)
	if databasePath == "" {
		return nil, fmt.Errorf("novel agent database path is empty")
	}
	if databasePath != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(databasePath), 0o755); err != nil {
			return nil, fmt.Errorf("create novel agent database directory: %w", err)
		}
	}
	db, err := sql.Open("sqlite", databasePath)
	if err != nil {
		return nil, fmt.Errorf("open novel agent database: %w", err)
	}
	db.SetMaxOpenConns(1)
	store := &Store{db: db}
	if err := store.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate() error {
	statements := []string{
		`PRAGMA busy_timeout = 5000`,
		`PRAGMA journal_mode = WAL`,
		`CREATE TABLE IF NOT EXISTS novel_agent_workflows (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			status TEXT NOT NULL,
			version INTEGER NOT NULL,
			input_json TEXT NOT NULL,
			messages_json TEXT NOT NULL,
			draft_plan_json TEXT,
			approved_plan_json TEXT,
			draft_json TEXT,
			review_json TEXT,
			attempts INTEGER NOT NULL DEFAULT 0,
			last_error TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_novel_agent_workflows_owner
			ON novel_agent_workflows(owner_id, updated_at DESC)`,
		`CREATE TABLE IF NOT EXISTS novel_agent_call_logs (
			id TEXT PRIMARY KEY,
			workflow_id TEXT NOT NULL,
			owner_id TEXT NOT NULL,
			role TEXT NOT NULL,
			provider TEXT NOT NULL,
			model TEXT NOT NULL,
			status TEXT NOT NULL,
			attempt INTEGER NOT NULL,
			latency_ms INTEGER NOT NULL,
			prompt_tokens INTEGER NOT NULL DEFAULT 0,
			completion_tokens INTEGER NOT NULL DEFAULT 0,
			total_tokens INTEGER NOT NULL DEFAULT 0,
			error TEXT,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_novel_agent_call_logs_workflow
			ON novel_agent_call_logs(workflow_id, created_at DESC)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("run novel agent database migration: %w", err)
		}
	}
	return nil
}

func (s *Store) Create(ctx context.Context, workflow Workflow) (Workflow, error) {
	if strings.TrimSpace(workflow.ID) == "" {
		workflow.ID = uuid.NewString()
	}
	if workflow.Version <= 0 {
		workflow.Version = 1
	}
	now := time.Now().UTC()
	if workflow.CreatedAt.IsZero() {
		workflow.CreatedAt = now
	}
	workflow.UpdatedAt = now
	values, err := workflowValues(workflow)
	if err != nil {
		return Workflow{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO novel_agent_workflows (
			id, owner_id, status, version, input_json, messages_json,
			draft_plan_json, approved_plan_json, draft_json, review_json,
			attempts, last_error, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, values...)
	if err != nil {
		return Workflow{}, fmt.Errorf("insert novel agent workflow: %w", err)
	}
	return workflow, nil
}

func (s *Store) Get(ctx context.Context, ownerID string, workflowID string) (Workflow, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, owner_id, status, version, input_json, messages_json,
		       draft_plan_json, approved_plan_json, draft_json, review_json,
		       attempts, last_error, created_at, updated_at
		FROM novel_agent_workflows
		WHERE id = ? AND owner_id = ?
	`, workflowID, ownerID)
	workflow, err := scanWorkflow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Workflow{}, ErrNotFound
	}
	if err != nil {
		return Workflow{}, fmt.Errorf("get novel agent workflow: %w", err)
	}
	return workflow, nil
}

func (s *Store) Update(ctx context.Context, ownerID string, workflowID string, expectedVersion int, workflow Workflow) (Workflow, error) {
	values, err := workflowValues(workflow)
	if err != nil {
		return Workflow{}, err
	}
	now := time.Now().UTC()
	values[2] = string(workflow.Status)
	values[3] = expectedVersion + 1
	values[12] = workflow.CreatedAt.UnixMilli()
	values[13] = now.UnixMilli()
	result, err := s.db.ExecContext(ctx, `
		UPDATE novel_agent_workflows SET
			status = ?, version = ?, input_json = ?, messages_json = ?,
			draft_plan_json = ?, approved_plan_json = ?, draft_json = ?, review_json = ?,
			attempts = ?, last_error = ?, created_at = ?, updated_at = ?
		WHERE id = ? AND owner_id = ? AND version = ?
	`, string(workflow.Status), expectedVersion+1, values[4], values[5], values[6], values[7], values[8], values[9], values[10], values[11], values[12], values[13], workflowID, ownerID, expectedVersion)
	if err != nil {
		return Workflow{}, fmt.Errorf("update novel agent workflow: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Workflow{}, fmt.Errorf("read novel agent update result: %w", err)
	}
	if affected == 0 {
		if _, getErr := s.Get(ctx, ownerID, workflowID); errors.Is(getErr, ErrNotFound) {
			return Workflow{}, ErrNotFound
		}
		return Workflow{}, ErrConflict
	}
	workflow.ID = workflowID
	workflow.OwnerID = ownerID
	workflow.Version = expectedVersion + 1
	workflow.UpdatedAt = now
	return workflow, nil
}

func (s *Store) AppendCallLog(ctx context.Context, log CallLog) error {
	if log.ID == "" {
		log.ID = uuid.NewString()
	}
	if log.CreatedAt.IsZero() {
		log.CreatedAt = time.Now().UTC()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO novel_agent_call_logs (
			id, workflow_id, owner_id, role, provider, model, status, attempt,
			latency_ms, prompt_tokens, completion_tokens, total_tokens, error, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, log.ID, log.WorkflowID, log.OwnerID, log.Role, log.Provider, log.Model, log.Status, log.Attempt,
		log.LatencyMillis, log.PromptTokens, log.CompletionTokens, log.TotalTokens, nullableString(log.Error), log.CreatedAt.UnixMilli())
	if err != nil {
		return fmt.Errorf("insert novel agent call log: %w", err)
	}
	return nil
}

func (s *Store) ListCallLogs(ctx context.Context, ownerID string, workflowID string) ([]CallLog, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, workflow_id, owner_id, role, provider, model, status, attempt,
		       latency_ms, prompt_tokens, completion_tokens, total_tokens, error, created_at
		FROM novel_agent_call_logs
		WHERE owner_id = ? AND workflow_id = ?
		ORDER BY created_at ASC, id ASC
	`, ownerID, workflowID)
	if err != nil {
		return nil, fmt.Errorf("list novel agent call logs: %w", err)
	}
	defer rows.Close()
	logs := []CallLog{}
	for rows.Next() {
		var log CallLog
		var role, errorText sql.NullString
		var createdAt int64
		if err := rows.Scan(&log.ID, &log.WorkflowID, &log.OwnerID, &role, &log.Provider, &log.Model, &log.Status, &log.Attempt, &log.LatencyMillis, &log.PromptTokens, &log.CompletionTokens, &log.TotalTokens, &errorText, &createdAt); err != nil {
			return nil, fmt.Errorf("scan novel agent call log: %w", err)
		}
		log.Role = Role(role.String)
		log.Error = errorText.String
		log.CreatedAt = time.UnixMilli(createdAt).UTC()
		logs = append(logs, log)
	}
	return logs, rows.Err()
}

func workflowValues(workflow Workflow) ([]any, error) {
	input, err := json.Marshal(workflow.Input)
	if err != nil {
		return nil, fmt.Errorf("marshal novel agent input: %w", err)
	}
	messages, err := json.Marshal(workflow.AMessages)
	if err != nil {
		return nil, fmt.Errorf("marshal novel agent messages: %w", err)
	}
	optional := func(value any) (any, error) {
		if value == nil {
			return nil, nil
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		return string(encoded), nil
	}
	draftPlan, err := optional(workflow.DraftPlan)
	if err != nil {
		return nil, fmt.Errorf("marshal novel agent draft plan: %w", err)
	}
	approvedPlan, err := optional(workflow.ApprovedPlan)
	if err != nil {
		return nil, fmt.Errorf("marshal novel agent approved plan: %w", err)
	}
	draft, err := optional(workflow.Draft)
	if err != nil {
		return nil, fmt.Errorf("marshal novel agent draft: %w", err)
	}
	review, err := optional(workflow.Review)
	if err != nil {
		return nil, fmt.Errorf("marshal novel agent review: %w", err)
	}
	return []any{
		workflow.ID,
		workflow.OwnerID,
		string(workflow.Status),
		workflow.Version,
		string(input),
		string(messages),
		draftPlan,
		approvedPlan,
		draft,
		review,
		workflow.Attempts,
		nullableString(workflow.LastError),
		workflow.CreatedAt.UnixMilli(),
		workflow.UpdatedAt.UnixMilli(),
	}, nil
}

func scanWorkflow(row interface{ Scan(...any) error }) (Workflow, error) {
	var workflow Workflow
	var status string
	var inputJSON, messagesJSON string
	var draftPlanJSON, approvedPlanJSON, draftJSON, reviewJSON sql.NullString
	var lastError sql.NullString
	var createdAt, updatedAt int64
	if err := row.Scan(&workflow.ID, &workflow.OwnerID, &status, &workflow.Version, &inputJSON, &messagesJSON, &draftPlanJSON, &approvedPlanJSON, &draftJSON, &reviewJSON, &workflow.Attempts, &lastError, &createdAt, &updatedAt); err != nil {
		return Workflow{}, err
	}
	workflow.Status = WorkflowStatus(status)
	workflow.LastError = lastError.String
	workflow.CreatedAt = time.UnixMilli(createdAt).UTC()
	workflow.UpdatedAt = time.UnixMilli(updatedAt).UTC()
	if err := json.Unmarshal([]byte(inputJSON), &workflow.Input); err != nil {
		return Workflow{}, fmt.Errorf("decode novel agent input: %w", err)
	}
	if err := json.Unmarshal([]byte(messagesJSON), &workflow.AMessages); err != nil {
		return Workflow{}, fmt.Errorf("decode novel agent messages: %w", err)
	}
	if err := unmarshalOptionalJSON(draftPlanJSON, &workflow.DraftPlan); err != nil {
		return Workflow{}, fmt.Errorf("decode novel agent draft plan: %w", err)
	}
	if err := unmarshalOptionalJSON(approvedPlanJSON, &workflow.ApprovedPlan); err != nil {
		return Workflow{}, fmt.Errorf("decode novel agent approved plan: %w", err)
	}
	if err := unmarshalOptionalJSON(draftJSON, &workflow.Draft); err != nil {
		return Workflow{}, fmt.Errorf("decode novel agent draft: %w", err)
	}
	if err := unmarshalOptionalJSON(reviewJSON, &workflow.Review); err != nil {
		return Workflow{}, fmt.Errorf("decode novel agent review: %w", err)
	}
	return workflow, nil
}

func unmarshalOptionalJSON(value sql.NullString, target any) error {
	if !value.Valid || strings.TrimSpace(value.String) == "" || value.String == "null" {
		return nil
	}
	return json.Unmarshal([]byte(value.String), target)
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}
