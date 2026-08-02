package foodrecommendation

import (
	"context"
	"testing"
)

func TestStoreSavesQueryAndFeedback(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	if err := store.SaveQuery(ctx, "user-1", "food_1", "成都武侯区", "成都", "武侯区", `{"summary":"摘要","items":[{"dishId":"cd-bingfen"}]}`); err != nil {
		t.Fatalf("save query: %v", err)
	}
	items, err := store.ListQueries(ctx, "user-1", 10)
	if err != nil {
		t.Fatalf("list queries: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 history item, got %d", len(items))
	}
	if items[0].QueryID != "food_1" || items[0].DishCount != 1 || items[0].City != "成都" {
		t.Fatalf("unexpected history item %#v", items[0])
	}

	if err := store.SaveFeedback(ctx, "user-1", FeedbackInput{
		QueryID: "food_1",
		DishID:  "cd-bingfen",
		Helpful: true,
	}); err != nil {
		t.Fatalf("save feedback: %v", err)
	}

	if err := store.AddFavorite(ctx, "user-1", "cd-bingfen"); err != nil {
		t.Fatalf("add favorite: %v", err)
	}
	favorites, err := store.ListFavorites(ctx, "user-1")
	if err != nil {
		t.Fatalf("list favorites: %v", err)
	}
	if len(favorites) != 1 || favorites[0] != "cd-bingfen" {
		t.Fatalf("unexpected favorites %#v", favorites)
	}
	if err := store.RemoveFavorite(ctx, "user-1", "cd-bingfen"); err != nil {
		t.Fatalf("remove favorite: %v", err)
	}
	favorites, err = store.ListFavorites(ctx, "user-1")
	if err != nil {
		t.Fatalf("list favorites after remove: %v", err)
	}
	if len(favorites) != 0 {
		t.Fatalf("expected empty favorites, got %#v", favorites)
	}
}
