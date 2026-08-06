package procrastinator

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	_ "modernc.org/sqlite"
)

func TestCreateGoalAndXPFlow(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createUsersTable(t, store.db)

	goal, err := store.CreateGoal(context.Background(), "user-1", GoalInput{
		Title: "整理房间",
		Steps: []StepInput{
			{Title: "只把桌上的垃圾扔掉", EstimatedMinutes: 3},
			{Title: "桌面物品放回原位", EstimatedMinutes: 5},
		},
	})
	if err != nil {
		t.Fatalf("create goal: %v", err)
	}
	if len(goal.Steps) != 2 {
		t.Fatalf("expected 2 steps, got %d", len(goal.Steps))
	}
	if goal.ExpectedXP != StepXP(3)+StepXP(5)+GoalBonusXP() {
		t.Fatalf("unexpected expected XP %d", goal.ExpectedXP)
	}
	first := goal.Steps[0]
	updated, err := store.CompleteStep(context.Background(), "user-1", first.ID, "2026-08-06")
	if err != nil {
		t.Fatalf("complete first step: %v", err)
	}
	if updated.CompletedSteps != 1 || updated.XPEarned != StepXP(3) {
		t.Fatalf("unexpected progress: %+v", updated)
	}
	second := updated.Steps[1]
	completed, err := store.CompleteStep(context.Background(), "user-1", second.ID, "2026-08-06")
	if err != nil {
		t.Fatalf("complete second step: %v", err)
	}
	if completed.Status != GoalStatusCompleted {
		t.Fatalf("expected completed goal")
	}
	ledger, err := store.Ledger(context.Background(), "user-1", LedgerFilter{})
	if err != nil {
		t.Fatalf("load ledger: %v", err)
	}
	if ledger.TotalXP != StepXP(3)+StepXP(5)+GoalBonusXP() {
		t.Fatalf("unexpected ledger XP %d", ledger.TotalXP)
	}
	reopened, err := store.UndoStep(context.Background(), "user-1", second.ID, "2026-08-07")
	if err != nil {
		t.Fatalf("undo step: %v", err)
	}
	if reopened.Status != GoalStatusActive {
		t.Fatalf("expected active goal")
	}
	ledger, err = store.Ledger(context.Background(), "user-1", LedgerFilter{})
	if err != nil {
		t.Fatalf("load ledger after undo: %v", err)
	}
	if ledger.TotalXP != StepXP(3) {
		t.Fatalf("expected only first step XP, got %d", ledger.TotalXP)
	}
	_, err = store.CompleteStep(context.Background(), "user-1", first.ID, "2026-08-08")
	if !errors.Is(err, ErrAlreadyCompleted) {
		t.Fatalf("expected already completed error, got %v", err)
	}
}

func TestDeleteStepRecomputesGoalBonus(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createUsersTable(t, store.db)
	goal, err := store.CreateGoal(context.Background(), "user-1", GoalInput{
		Title: "写完周报",
		Steps: []StepInput{
			{Title: "列提纲", EstimatedMinutes: 4},
			{Title: "写正文", EstimatedMinutes: 8},
			{Title: "检查格式", EstimatedMinutes: 6},
		},
	})
	if err != nil {
		t.Fatalf("create goal: %v", err)
	}
	for _, step := range goal.Steps[:2] {
		if _, err := store.CompleteStep(context.Background(), "user-1", step.ID, "2026-08-06"); err != nil {
			t.Fatalf("complete step: %v", err)
		}
	}
	active, err := store.GetGoal(context.Background(), "user-1", goal.ID)
	if err != nil {
		t.Fatalf("get goal: %v", err)
	}
	afterDelete, err := store.DeleteStep(context.Background(), "user-1", goal.ID, active.Steps[2].ID)
	if err != nil {
		t.Fatalf("delete step: %v", err)
	}
	if afterDelete.Status != GoalStatusCompleted {
		t.Fatalf("expected completed goal after deleting pending step")
	}
	ledger, err := store.Ledger(context.Background(), "user-1", LedgerFilter{})
	if err != nil {
		t.Fatalf("load ledger: %v", err)
	}
	if ledger.TotalXP != StepXP(4)+StepXP(8)+GoalBonusXP() {
		t.Fatalf("unexpected ledger XP %d", ledger.TotalXP)
	}
}

func TestStepXPFormula(t *testing.T) {
	if StepXP(3) != 8 || StepXP(25) != 30 || StepXP(120) != 30 {
		t.Fatalf("unexpected step XP formula")
	}
}

func createUsersTable(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL UNIQUE
	)`); err != nil {
		t.Fatalf("create users table: %v", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO users (id, username) VALUES ('user-1', 'procrastinator-user')`); err != nil {
		t.Fatalf("insert users table: %v", err)
	}
}
