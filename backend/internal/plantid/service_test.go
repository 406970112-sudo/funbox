package plantid

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAnalyzeSafetyEdible(t *testing.T) {
	result := analyzeSafety("Helianthus annuus", []string{"Common sunflower", "向日葵"}, "其果实可食用，常作食材与榨油原料。")
	if result.State != safetyStateEdible {
		t.Fatalf("expected edible, got %s", result.State)
	}
	if !strings.Contains(result.Quote, "可食用") {
		t.Fatalf("quote should include the source sentence, got %q", result.Quote)
	}
}

func TestAnalyzeSafetyPoisonous(t *testing.T) {
	result := analyzeSafety("Nerium oleander", []string{"夹竹桃"}, "夹竹桃全株有毒。")
	if result.State != safetyStatePoisonous {
		t.Fatalf("expected poisonous from warning table, got %s", result.State)
	}
	result = analyzeSafety("Exampleia plantae", []string{}, "该植物含有毒性成分，不可食用。")
	if result.State != safetyStatePoisonous {
		t.Fatalf("expected poisonous from keyword, got %s", result.State)
	}
}

func TestAnalyzeSafetyUnknown(t *testing.T) {
	result := analyzeSafety("Exampleia plantae", []string{"Unknown Plant"}, "这是常见观赏植物。")
	if result.State != safetyStateUnknown {
		t.Fatalf("expected unknown, got %s", result.State)
	}
	if result.Note != safetyUnknownNote {
		t.Fatalf("expected safety unknown note, got %q", result.Note)
	}
}

func TestFirstChineseName(t *testing.T) {
	if got := firstChineseName([]string{"Common sunflower", "向日葵"}); got != "向日葵" {
		t.Fatalf("expected 向日葵, got %q", got)
	}
	if got := firstChineseName([]string{"Common sunflower"}); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestStoreHistoryLifecycle(t *testing.T) {
	store, err := OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer store.Close()

	ctx := context.Background()
	item := HistoryItem{
		ID:             "history-1",
		ScientificName: "Helianthus annuus",
		CommonNameZh:   "向日葵",
		FamilyZh:       "菊科",
		GBIFKey:        3119195,
		Score:          0.92,
	}
	if err := store.SaveHistory(ctx, "user-1", item); err != nil {
		t.Fatalf("save history: %v", err)
	}
	items, err := store.ListHistory(ctx, "user-1", 10)
	if err != nil {
		t.Fatalf("list history: %v", err)
	}
	if len(items) != 1 || items[0].ID != "history-1" {
		t.Fatalf("unexpected history items: %+v", items)
	}
	if err := store.DeleteHistory(ctx, "user-1", "history-1"); err != nil {
		t.Fatalf("delete history: %v", err)
	}
	if err := store.DeleteHistory(ctx, "user-1", "history-1"); err == nil {
		t.Fatal("expected delete to fail for missing history")
	}
	if err := store.SaveHistory(ctx, "user-1", item); err != nil {
		t.Fatalf("save history again: %v", err)
	}
	if err := store.ClearHistory(ctx, "user-1"); err != nil {
		t.Fatalf("clear history: %v", err)
	}
	items, err = store.ListHistory(ctx, "user-1", 10)
	if err != nil {
		t.Fatalf("list history after clear: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected empty history, got %+v", items)
	}
}

func TestCallPlantNetParsesResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		if !strings.Contains(r.URL.RawQuery, "api-key=test-key") {
			t.Fatalf("missing api key query: %s", r.URL.RawQuery)
		}
		if !strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
			t.Fatalf("expected multipart form, got %q", r.Header.Get("Content-Type"))
		}
		_, _ = io.WriteString(w, `{
			"results": [
				{
					"score": 0.92,
					"species": {
						"scientificNameWithoutAuthor": "Helianthus annuus",
						"genus": {"scientificNameWithoutAuthor": "Helianthus"},
						"family": {"scientificNameWithoutAuthor": "Asteraceae"},
						"commonNames": ["Common sunflower", "向日葵"],
						"gbif": {"id": "3119195"}
					}
				}
			]
		}`)
	}))
	defer server.Close()

	cfg := Config{
		APIKey:         "test-key",
		BaseURL:        server.URL,
		Project:        "all",
		MaxMatches:     5,
		RequestTimeout: 5 * time.Second,
	}
	results, err := callPlantNet(context.Background(), cfg, []byte("fake-image-bytes"), "leaf")
	if err != nil {
		t.Fatalf("call plant net: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Species.ScientificName != "Helianthus annuus" {
		t.Fatalf("unexpected scientific name: %q", results[0].Species.ScientificName)
	}
	if results[0].Species.GBIFKey != 3119195 {
		t.Fatalf("unexpected gbif key: %d", results[0].Species.GBIFKey)
	}
	if firstChineseName(results[0].Species.CommonNames) != "向日葵" {
		t.Fatalf("expected Chinese common name")
	}
}

func TestServiceIdentifyRequiresKey(t *testing.T) {
	service := NewService(Config{}, nil)
	_, err := service.Identify(context.Background(), bytes.Repeat([]byte{1}, 8), "")
	if err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("expected not configured error, got %v", err)
	}
}
