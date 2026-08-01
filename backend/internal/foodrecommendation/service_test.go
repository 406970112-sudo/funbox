package foodrecommendation

import (
	"context"
	"testing"

	"my-first-expo-app/backend/internal/config"
)

func TestQueryReturnsFallbackFoodRecommendations(t *testing.T) {
	service := NewService(config.DeepSeekConfig{}, nil)
	result, err := service.Query(context.Background(), Request{
		Query:    "成都市武侯区玉林西路 12 号",
		District: "武侯区",
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if result.AI != AIFallback {
		t.Fatalf("expected fallback mode, got %q", result.AI)
	}
	if result.City != "成都" {
		t.Fatalf("expected Chengdu, got %q", result.City)
	}
	if len(result.Items) == 0 {
		t.Fatal("expected food recommendation items")
	}
	for _, item := range result.Items {
		if item.DishID == "" || item.Name == "" {
			t.Fatalf("item is missing identity")
		}
		if len(item.Ingredients) == 0 || len(item.FlavorProfile) == 0 {
			t.Fatalf("item %q is missing food facts", item.DishID)
		}
		if item.Image.URL == "" || item.Restaurant.Address == "" {
			t.Fatalf("item %q is missing image or restaurant", item.DishID)
		}
		if len(item.Reasons) == 0 {
			t.Fatalf("item %q has no reasons", item.DishID)
		}
	}
}

func TestQueryParsesCityFromNaturalLanguage(t *testing.T) {
	service := NewService(config.DeepSeekConfig{}, nil)
	result, err := service.Query(context.Background(), Request{
		Query: "重庆解放碑附近有什么好吃的",
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if result.City != "重庆" {
		t.Fatalf("expected Chongqing, got %q", result.City)
	}
	if result.District != "渝中区" {
		t.Fatalf("expected Yuzhong district, got %q", result.District)
	}
	if len(result.Items) == 0 {
		t.Fatal("expected Chongqing recommendations")
	}
	for _, item := range result.Items {
		if item.City != "重庆" {
			t.Fatalf("unexpected city %q", item.City)
		}
	}
}

func TestQueryRespectsNotSpicyDietary(t *testing.T) {
	service := NewService(config.DeepSeekConfig{}, nil)
	result, err := service.Query(context.Background(), Request{
		Query:    "成都武侯区，不要辣",
		District: "武侯区",
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(result.Items) == 0 {
		t.Fatal("expected non-spicy recommendations")
	}
	for _, item := range result.Items {
		if item.Spiciness != "不辣" {
			t.Fatalf("item %q should be non-spicy, got %q", item.DishID, item.Spiciness)
		}
	}
}

func TestQueryRespectsDistanceAndPriceFilters(t *testing.T) {
	service := NewService(config.DeepSeekConfig{}, nil)
	maxPrice := 30
	maxDistance := 1.0
	result, err := service.Query(context.Background(), Request{
		City:          "成都",
		District:      "武侯区",
		PriceMax:      &maxPrice,
		DistanceMaxKm: &maxDistance,
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(result.Items) == 0 {
		t.Fatal("expected matching recommendations")
	}
	for _, item := range result.Items {
		if item.AvgPrice > maxPrice {
			t.Fatalf("item %q price %d exceeds filter", item.DishID, item.AvgPrice)
		}
		if item.DistanceKm > maxDistance {
			t.Fatalf("item %q distance %.2f exceeds filter", item.DishID, item.DistanceKm)
		}
	}
}

func TestQueryReturnsAvailableFilters(t *testing.T) {
	service := NewService(config.DeepSeekConfig{}, nil)
	result, err := service.Query(context.Background(), Request{
		City:     "成都",
		District: "武侯区",
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(result.AvailableFilters.Cuisines) == 0 {
		t.Fatal("expected cuisine filters")
	}
	if len(result.AvailableFilters.Spiciness) == 0 {
		t.Fatal("expected spiciness filters")
	}
	if len(result.AvailableFilters.PriceRanges) == 0 {
		t.Fatal("expected price filters")
	}
	if len(result.AvailableFilters.DistanceRanges) == 0 {
		t.Fatal("expected distance filters")
	}
}

func TestQueryRejectsInvalidPriceRange(t *testing.T) {
	service := NewService(config.DeepSeekConfig{}, nil)
	minPrice := 100
	maxPrice := 20
	_, err := service.Query(context.Background(), Request{
		City:     "成都",
		District: "武侯区",
		PriceMin: &minPrice,
		PriceMax: &maxPrice,
	}, "")
	if err == nil {
		t.Fatal("expected invalid price range error")
	}
}
