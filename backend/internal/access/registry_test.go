package access_test

import (
	"testing"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/roles"
)

func TestRegistryIncludesManagedGameEntries(t *testing.T) {
	definitions, err := access.Registry()
	if err != nil {
		t.Fatalf("decode registry: %v", err)
	}

	gameIDs := make(map[string]bool)
	for _, definition := range definitions {
		if definition.Category == "游戏" {
			gameIDs[definition.ID] = true
		}
	}
	for _, id := range []string{"snake-brawl", "gomoku", "tetris", "brick-breaker", "xiangqi"} {
		if !gameIDs[id] {
			t.Fatalf("registry missing game %q", id)
		}
	}
}

func TestRegistryAcceptsGameRoutesAndRejectsUnknownPrefixes(t *testing.T) {
	valid := access.FeatureDefinition{
		ID:           "gomoku",
		Name:         "五子棋",
		Route:        "/games/gomoku",
		Category:     "游戏",
		InitialRoles: []roles.Role{roles.Normal, roles.Admin},
	}
	store, err := access.OpenStore(":memory:")
	if err != nil {
		t.Fatalf("open access store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.SyncRegistry(t.Context(), []access.FeatureDefinition{valid}); err != nil {
		t.Fatalf("sync game feature: %v", err)
	}

	invalid := valid
	invalid.ID = "unknown"
	invalid.Route = "/secret/entry"
	if err := store.SyncRegistry(t.Context(), []access.FeatureDefinition{invalid}); err == nil {
		t.Fatal("registry accepted unknown route prefix")
	}
}
