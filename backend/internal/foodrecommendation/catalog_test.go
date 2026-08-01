package foodrecommendation

import "testing"

func TestCatalogLoadsValidDishes(t *testing.T) {
	catalog, err := LoadCatalog()
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	if len(catalog) < 10 {
		t.Fatalf("catalog should contain at least 10 dishes, got %d", len(catalog))
	}

	seen := map[string]bool{}
	cities := map[string]bool{}
	for _, dish := range catalog {
		if seen[dish.ID] {
			t.Fatalf("duplicate dish id %q", dish.ID)
		}
		seen[dish.ID] = true
		cities[dish.City] = true
		if len(dish.Ingredients) == 0 || len(dish.FlavorProfile) == 0 || len(dish.SuitableFor) == 0 || len(dish.Reasons) == 0 {
			t.Fatalf("dish %q is missing structured fields", dish.ID)
		}
		if dish.Image.URL == "" || dish.Restaurant.Address == "" || dish.Restaurant.DistanceKm <= 0 {
			t.Fatalf("dish %q has invalid location or image data", dish.ID)
		}
	}
	if !cities["成都"] || !cities["重庆"] {
		t.Fatalf("expected Chengdu and Chongqing seed data, got %v", cities)
	}
}
