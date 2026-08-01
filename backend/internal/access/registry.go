package access

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"my-first-expo-app/backend/internal/roles"
)

//go:embed feature_registry.json
var registryJSON []byte

type FeatureDefinition struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Route        string       `json:"route"`
	Category     string       `json:"category"`
	InitialRoles []roles.Role `json:"initialRoles"`
}

func Registry() ([]FeatureDefinition, error) {
	var definitions []FeatureDefinition
	if err := json.Unmarshal(registryJSON, &definitions); err != nil {
		return nil, fmt.Errorf("decode feature registry: %w", err)
	}
	if len(definitions) == 0 {
		return nil, errors.New("feature registry is empty")
	}

	seen := make(map[string]struct{}, len(definitions))
	for index := range definitions {
		definition := &definitions[index]
		definition.ID = strings.TrimSpace(definition.ID)
		definition.Name = strings.TrimSpace(definition.Name)
		definition.Route = strings.TrimSpace(definition.Route)
		definition.Category = strings.TrimSpace(definition.Category)
		if definition.ID == "" || definition.Name == "" || !isManagedRoute(definition.Route) {
			return nil, fmt.Errorf("invalid feature registry entry at index %d", index)
		}
		if _, exists := seen[definition.ID]; exists {
			return nil, fmt.Errorf("duplicate feature id %q", definition.ID)
		}
		seen[definition.ID] = struct{}{}
		for _, role := range definition.InitialRoles {
			if !roles.IsValid(role) {
				return nil, fmt.Errorf("feature %q has invalid initial role %q", definition.ID, role)
			}
		}
	}
	return definitions, nil
}

func isManagedRoute(route string) bool {
	for _, prefix := range []string{"/tools/", "/games/", "/reading/"} {
		if strings.HasPrefix(route, prefix) {
			return true
		}
	}
	return false
}
