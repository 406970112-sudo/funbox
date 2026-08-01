package recommendation

import "testing"

func TestCatalogLoadsValidProducts(t *testing.T) {
	catalog, err := LoadCatalog()
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	if len(catalog) < 20 {
		t.Fatalf("catalog should contain at least 20 products, got %d", len(catalog))
	}

	seen := map[string]bool{}
	for _, product := range catalog {
		if seen[product.ID] {
			t.Fatalf("duplicate product id %q", product.ID)
		}
		seen[product.ID] = true
		if len(product.Specs) == 0 {
			t.Fatalf("product %q has no specs", product.ID)
		}
		if len(product.Links) == 0 {
			t.Fatalf("product %q has no links", product.ID)
		}
		for _, link := range product.Links {
			if link.URL == "" || link.Platform == "" {
				t.Fatalf("product %q has an invalid link", product.ID)
			}
		}
	}
}
