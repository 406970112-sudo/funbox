package homeconsumables

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"my-first-expo-app/backend/internal/user"
)

func TestHomeConsumablesFlow(t *testing.T) {
	ctx := context.Background()
	databasePath := filepath.Join(t.TempDir(), "app.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	t.Cleanup(func() { _ = userStore.Close() })
	account, err := userStore.Create(ctx, "13800138000", "hash", "消耗品用户", "问题", "hash")
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	store, err := OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	categories, err := store.EnsureDefaultCategories(ctx, account.ID)
	if err != nil {
		t.Fatalf("categories: %v", err)
	}
	if len(categories) != 9 {
		t.Fatalf("system categories = %d", len(categories))
	}
	var laundryCategoryID string
	for _, category := range categories {
		if category.Name == "洗衣液" {
			laundryCategoryID = category.ID
		}
	}
	startedAt := "2026-04-25"
	item, err := store.CreateItem(ctx, account.ID, ItemInput{
		CategoryID:            laundryCategoryID,
		Name:                  "洗衣液",
		Unit:                  "瓶",
		CurrentCycleStartedAt: &startedAt,
		RemindDays:            7,
	})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	addEvent(t, store, ctx, account.ID, item.ID, EventTypeCount, 2, "2026-04-25")
	addEvent(t, store, ctx, account.ID, item.ID, EventTypeReplace, 1, "2026-04-25")
	addEvent(t, store, ctx, account.ID, item.ID, EventTypeReplace, 1, "2026-05-09")
	addEvent(t, store, ctx, account.ID, item.ID, EventTypePurchase, 1, "2026-05-20")
	addEvent(t, store, ctx, account.ID, item.ID, EventTypeReplace, 1, "2026-05-21")
	addEvent(t, store, ctx, account.ID, item.ID, EventTypePurchase, 1, "2026-05-30")
	addEvent(t, store, ctx, account.ID, item.ID, EventTypeReplace, 1, "2026-05-31")
	addEvent(t, store, ctx, account.ID, item.ID, EventTypeCount, 0.5, "2026-06-15")

	loaded, err := store.GetItem(ctx, account.ID, item.ID)
	if err != nil {
		t.Fatalf("get item: %v", err)
	}
	if loaded.Prediction.RemainingDays == nil || *loaded.Prediction.RemainingDays != 6 {
		t.Fatalf("remaining days = %+v cycles=%+v", loaded.Prediction.RemainingDays, loaded.Prediction.Cycles)
	}
	if loaded.Prediction.SampleCount != 3 {
		t.Fatalf("sample count = %d", loaded.Prediction.SampleCount)
	}
	shopping, err := store.ShoppingList(ctx, account.ID, "2026-08-06")
	if err != nil {
		t.Fatalf("shopping list: %v", err)
	}
	if len(shopping.Items) != 1 {
		t.Fatalf("shopping list = %+v", shopping.Items)
	}
	if _, err := store.CreateEvent(ctx, account.ID, item.ID, EventInput{
		EventType:  EventTypeReplace,
		Quantity:   5,
		OccurredAt: timePtr("2026-08-01"),
	}); err == nil {
		t.Fatal("replace with insufficient stock should fail")
	}
}

func addEvent(t *testing.T, store *Store, ctx context.Context, userID string, itemID string, eventType string, quantity float64, date string) {
	t.Helper()
	_, err := store.CreateEvent(ctx, userID, itemID, EventInput{
		EventType:  eventType,
		Quantity:   quantity,
		OccurredAt: timePtr(date),
	})
	if err != nil {
		t.Fatalf("add event %s: %v", eventType, err)
	}
}

func timePtr(value string) *time.Time {
	parsed, err := time.Parse(time.RFC3339, value+"T12:00:00Z")
	if err != nil {
		return nil
	}
	return &parsed
}
