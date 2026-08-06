package shoppingroute

import (
	_ "embed"
	"encoding/json"
	"strings"
	"sync"
)

//go:embed verified_mappings.json
var verifiedMappingsJSON []byte

var (
	verifiedOnce   sync.Once
	verifiedByName map[string]VerifiedMapping
	verifiedList   []VerifiedMapping
)

func loadVerifiedMappings() []VerifiedMapping {
	verifiedOnce.Do(func() {
		if err := json.Unmarshal(verifiedMappingsJSON, &verifiedList); err != nil {
			verifiedList = []VerifiedMapping{}
			return
		}
		verifiedByName = make(map[string]VerifiedMapping)
		for _, mapping := range verifiedList {
			for _, name := range mapping.Names {
				verifiedByName[normalizeName(name)] = mapping
			}
		}
	})
	return verifiedList
}

func VerifiedMappings() []VerifiedMapping {
	return loadVerifiedMappings()
}

func findVerifiedMapping(name string) (VerifiedMapping, bool) {
	loadVerifiedMappings()
	mapping, ok := verifiedByName[normalizeName(name)]
	return mapping, ok
}

func FindVerifiedMapping(name string) (VerifiedMapping, bool) {
	return findVerifiedMapping(name)
}

func HasVerifiedSuggestion(name string) bool {
	_, found := findVerifiedMapping(name)
	return found
}

func normalizeName(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ToLower(value)
	fields := strings.Fields(value)
	return strings.Join(fields, "")
}
