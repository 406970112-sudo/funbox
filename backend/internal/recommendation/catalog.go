package recommendation

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed catalog.json
var catalogJSON []byte

type Catalog []Product

func LoadCatalog() (Catalog, error) {
	var catalog Catalog
	if err := json.Unmarshal(catalogJSON, &catalog); err != nil {
		return nil, fmt.Errorf("decode product catalog: %w", err)
	}
	if len(catalog) == 0 {
		return nil, fmt.Errorf("product catalog is empty")
	}
	for _, product := range catalog {
		if product.ID == "" || product.Name == "" || product.Category == "" {
			return nil, fmt.Errorf("product catalog contains an invalid entry")
		}
		if product.ReferencePrice <= 0 {
			return nil, fmt.Errorf("product %q has an invalid reference price", product.ID)
		}
		if len(product.Links) == 0 {
			return nil, fmt.Errorf("product %q has no purchase links", product.ID)
		}
	}
	return catalog, nil
}
