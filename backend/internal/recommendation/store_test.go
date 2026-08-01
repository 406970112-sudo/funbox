package recommendation

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
	if err := store.SaveQuery(ctx, "user-1", "rec_1", "想买手机", "phone", `{"summary":"摘要","items":[{"productId":"redmi-k80"}]}`); err != nil {
		t.Fatalf("save query: %v", err)
	}
	items, err := store.ListQueries(ctx, "user-1", 10)
	if err != nil {
		t.Fatalf("list queries: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 history item, got %d", len(items))
	}
	if items[0].QueryID != "rec_1" || items[0].ProductCount != 1 {
		t.Fatalf("unexpected history item %#v", items[0])
	}

	if err := store.SaveFeedback(ctx, "user-1", FeedbackInput{
		QueryID:   "rec_1",
		ProductID: "redmi-k80",
		Helpful:   true,
	}); err != nil {
		t.Fatalf("save feedback: %v", err)
	}
}
