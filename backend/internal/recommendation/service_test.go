package recommendation

import (
	"context"
	"testing"

	"my-first-expo-app/backend/internal/config"
)

func TestQueryUsesFallbackWithoutDeepSeek(t *testing.T) {
	service := NewService(config.DeepSeekConfig{}, nil)
	minBudget := 2000
	maxBudget := 3000
	result, err := service.Query(context.Background(), Request{
		Category:  "phone",
		BudgetMin: &minBudget,
		BudgetMax: &maxBudget,
		Scenarios: []string{"游戏", "续航"},
		Brands:    []string{},
		Platforms: []string{},
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if result.AI != AIFallback {
		t.Fatalf("expected fallback mode, got %q", result.AI)
	}
	if len(result.Items) == 0 {
		t.Fatal("expected recommendation items")
	}
	for _, item := range result.Items {
		if item.FitScore <= 0 {
			t.Fatalf("item %q has no fit score", item.ProductID)
		}
		if len(item.Reasons) == 0 {
			t.Fatalf("item %q has no reasons", item.ProductID)
		}
		if len(item.Links) == 0 {
			t.Fatalf("item %q has no links", item.ProductID)
		}
		if item.ReferencePrice < minBudget || item.ReferencePrice > maxBudget {
			t.Fatalf("item %q price %d outside budget", item.ProductID, item.ReferencePrice)
		}
	}
}

func TestQueryParsesNaturalLanguage(t *testing.T) {
	service := NewService(config.DeepSeekConfig{}, nil)
	result, err := service.Query(context.Background(), Request{
		Query: "想买手机，预算 3000 左右，主要打游戏和续航",
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if result.Category != "phone" {
		t.Fatalf("expected phone category, got %q", result.Category)
	}
	if result.Budget == nil {
		t.Fatal("expected parsed budget")
	}
	if len(result.Items) == 0 {
		t.Fatal("expected recommendation items")
	}
}

func TestQueryRespectsBrandFilter(t *testing.T) {
	service := NewService(config.DeepSeekConfig{}, nil)
	minBudget := 5000
	maxBudget := 9000
	result, err := service.Query(context.Background(), Request{
		Category:  "phone",
		BudgetMin: &minBudget,
		BudgetMax: &maxBudget,
		Brands:    []string{"苹果"},
	}, "")
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(result.Items) == 0 {
		t.Fatal("expected Apple phones")
	}
	for _, item := range result.Items {
		if item.Brand != "苹果" {
			t.Fatalf("unexpected brand %q", item.Brand)
		}
	}
}

func TestQueryRejectsInvalidBudget(t *testing.T) {
	service := NewService(config.DeepSeekConfig{}, nil)
	minBudget := 3000
	maxBudget := 2000
	_, err := service.Query(context.Background(), Request{
		Category:  "phone",
		BudgetMin: &minBudget,
		BudgetMax: &maxBudget,
	}, "")
	if err == nil {
		t.Fatal("expected invalid budget error")
	}
}
