package access_test

import (
	"context"
	"path/filepath"
	"testing"

	"my-first-expo-app/backend/internal/access"
	"my-first-expo-app/backend/internal/roles"
	"my-first-expo-app/backend/internal/user"
)

func TestRegistrySyncPreservesExistingRulesAndSecuresNewFeatures(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "access.db")
	userStore, err := user.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open user store: %v", err)
	}
	t.Cleanup(func() { _ = userStore.Close() })

	created, err := userStore.Create(
		context.Background(),
		"13800138000",
		"password-hash",
		"Access User",
		"question",
		"answer-hash",
	)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	store, err := access.OpenStore(databasePath)
	if err != nil {
		t.Fatalf("open access store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	initial := []access.FeatureDefinition{{
		ID:           "existing",
		Name:         "Existing Feature",
		Route:        "/tools/existing",
		Category:     "AI",
		InitialRoles: []roles.Role{roles.Normal, roles.Admin},
	}}
	if err := store.SyncRegistry(context.Background(), initial); err != nil {
		t.Fatalf("initial registry sync: %v", err)
	}
	if err := store.UpdateRolePermissions(
		context.Background(),
		"existing",
		[]roles.Role{roles.VIP},
	); err != nil {
		t.Fatalf("update existing permissions: %v", err)
	}

	next := append(initial, access.FeatureDefinition{
		ID:       "new-feature",
		Name:     "New Feature",
		Route:    "/tools/new-feature",
		Category: "AI",
	})
	if err := store.SyncRegistry(context.Background(), next); err != nil {
		t.Fatalf("second registry sync: %v", err)
	}

	features, err := store.ListFeatures(context.Background())
	if err != nil {
		t.Fatalf("list features: %v", err)
	}
	if len(features) != 2 {
		t.Fatalf("feature count = %d, want 2", len(features))
	}
	assertRoles(t, features[0].Roles, []roles.Role{roles.VIP, roles.Admin})
	assertRoles(t, features[1].Roles, []roles.Role{roles.Admin})

	visible, err := store.VisibleFeatureIDs(context.Background(), created.ID, created.Role)
	if err != nil {
		t.Fatalf("list visible features: %v", err)
	}
	if len(visible) != 0 {
		t.Fatalf("normal user initially sees %v", visible)
	}
	if err := store.SetUserGrant(
		context.Background(),
		"new-feature",
		created.Username,
		true,
	); err != nil {
		t.Fatalf("grant user access: %v", err)
	}
	visible, err = store.VisibleFeatureIDs(context.Background(), created.ID, created.Role)
	if err != nil {
		t.Fatalf("list granted features: %v", err)
	}
	if len(visible) != 1 || visible[0] != "new-feature" {
		t.Fatalf("granted user sees %v", visible)
	}
}

func assertRoles(t *testing.T, actual []roles.Role, expected []roles.Role) {
	t.Helper()
	actualSet := make(map[roles.Role]struct{}, len(actual))
	for _, role := range actual {
		actualSet[role] = struct{}{}
	}
	if len(actualSet) != len(expected) {
		t.Fatalf("roles = %v, want %v", actual, expected)
	}
	for _, role := range expected {
		if _, ok := actualSet[role]; !ok {
			t.Fatalf("roles = %v, missing %q", actual, role)
		}
	}
}
