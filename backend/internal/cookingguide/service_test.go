package cookingguide

import (
	"context"
	"strings"
	"testing"
)

func TestSeedContainsRealDishes(t *testing.T) {
	seed, err := LoadSeed()
	if err != nil {
		t.Fatalf("load seed: %v", err)
	}
	if len(seed.Areas) < 8 {
		t.Fatalf("expected at least 8 areas, got %d", len(seed.Areas))
	}
	chinese := 0
	for _, dish := range seed.Dishes {
		if dish.Area == "Chinese" {
			chinese++
		}
	}
	if chinese < 20 {
		t.Fatalf("expected at least 20 Chinese dishes, got %d", chinese)
	}
}

func TestSearchReturnsRealKungDishes(t *testing.T) {
	service := NewService(nil)
	ctx := context.Background()
	result := service.Search(ctx, "kung", "", "", "", 10)
	if len(result.Items) != 2 {
		t.Fatalf("expected 2 kung dishes, got %d", len(result.Items))
	}
	for _, item := range result.Items {
		if !strings.Contains(strings.ToLower(item.Name), "kung") {
			t.Fatalf("unexpected dish %q", item.Name)
		}
	}
}

func TestSearchFiltersByArea(t *testing.T) {
	service := NewService(nil)
	result := service.Search(context.Background(), "", "Chinese", "", "", 100)
	if len(result.Items) == 0 {
		t.Fatalf("expected Chinese dishes")
	}
	for _, item := range result.Items {
		if item.Area != "Chinese" {
			t.Fatalf("unexpected area %q", item.Area)
		}
	}
}

func TestDetailAndShoppingList(t *testing.T) {
	service := NewService(nil)
	ctx := context.Background()
	detail, err := service.Detail(ctx, "52947")
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if detail.Name != "Ma Po Tofu" || len(detail.Ingredients) == 0 || len(detail.Steps) == 0 {
		t.Fatalf("unexpected detail %#v", detail)
	}
	if detail.Image.Source != "themealdb" || detail.RecipeSource == "" {
		t.Fatalf("dish is missing provenance fields")
	}
	list, err := service.ShoppingList(ctx, "52947")
	if err != nil {
		t.Fatalf("shopping list: %v", err)
	}
	if len(list.Items) == 0 || list.DishID != "52947" {
		t.Fatalf("unexpected shopping list %#v", list)
	}
}

func TestStoreDrivenFavoritesSessionsAndContributions(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	service := NewService(store)
	ctx := context.Background()

	if err := service.AddFavorite(ctx, "user-1", "52947"); err != nil {
		t.Fatalf("add favorite: %v", err)
	}
	favorites, err := service.ListFavorites(ctx, "user-1")
	if err != nil {
		t.Fatalf("list favorites: %v", err)
	}
	if len(favorites) != 1 || favorites[0].ID != "52947" {
		t.Fatalf("unexpected favorites %#v", favorites)
	}

	session, err := service.SaveSession(ctx, "user-1", SessionInput{DishID: "52947", StepIndex: 2})
	if err != nil {
		t.Fatalf("save session: %v", err)
	}
	if session.StepIndex != 2 || session.TotalSteps != len(service.findDishMust("52947").Steps) {
		t.Fatalf("unexpected session %#v", session)
	}
	completed := true
	session, err = service.SaveSession(ctx, "user-1", SessionInput{DishID: "52947", StepIndex: 99, Completed: &completed})
	if err != nil {
		t.Fatalf("complete session: %v", err)
	}
	if !session.Completed || session.StepIndex != session.TotalSteps-1 {
		t.Fatalf("unexpected completed session %#v", session)
	}

	history, err := service.History(ctx, "user-1", 20)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(history) == 0 {
		t.Fatalf("expected history")
	}

	item, err := service.CreateContribution(ctx, "user-1", ContributionInput{
		Name:        "番茄炒蛋",
		Area:        "中式",
		Category:    "家常菜",
		Ingredients: []string{"番茄", "鸡蛋"},
		Steps:       []string{"打散鸡蛋", "下锅翻炒"},
	})
	if err != nil {
		t.Fatalf("create contribution: %v", err)
	}
	if item.Status != ContributionPending {
		t.Fatalf("expected pending contribution, got %q", item.Status)
	}
	reviewed, err := service.ReviewContribution(ctx, item.ID, ContributionApproved, "admin-1", "ok")
	if err != nil {
		t.Fatalf("review contribution: %v", err)
	}
	if reviewed.Status != ContributionApproved {
		t.Fatalf("expected approved contribution, got %q", reviewed.Status)
	}
}

func (s *Service) findDishMust(id string) SeedDish {
	dish, ok := s.findDish(id)
	if !ok {
		panic("dish not found: " + id)
	}
	return dish
}
