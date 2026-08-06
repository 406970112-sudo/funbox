package leftovermanager

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestStoreCreatesAndUpdatesLeftover(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createLeftoverUsersTable(t, store.db)
	now := time.Now().UnixMilli()
	input := ItemInput{
		Name:              "昨天的红烧肉",
		SourceType:        SourceLeftover,
		EnteredFridgeAt:   now - 20*60*60*1000,
		ExpectedConsumeAt: now + 2*60*60*1000,
		StoredZone:        ZoneFridge,
		RemainingPercent:  50,
		RemainingText:     "一半",
		Tags:              []string{"红烧肉", "米饭"},
		CostCents:         1800,
		Notes:             "加热时加一点水",
	}
	item, err := store.CreateItem(context.Background(), "user-1", input)
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	if item.Name != "昨天的红烧肉" || item.Status != StatusActive {
		t.Fatalf("unexpected item: %+v", item)
	}

	if _, err := store.CreateItem(context.Background(), "user-1", input); err == nil ||
		!strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("expected duplicate error, got %v", err)
	}

	input.Name = "今天的红烧肉"
	input.RemainingPercent = 30
	updated, err := store.UpdateItem(context.Background(), "user-1", item.ID, input)
	if err != nil {
		t.Fatalf("update item: %v", err)
	}
	if updated.Name != "今天的红烧肉" || updated.RemainingPercent != 30 {
		t.Fatalf("unexpected updated item: %+v", updated)
	}
}

func TestStoreReheatEatDiscardAndHistory(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createLeftoverUsersTable(t, store.db)
	now := time.Now().UnixMilli()
	item, err := store.CreateItem(context.Background(), "user-1", ItemInput{
		Name:              "半盒草莓",
		SourceType:        SourceOpened,
		EnteredFridgeAt:   now - 4*60*60*1000,
		ExpectedConsumeAt: now + 8*60*60*1000,
		StoredZone:        ZoneFridge,
		RemainingPercent:  50,
		RemainingText:     "半盒",
		CostCents:         1500,
	})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	reheated, err := store.Reheat(context.Background(), "user-1", item.ID)
	if err != nil {
		t.Fatalf("reheat item: %v", err)
	}
	if reheated.ReheatCount != 1 {
		t.Fatalf("unexpected reheat count: %+v", reheated)
	}
	eaten, err := store.MarkEaten(context.Background(), "user-1", item.ID)
	if err != nil {
		t.Fatalf("mark eaten: %v", err)
	}
	if eaten.Status != StatusEaten || eaten.EatenAt == nil {
		t.Fatalf("unexpected eaten item: %+v", eaten)
	}
	history, err := store.History(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(history.Items) != 1 || history.Summary.ThisWeekEaten != 1 {
		t.Fatalf("unexpected history: %+v", history)
	}

	second, err := store.CreateItem(context.Background(), "user-1", ItemInput{
		Name:              "隔夜豆浆",
		SourceType:        SourceTakeout,
		EnteredFridgeAt:   now - 30*60*60*1000,
		ExpectedConsumeAt: now - 1*60*60*1000,
		StoredZone:        ZoneFridge,
		RemainingPercent:  40,
		CostCents:         600,
	})
	if err != nil {
		t.Fatalf("create second item: %v", err)
	}
	discarded, err := store.MarkDiscarded(context.Background(), "user-1", second.ID, "变质")
	if err != nil {
		t.Fatalf("mark discarded: %v", err)
	}
	if discarded.Status != StatusDiscarded || discarded.DiscardReason != "变质" {
		t.Fatalf("unexpected discarded item: %+v", discarded)
	}
	history, err = store.History(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("history after discard: %v", err)
	}
	if history.Summary.ThisWeekDiscarded != 1 || history.Summary.WasteCents != 600 {
		t.Fatalf("unexpected history summary: %+v", history.Summary)
	}
}

func TestStoreSuggestionsUseRealItemsOnly(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createLeftoverUsersTable(t, store.db)
	now := time.Now().UnixMilli()
	_, err = store.CreateItem(context.Background(), "user-1", ItemInput{
		Name:              "西红柿",
		SourceType:        SourceIngredient,
		EnteredFridgeAt:   now - 10*60*60*1000,
		ExpectedConsumeAt: now + 24*60*60*1000,
		StoredZone:        ZoneFridge,
		RemainingPercent:  100,
		Tags:              []string{"西红柿"},
	})
	if err != nil {
		t.Fatalf("create tomato: %v", err)
	}
	_, err = store.CreateItem(context.Background(), "user-1", ItemInput{
		Name:              "鸡蛋",
		SourceType:        SourceIngredient,
		EnteredFridgeAt:   now - 10*60*60*1000,
		ExpectedConsumeAt: now + 48*60*60*1000,
		StoredZone:        ZoneFridge,
		RemainingPercent:  100,
		Tags:              []string{"鸡蛋"},
	})
	if err != nil {
		t.Fatalf("create egg: %v", err)
	}
	home, err := store.Home(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("home: %v", err)
	}
	found := false
	for _, suggestion := range home.Suggestions {
		if suggestion.RecipeID == "tomato-scrambled-eggs" {
			found = true
			if suggestion.MatchPercent != 100 || len(suggestion.MatchedItems) != 2 {
				t.Fatalf("unexpected suggestion: %+v", suggestion)
			}
		}
	}
	if !found {
		t.Fatalf("expected tomato scrambled eggs suggestion, got %+v", home.Suggestions)
	}
}

func TestStoreSettingsAndClear(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createLeftoverUsersTable(t, store.db)
	now := time.Now().UnixMilli()
	_, err = store.CreateItem(context.Background(), "user-1", ItemInput{
		Name:              "午餐肉",
		SourceType:        SourceOpened,
		EnteredFridgeAt:   now - 10*60*60*1000,
		ExpectedConsumeAt: now + 12*60*60*1000,
		StoredZone:        ZoneFridge,
		RemainingPercent:  50,
	})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	settings, err := store.UpdateSettings(context.Background(), "user-1", SettingsInput{
		RemindBeforeHours: 4,
		Daily09Enabled:    true,
	})
	if err != nil {
		t.Fatalf("update settings: %v", err)
	}
	if settings.RemindBeforeHours != 4 || !settings.Daily09Enabled {
		t.Fatalf("unexpected settings: %+v", settings)
	}
	if err := store.ClearData(context.Background(), "user-1"); err != nil {
		t.Fatalf("clear data: %v", err)
	}
	items, err := store.ListItems(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("list after clear: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected empty items after clear, got %+v", items)
	}
}

func createLeftoverUsersTable(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL UNIQUE
	)`); err != nil {
		t.Fatalf("create users table: %v", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO users (id, username) VALUES ('user-1', 'leftover-user')`); err != nil {
		t.Fatalf("insert users table: %v", err)
	}
}
