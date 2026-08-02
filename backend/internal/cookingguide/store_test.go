package cookingguide

import (
	"context"
	"testing"
)

func TestStorePersistsSessionFeedbackFavoriteAndHistory(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()

	if _, err := store.UpsertSession(ctx, "user-1", Session{
		DishID:     "52947",
		StepIndex:  1,
		TotalSteps: 9,
		Completed:  false,
		UpdatedAt:  nowISO(),
	}); err != nil {
		t.Fatalf("upsert session: %v", err)
	}
	if err := store.RecordView(ctx, "user-1", "52945"); err != nil {
		t.Fatalf("record view: %v", err)
	}
	if err := store.AddFavorite(ctx, "user-1", "52947"); err != nil {
		t.Fatalf("add favorite: %v", err)
	}
	history, err := store.ListHistory(ctx, "user-1", 20)
	if err != nil {
		t.Fatalf("history: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("expected 2 history items, got %d", len(history))
	}
	favorites, err := store.ListFavorites(ctx, "user-1")
	if err != nil {
		t.Fatalf("favorites: %v", err)
	}
	if len(favorites) != 1 || favorites[0] != "52947" {
		t.Fatalf("unexpected favorites %#v", favorites)
	}
	if err := store.RemoveFavorite(ctx, "user-1", "52947"); err != nil {
		t.Fatalf("remove favorite: %v", err)
	}
}

func TestStoreContributionLifecycle(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()
	ctx := context.Background()

	item, err := store.CreateContribution(ctx, "user-1", ContributionInput{
		Name:        "红烧肉",
		Area:        "中式",
		Ingredients: []string{"五花肉", "冰糖"},
		Steps:       []string{"焯水", "炖煮"},
	})
	if err != nil {
		t.Fatalf("create contribution: %v", err)
	}
	items, err := store.ListContributions(ctx, ContributionPending)
	if err != nil {
		t.Fatalf("list contributions: %v", err)
	}
	if len(items) != 1 || items[0].ID != item.ID {
		t.Fatalf("unexpected contributions %#v", items)
	}
	reviewed, err := store.UpdateContributionStatus(ctx, item.ID, ContributionApproved, "admin-1", "审核通过")
	if err != nil {
		t.Fatalf("update contribution: %v", err)
	}
	if reviewed.Status != ContributionApproved {
		t.Fatalf("expected approved contribution, got %q", reviewed.Status)
	}
}
