package cooling

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestCoolingFlow(t *testing.T) {
	ctx := context.Background()
	store := openCoolingStoreForTest(t)
	userID := "user-1"

	settings, err := store.SaveSettings(ctx, userID, SettingsInput{
		MonthlySalaryCents: 10000000,
		MonthlyWorkHours:   160,
		WageSource:         WageMonthly,
	})
	if err != nil {
		t.Fatalf("save settings: %v", err)
	}
	if settings.EffectiveHourlyWageCents == nil || *settings.EffectiveHourlyWageCents != 62500 {
		t.Fatalf("expected hourly wage 62500, got %v", settings.EffectiveHourlyWageCents)
	}

	input := ItemInput{
		Name:       "无线耳机",
		PriceCents: 129900,
		Currency:   "CNY",
		SourceType: SourceManual,
		Answers: Answers{
			WhyBuy:         WhyPromo,
			SimilarCount:   SimilarOne,
			SimilarInUse:   "no",
			UsageFrequency: UseRarely,
			WantsAfter24h:  WantsUnsure,
		},
	}
	item, err := store.CreateItem(ctx, userID, input)
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	if item.Status != StatusCooling {
		t.Fatalf("expected cooling, got %s", item.Status)
	}
	if item.EquivalentHours == nil || *item.EquivalentHours < 2.07 || *item.EquivalentHours > 2.09 {
		t.Fatalf("unexpected equivalent hours: %v", item.EquivalentHours)
	}
	if item.RiskLevel != RiskHigh {
		t.Fatalf("expected high risk, got %s", item.RiskLevel)
	}

	if count, err := store.MarkExpired(ctx, item.CoolEndsAt.Add(time.Second)); err != nil {
		t.Fatalf("mark expired: %v", err)
	} else if count != 1 {
		t.Fatalf("expected 1 expired item, got %d", count)
	}
	pending, err := store.GetItem(ctx, userID, item.ID)
	if err != nil {
		t.Fatalf("get pending item: %v", err)
	}
	if pending.Status != StatusPendingDecision {
		t.Fatalf("expected pending decision, got %s", pending.Status)
	}

	decided, err := store.DecideItem(ctx, userID, item.ID, DecisionInput{Action: "drop", Note: "不需要了"})
	if err != nil {
		t.Fatalf("decide drop: %v", err)
	}
	if decided.Status != StatusDropped {
		t.Fatalf("expected dropped, got %s", decided.Status)
	}
	stats, err := store.Stats(ctx, userID)
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if stats.DroppedAmountCents != 129900 {
		t.Fatalf("expected dropped amount 129900, got %d", stats.DroppedAmountCents)
	}

	restored, err := store.UndoItem(ctx, userID, item.ID)
	if err != nil {
		t.Fatalf("undo: %v", err)
	}
	if restored.Status != StatusPendingDecision {
		t.Fatalf("expected pending after undo, got %s", restored.Status)
	}

	extended, err := store.ExtendItem(ctx, userID, item.ID)
	if err != nil {
		t.Fatalf("extend: %v", err)
	}
	if extended.Status != StatusCooling || extended.ExtendCount != 1 {
		t.Fatalf("unexpected extended state: %s %d", extended.Status, extended.ExtendCount)
	}

	if err := store.ClearData(ctx, userID); err != nil {
		t.Fatalf("clear data: %v", err)
	}
	items, err := store.ListItems(ctx, userID, RecordFilter{})
	if err != nil {
		t.Fatalf("list after clear: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected empty items after clear, got %d", len(items))
	}
}

func TestCoolingValidation(t *testing.T) {
	ctx := context.Background()
	store := openCoolingStoreForTest(t)
	userID := "user-2"

	_, err := store.CreateItem(ctx, userID, ItemInput{
		Name:       "测试",
		PriceCents: -1,
		Currency:   "CNY",
		Answers: Answers{
			WhyBuy:         WhyNeed,
			SimilarCount:   SimilarNone,
			UsageFrequency: UseDaily,
			WantsAfter24h:  WantsYes,
		},
	})
	if err == nil {
		t.Fatal("expected invalid price error")
	}
}

func openCoolingStoreForTest(t *testing.T) *Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "cooling.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if _, err := db.Exec(`CREATE TABLE users (id TEXT PRIMARY KEY)`); err != nil {
		t.Fatalf("create users table: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO users (id) VALUES ('user-1'), ('user-2')`); err != nil {
		t.Fatalf("seed users table: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close test db: %v", err)
	}
	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("open cooling store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}
