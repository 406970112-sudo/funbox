package shoppingroute

import (
	"context"
	"database/sql"
	"testing"
)

func TestShoppingRouteStoreFlow(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createShoppingRouteUsersTable(t, store.db)
	ctx := context.Background()

	list, err := store.CreateList(ctx, "user-1", "家庭采购")
	if err != nil {
		t.Fatalf("create list: %v", err)
	}
	item, err := store.AddItem(ctx, "user-1", Item{
		ListID:   list.ID,
		Name:     "西红柿",
		Quantity: "2个",
		Source:   SourceUser,
	})
	if err != nil {
		t.Fatalf("add item: %v", err)
	}
	cleaner, err := store.AddItem(ctx, "user-1", Item{
		ListID:   list.ID,
		Name:     "洗洁精",
		Quantity: "1瓶",
		Source:   SourceUser,
	})
	if err != nil {
		t.Fatalf("add cleaner item: %v", err)
	}

	storeProfile, err := store.CreateStore(ctx, "user-1", StoreProfile{Name: "常去超市"})
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	zones, err := store.SetZones(ctx, "user-1", storeProfile.ID, []ZoneInput{
		{Name: "蔬菜区", ZoneType: ZoneTypeProduce},
		{Name: "日用品区", ZoneType: ZoneTypeHousehold},
	})
	if err != nil {
		t.Fatalf("set zones: %v", err)
	}
	if len(zones) != 2 {
		t.Fatalf("unexpected zones: %+v", zones)
	}

	householdZone := zones[1]
	if _, err := store.SaveMapping(ctx, "user-1", Mapping{
		ItemKey:  cleaner.NormalizedName,
		ZoneType: householdZone.ZoneType,
		StoreID:  storeProfile.ID,
		ZoneID:   householdZone.ID,
		Source:   SourceUser,
	}); err != nil {
		t.Fatalf("save mapping: %v", err)
	}

	route, err := store.CreateRoute(ctx, "user-1", list.ID, storeProfile.ID)
	if err != nil {
		t.Fatalf("create route: %v", err)
	}
	if route.MappedCount != 2 || route.UnmappedCount != 0 || route.TotalCount != 2 {
		t.Fatalf("unexpected route: %+v", route)
	}

	updated, err := store.UpdateRouteItem(ctx, "user-1", route.ID, item.ID, true)
	if err != nil {
		t.Fatalf("update route item: %v", err)
	}
	if updated.Status != RouteStatusActive {
		t.Fatalf("expected active route, got %+v", updated)
	}
	completed, err := store.CompleteRoute(ctx, "user-1", route.ID)
	if err != nil {
		t.Fatalf("complete route: %v", err)
	}
	if completed.Status != RouteStatusComplete || completed.CompletedAt <= 0 {
		t.Fatalf("unexpected completed route: %+v", completed)
	}
	history, err := store.ListHistory(ctx, "user-1")
	if err != nil {
		t.Fatalf("list history: %v", err)
	}
	if len(history) != 1 || history[0].ID != route.ID {
		t.Fatalf("unexpected history: %+v", history)
	}
}

func TestShoppingRouteRejectsInvalidInput(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	createShoppingRouteUsersTable(t, store.db)
	if _, err := store.CreateList(context.Background(), "user-1", ""); err == nil {
		t.Fatalf("expected empty list name rejected")
	}
}

func createShoppingRouteUsersTable(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT NOT NULL UNIQUE
	)`); err != nil {
		t.Fatalf("create users table: %v", err)
	}
	if _, err := db.Exec(`INSERT OR IGNORE INTO users (id, username) VALUES ('user-1', 'shopping-route-user')`); err != nil {
		t.Fatalf("insert users table: %v", err)
	}
}
