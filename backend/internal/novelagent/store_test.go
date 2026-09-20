package novelagent

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestStorePersistsWorkflowAcrossRestartAndScopesByOwner(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "novel-agent.db")
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	workflow := testWorkflow("wf-1", "user-1")
	created, err := store.Create(context.Background(), workflow)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Version != 1 || created.ID != "wf-1" {
		t.Fatalf("unexpected created workflow: %#v", created)
	}
	if _, err := store.Get(context.Background(), "user-2", "wf-1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner Get() error = %v, want ErrNotFound", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	store, err = OpenStore(databasePath)
	if err != nil {
		t.Fatalf("reopen OpenStore() error = %v", err)
	}
	defer store.Close()
	loaded, err := store.Get(context.Background(), "user-1", "wf-1")
	if err != nil {
		t.Fatalf("reloaded Get() error = %v", err)
	}
	if loaded.Input.Premise != workflow.Input.Premise || loaded.Status != StatusPlanning {
		t.Fatalf("reloaded workflow lost state: %#v", loaded)
	}
}

func TestStoreUsesOptimisticVersionAndRecordsCallLog(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("OpenStore() error = %v", err)
	}
	defer store.Close()

	workflow, err := store.Create(context.Background(), testWorkflow("wf-2", "user-1"))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	workflow.Status = StatusApproved
	updated, err := store.Update(context.Background(), "user-1", workflow.ID, workflow.Version, workflow)
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.Version != 2 {
		t.Fatalf("updated version = %d, want 2", updated.Version)
	}
	if _, err := store.Update(context.Background(), "user-1", workflow.ID, workflow.Version, workflow); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale Update() error = %v, want ErrConflict", err)
	}

	err = store.AppendCallLog(context.Background(), CallLog{
		WorkflowID:       workflow.ID,
		OwnerID:          "user-1",
		Role:             RoleWriter,
		Provider:         "deepseek",
		Model:            "writer-model",
		Status:           "success",
		Attempt:          1,
		LatencyMillis:    120,
		PromptTokens:     10,
		CompletionTokens: 20,
		TotalTokens:      30,
	})
	if err != nil {
		t.Fatalf("AppendCallLog() error = %v", err)
	}
	logs, err := store.ListCallLogs(context.Background(), "user-1", workflow.ID)
	if err != nil {
		t.Fatalf("ListCallLogs() error = %v", err)
	}
	if len(logs) != 1 || logs[0].TotalTokens != 30 || logs[0].Role != RoleWriter {
		t.Fatalf("unexpected call logs: %#v", logs)
	}
}

func testWorkflow(id, ownerID string) Workflow {
	now := time.Now().UTC().Truncate(time.Millisecond)
	return Workflow{
		ID:        id,
		OwnerID:   ownerID,
		Status:    StatusPlanning,
		Version:   1,
		Input:     WorkflowInput{Premise: "一个收到旧信的人"},
		AMessages: []Message{{Role: "user", Content: "先讨论结构", CreatedAt: now}},
		CreatedAt: now,
	}
}
