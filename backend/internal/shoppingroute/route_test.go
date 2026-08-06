package shoppingroute

import (
	"testing"
)

func TestBuildRouteUsesVerifiedAndUserMappings(t *testing.T) {
	list := List{
		ID:   "list-1",
		Name: "家庭采购",
		Items: []Item{
			{ID: "item-1", Name: "西红柿", NormalizedName: normalizeName("西红柿"), Quantity: "2个"},
			{ID: "item-2", Name: "洗洁精", NormalizedName: normalizeName("洗洁精"), Quantity: "1瓶"},
			{ID: "item-3", Name: "未知商品", NormalizedName: normalizeName("未知商品"), Quantity: "1件"},
		},
	}
	store := StoreProfile{
		ID:    "store-1",
		Name:  "常去超市",
		Zones: testZones(),
	}
	route := BuildRoute(list, store, testZones(), []Mapping{
		{
			ItemKey:  normalizeName("洗洁精"),
			ZoneType: ZoneTypeHousehold,
			ZoneID:   "zone-household",
			StoreID:  store.ID,
			Source:   SourceUser,
		},
	})
	if route.MappedCount != 2 || route.UnmappedCount != 1 {
		t.Fatalf("unexpected mapping counts: %+v", route)
	}
	if len(route.Unmapped) != 1 || route.Unmapped[0].Item.Name != "未知商品" {
		t.Fatalf("unexpected unmapped items: %+v", route.Unmapped)
	}
	if len(route.Zones) != 3 {
		t.Fatalf("expected 3 zones, got %d", len(route.Zones))
	}
}

func TestBuildRouteWithoutZonesKeepsUnmapped(t *testing.T) {
	list := List{
		ID: "list-1",
		Items: []Item{
			{ID: "item-1", Name: "西红柿", NormalizedName: normalizeName("西红柿"), Quantity: "1个"},
		},
	}
	store := StoreProfile{ID: "store-1", Name: "无区域超市"}
	route := BuildRoute(list, store, nil, nil)
	if route.MappedCount != 0 || route.UnmappedCount != 1 {
		t.Fatalf("expected unmapped without zones: %+v", route)
	}
}

func TestUpdateRouteItemMarksComplete(t *testing.T) {
	list := List{
		ID: "list-1",
		Items: []Item{
			{ID: "item-1", Name: "西红柿", NormalizedName: normalizeName("西红柿"), Quantity: "1个"},
		},
	}
	store := StoreProfile{ID: "store-1", Name: "常去超市", Zones: testZones()}
	route := BuildRoute(list, store, testZones(), nil)
	if route.MappedCount != 1 {
		t.Fatalf("expected tomato mapped: %+v", route)
	}
	updateRouteItem(&route, "item-1", true)
	if !routeCompleted(route) {
		t.Fatalf("expected route complete: %+v", route)
	}
	updateRouteItem(&route, "item-1", false)
	if routeCompleted(route) {
		t.Fatalf("expected route not complete after uncheck")
	}
}

func testZones() []Zone {
	return []Zone{
		{ID: "zone-produce", Name: "蔬菜区", ZoneType: ZoneTypeProduce, Position: 1},
		{ID: "zone-dairy", Name: "冷藏区", ZoneType: ZoneTypeDairy, Position: 2},
		{ID: "zone-household", Name: "日用品区", ZoneType: ZoneTypeHousehold, Position: 3},
	}
}
